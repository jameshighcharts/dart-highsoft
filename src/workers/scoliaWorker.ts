import { ScoliaScoreBroadcaster } from '../services/scoliaScoreBroadcaster.ts';
import { BoardStatusWriter } from '../lib/scolia/boardStatusWriter.ts';
import { ThreadedScoliaCommentaryAnalysis } from '../services/scoliaCommentaryAnalysis.ts';
import { ScoliaAtomicIngestion, type Prepared } from '../lib/server/scoliaAtomicIngestion.ts';
import type { AcceptedScoliaDart } from '../lib/commentary/scoliaRealtimeEvent.ts';
import { updateBullOff } from '../lib/server/bullOff.ts';
import { loadMatch as loadBullOffMatch } from '../lib/server/matchGuards.ts';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';

import {
  boardStatePatchForMessage,
  occurredAtForMessage,
  parseScoliaMessage,
  reconnectDelayMs,
  THROWN_BEFORE_TARGET,
  type ScoliaMessage,
} from '../lib/scolia/protocol.ts';
import {
  ingestScoliaThrowEvent,
  type StoredScoliaEvent,
  type ScoliaThrowIngestionResult,
} from '../lib/server/scoliaThrowIngestion.ts';
import { findActiveScoliaBoardOccupant } from '../lib/server/scoliaBoardTarget.ts';
import {
  staleCommandAction,
  staleCommandCutoff,
  SCOLIA_COMMAND_ACK_TIMEOUT_MS,
} from '../lib/scolia/commandRecovery.ts';
import { ScoliaRealtimeCommentaryPublisher } from '../services/scoliaRealtimeCommentaryPublisher.ts';
import { OrderedWorkQueue, WorkerNotifications } from '../lib/scolia/orderedWorkQueue.ts';
import { ResilientChannel } from '../lib/scolia/resilientChannel.ts';
import { databaseError, isTransientDatabaseError } from '../lib/server/databaseError.ts';

type AccountBoard = {
  name: string;
  serialNumber: string;
  isHomeSbc: boolean;
};

type StoredBoard = AccountBoard & { id: string };

const SCOLIA_REST_BASE_URL = 'https://game.scoliadarts.com';
const SCOLIA_WEBSOCKET_URL = 'wss://game.scoliadarts.com/api/v1/social';
const BOARD_SYNC_INTERVAL_MS = 30_000;
// Readiness treats a heartbeat older than 45s as stale (SCOLIA_HEARTBEAT_MAX_AGE_MS); 15s
// leaves room for a slow status write without the board falsely showing the worker offline.
const HEARTBEAT_INTERVAL_MS = 15_000;
// Realtime notifications wake command and commentary work immediately; these polls are the fallback.
const COMMAND_POLL_INTERVAL_MS = 30_000;
const COMMENTARY_RETRY_INTERVAL_MS = 30_000;
// Darts thrown at a dead socket are never redelivered, so every second of detection is lost play.
const LIVENESS_TICK_MS = 2_500;
// Transport check: a pong proves the TCP path; trusted only once Scolia has answered a ping.
const PING_INTERVAL_MS = 10_000;
const PONG_TIMEOUT_MS = 5_000;
// Application check: a quiet socket is probed with GET_SBC_STATUS; no reply in time means the
// relay behind it is dead even if the socket still looks open.
const LIVENESS_PROBE_AFTER_MS = 15_000;
const LIVENESS_TIMEOUT_MS = 10_000;
// A handshake that never answers must fail rather than leave the board waiting forever.
const HANDSHAKE_TIMEOUT_MS = 15_000;
// Backstop for a connection attempt that somehow outlives its own handshake timeout.
const CONNECT_STALL_MS = HANDSHAKE_TIMEOUT_MS + 10_000;
// A hung database request must not stall a board's queue or the board sync indefinitely.
const SUPABASE_REQUEST_TIMEOUT_MS = 30_000;
// One event failing forever must not hold every later dart on the board hostage.
const MESSAGE_MAX_ATTEMPTS = 15;
// Recovered darts older than this are abandoned rather than scored into a later visit.
const PENDING_THROW_MAX_AGE_MS = 5 * 60_000;
// A live dart blocked by a database outage keeps retrying in order until it is this old. Past
// it the heartbeat may already be stale and the UI telling players to enter darts by hand, so
// scoring it later could count it twice.
const LIVE_DART_DEADLINE_MS = 20_000;
// On shutdown, received darts get this long to be saved before the process exits.
const SHUTDOWN_DRAIN_MS = 5_000;
const SHUTDOWN_DEADLINE_MS = 10_000;

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function isAccountBoard(value: unknown): value is AccountBoard {
  if (!value || typeof value !== 'object') return false;
  const board = value as Record<string, unknown>;
  return typeof board.name === 'string' && typeof board.serialNumber === 'string' && typeof board.isHomeSbc === 'boolean';
}

async function fetchAccountBoards(accessToken: string): Promise<AccountBoard[]> {
  const response = await fetch(`${SCOLIA_REST_BASE_URL}/api/social/boards`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Scolia board discovery failed with HTTP ${response.status}`);
  const value = (await response.json()) as unknown;
  if (!Array.isArray(value) || !value.every(isAccountBoard)) {
    throw new Error('Scolia board discovery returned an invalid response');
  }
  return value;
}

export class BoardConnection {
  private readonly board: StoredBoard;
  private readonly accessToken: string;
  private readonly supabase: SupabaseClient;
  private readonly commentaryPublisher: ScoliaRealtimeCommentaryPublisher;
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private stopped = false;
  private readonly messageQueue: OrderedWorkQueue;
  private readonly commentaryQueue: OrderedWorkQueue;
  private readonly atomicIngestion: ScoliaAtomicIngestion;
  private readonly scoreBroadcaster: ScoliaScoreBroadcaster;
  private readonly statusWriter: BoardStatusWriter;
  private flushingCommands = false;
  private commandRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private latestAcceptedThrowId: string | null = null;
  private lastMessageAt = 0;
  private livenessProbeSentAt: number | null = null;
  private connectStartedAt = 0;
  private pingSentAt: number | null = null;
  private lastPongAt = 0;
  private pongSeen = false;
  private livenessTimer: ReturnType<typeof setInterval> | null = null;
  // Scolia opens the socket before deciding (e.g. 4101), so only a message proves acceptance.
  private established = false;
  private boardState: Record<string, unknown> = {};
  // Pending or failed darts may exist from before this process started.
  private recoveryNeeded = true;

  constructor(
    board: StoredBoard,
    accessToken: string,
    supabase: SupabaseClient,
    commentaryPublisher: ScoliaRealtimeCommentaryPublisher
  ) {
    this.board = board;
    this.accessToken = accessToken;
    this.supabase = supabase;
    this.commentaryPublisher = commentaryPublisher;
    this.scoreBroadcaster = new ScoliaScoreBroadcaster(supabase);
    this.atomicIngestion = new ScoliaAtomicIngestion(supabase);
    this.statusWriter = new BoardStatusWriter(value => this.writeBoard(value),
      error => console.warn(`[scolia] ${this.board.name}: retrying board status`, error));
    this.messageQueue = new OrderedWorkQueue((error) => {
      this.recoveryNeeded = true;
      console.error(`[scolia] ${this.board.name}: retrying queued event`, error);
    }, 1_000, MESSAGE_MAX_ATTEMPTS, (error) => isTransientDatabaseError(error) ? LIVE_DART_DEADLINE_MS : 0);
    this.commentaryQueue = new OrderedWorkQueue((error) => {
      console.warn(`[commentary] ${this.board.name}: retrying delivery`, error);
    }, 2_000, 3);
  }

  start() {
    this.connect();
    this.livenessTimer = setInterval(() => this.checkLiveness(), LIVENESS_TICK_MS);
  }

  get boardId() { return this.board.id; }

  /** Warm the spectator broadcast for a match that just took this board. */
  prepareMatch(matchId: string) {
    if (!this.stopped) this.scoreBroadcaster.prepare(matchId);
  }

  private async warmBroadcast() {
    const target = await findActiveScoliaBoardOccupant(this.supabase, this.board.id);
    if (target?.kind === 'match') this.prepareMatch(target.id);
  }

  /** Stop receiving, give darts already received `drainMs` to be saved, then release everything. */
  async stop(drainMs = 0) {
    this.stopped = true;
    if (this.commandRecoveryTimer) clearTimeout(this.commandRecoveryTimer);
    if (this.livenessTimer) clearInterval(this.livenessTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, 'Worker stopping');
    // Scolia never redelivers a dart, so one received but not yet saved would be lost for good.
    await this.messageQueue.drained(drainMs);
    this.scoreBroadcaster.close();
    this.messageQueue.stop();
    this.commentaryQueue.stop();
    await this.statusWriter.stop();
    await this.writeBoard({ worker_connection_status: 'disconnected', worker_heartbeat_at: new Date().toISOString() });
  }

  private connect() {
    if (this.stopped) return;
    void this.updateBoard({ worker_connection_status: this.reconnectAttempt ? 'reconnecting' : 'connecting' });

    const url = new URL(SCOLIA_WEBSOCKET_URL);
    url.searchParams.set('serialNumber', this.board.serialNumber);
    url.searchParams.set('accessToken', this.accessToken);
    let socket: WebSocket;
    try {
      socket = new WebSocket(url, { handshakeTimeout: HANDSHAKE_TIMEOUT_MS });
    } catch (error) {
      console.warn(`[scolia] ${this.board.name}: could not start cloud connection`, error);
      this.scheduleReconnect(reconnectDelayMs(1006, this.reconnectAttempt++));
      return;
    }
    this.socket = socket;
    this.connectStartedAt = Date.now();
    this.pingSentAt = null;
    this.pongSeen = false;
    this.established = false;

    socket.on('open', () => {
      if (this.socket !== socket || this.stopped) return;
      this.lastMessageAt = Date.now();
      this.livenessProbeSentAt = null;
      // Scolia greets an accepted connection with HELLO_CLIENT; this also prompts a reply. Until a
      // message arrives the board is not connected: a refused socket (4101) opens, then closes.
      socket.send(JSON.stringify({ type: 'GET_SBC_STATUS', id: crypto.randomUUID() }));
    });

    socket.on('message', (data, isBinary) => {
      if (this.socket !== socket || isBinary) return;
      if (!this.established) this.markEstablished();
      this.lastMessageAt = Date.now();
      this.livenessProbeSentAt = null;
      const message = parseScoliaMessage(data.toString());
      if (!message) {
        console.warn(`[scolia] ${this.board.name}: ignored invalid message`);
        return;
      }
      const receivedAtMs = Date.now();
      this.enqueue(() => this.persistMessage(message, receivedAtMs));
    });

    socket.on('pong', () => {
      if (this.socket !== socket) return;
      this.lastPongAt = Date.now();
      this.pongSeen = true;
    });

    // ws always follows a failed handshake or broken socket with 'close', which owns reconnecting.
    socket.on('error', (error) => {
      console.warn(`[scolia] ${this.board.name}: cloud connection error: ${error.message}`);
    });

    socket.on('close', (code) => {
      // A socket we already abandoned (e.g. after a liveness timeout) must not start a second connection.
      if (this.socket !== socket) return;
      this.socket = null;
      this.established = false;
      if (this.stopped) return;
      const delay = reconnectDelayMs(code, this.reconnectAttempt++);
      const reason = code === 4101
        ? ' - another connection holds this board; is a second worker running with the same Scolia token?'
        : '';
      console.warn(`[scolia] ${this.board.name}: closed (${code}); retrying in ${delay}ms${reason}`);
      void this.updateBoard({ worker_connection_status: 'reconnecting' });
      this.scheduleReconnect(delay);
    });
  }

  private markEstablished() {
    this.established = true;
    this.reconnectAttempt = 0;
    this.recoveryNeeded = true;
    console.info(`[scolia] ${this.board.name}: cloud connection open`);
    void this.updateBoard({ worker_connection_status: 'connected' });
    // Stored darts first, so they keep their place ahead of anything this socket delivers.
    this.enqueue(() => this.processPendingThrows());
    this.enqueue(() => this.flushCommands());
    // Off the dart queue: a warm-up must never delay scoring.
    void this.warmBroadcast().catch((error) => console.warn(`[scolia] ${this.board.name}: broadcast warm-up failed`, error));
  }

  private scheduleReconnect(delay: number) {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /** Drop a socket that stopped making progress and start over. */
  private abandon(socket: WebSocket, reason: string) {
    console.warn(`[scolia] ${this.board.name}: ${reason}; reconnecting`);
    this.socket = null;
    this.established = false;
    this.livenessProbeSentAt = null;
    // terminate, not close: a close handshake Scolia never answers would keep the old socket
    // replying to Scolia's pings, and Scolia would refuse every new connection with 4101.
    socket.terminate();
    void this.updateBoard({ worker_connection_status: 'reconnecting' });
    this.scheduleReconnect(reconnectDelayMs(1006, this.reconnectAttempt++));
  }

  /**
   * Make sure the board is always either connected or on its way there. A half-open socket
   * never closes, so darts would silently stop; a lost reconnect would leave the board idle.
   */
  private checkLiveness(now = Date.now()) {
    if (this.stopped) return;
    const socket = this.socket;
    if (!socket) {
      if (this.reconnectTimer) return;
      console.warn(`[scolia] ${this.board.name}: no connection and no reconnect pending; reconnecting`);
      this.connect();
      return;
    }
    if (socket.readyState === WebSocket.CONNECTING) {
      if (now - this.connectStartedAt >= CONNECT_STALL_MS) this.abandon(socket, 'connection attempt stalled');
      return;
    }
    if (socket.readyState !== WebSocket.OPEN) return;
    const heardSince = (at: number) => Math.max(this.lastPongAt, this.lastMessageAt) > at;
    if (this.pingSentAt !== null && !heardSince(this.pingSentAt)) {
      // A server that never answers pings is still covered by the status probe below.
      if (this.pongSeen && now - this.pingSentAt >= PONG_TIMEOUT_MS) {
        this.abandon(socket, 'no pong from Scolia');
        return;
      }
    } else if (this.pingSentAt === null || now - this.pingSentAt >= PING_INTERVAL_MS) {
      this.pingSentAt = now;
      socket.ping();
    }
    if (this.livenessProbeSentAt !== null) {
      if (now - this.livenessProbeSentAt < LIVENESS_TIMEOUT_MS) return;
      this.abandon(socket, 'no reply to status probe');
      return;
    }
    if (now - this.lastMessageAt < LIVENESS_PROBE_AFTER_MS) return;
    this.livenessProbeSentAt = now;
    socket.send(JSON.stringify({ type: 'GET_SBC_STATUS', id: crypto.randomUUID() }));
  }

  async heartbeat() {
    if (this.stopped) return;
    await this.updateBoard({ worker_heartbeat_at: new Date().toISOString() });
    if (this.recoveryNeeded && this.messageQueue.idle) this.enqueue(() => this.processPendingThrows());
  }

  async flushCommands() {
    if (this.stopped || this.flushingCommands || !this.established || this.socket?.readyState !== WebSocket.OPEN) return;
    this.flushingCommands = true;
    try {
      await this.recoverStaleCommands();
      const { data, error } = await this.supabase
        .from('scolia_commands')
        .select('id, command_type, payload, attempts')
        .eq('board_id', this.board.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(20);
      if (error) throw new Error(error.message);

      for (const command of data ?? []) {
        if (this.socket?.readyState !== WebSocket.OPEN) return;
        const { data: claimed, error: updateError } = await this.supabase
          .from('scolia_commands')
          .update({
            status: 'sent',
            attempts: (command.attempts as number) + 1,
            sent_at: new Date().toISOString(),
            completed_at: null,
            last_error: null,
          })
          .eq('id', command.id)
          .eq('status', 'pending')
          .select('id')
          .maybeSingle();
        if (updateError) throw new Error(updateError.message);
        if (!claimed) continue;
        try {
          this.socket.send(JSON.stringify({
            type: command.command_type,
            id: command.id,
            ...(command.payload && Object.keys(command.payload as Record<string, unknown>).length > 0
              ? { payload: command.payload }
              : {}),
          }));
          if (!this.commandRecoveryTimer) {
            this.commandRecoveryTimer = setTimeout(() => {
              this.commandRecoveryTimer = null;
              void this.flushCommands().catch((error) => console.error('[scolia] command recovery failed', error));
            }, SCOLIA_COMMAND_ACK_TIMEOUT_MS + 50);
          }
        } catch (sendError) {
          await this.supabase
            .from('scolia_commands')
            .update({ status: 'pending', sent_at: null, last_error: 'WebSocket send failed' })
            .eq('id', command.id)
            .eq('status', 'sent');
          throw sendError;
        }
      }
    } finally {
      this.flushingCommands = false;
    }
  }

  private async recoverStaleCommands() {
    const { data, error } = await this.supabase
      .from('scolia_commands')
      .select('id, attempts')
      .eq('board_id', this.board.id)
      .eq('status', 'sent')
      .lt('sent_at', staleCommandCutoff());
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return;

    const now = new Date().toISOString();
    await Promise.all(data.map(async (command) => {
      const action = staleCommandAction(command.attempts as number);
      const values = action === 'retry'
        ? {
            status: 'pending',
            sent_at: null,
            last_error: 'Scolia acknowledgement timed out; retrying',
          }
        : {
            status: 'failed',
            completed_at: now,
            last_error: 'Scolia acknowledgement timed out after maximum retries',
          };
      const { error: updateError } = await this.supabase
        .from('scolia_commands')
        .update(values)
        .eq('id', command.id)
        .eq('status', 'sent');
      if (updateError) throw new Error(updateError.message);
      if (action === 'fail') {
        console.error(`[scolia] ${this.board.name}: command ${command.id} failed after repeated timeouts`);
      }
    }));
  }

  private enqueue(work: () => Promise<void>) {
    this.messageQueue.enqueue(work);
  }

  private async processPendingThrows() {
    const { data, error, status } = await this.supabase
      .from('scolia_events')
      .select('id, board_id, message_id, event_type, payload, received_at')
      .eq('board_id', this.board.id)
      .eq('event_type', 'THROW_DETECTED')
      .in('processing_status', ['pending', 'failed'])
      .order('id', { ascending: true });
    if (error) throw databaseError(error, status);
    const events = (data ?? []) as (StoredScoliaEvent & { received_at: string | null })[];
    if (events.length === 0) {
      this.recoveryNeeded = false;
      return;
    }
    const target = await findActiveScoliaBoardOccupant(this.supabase, this.board.id);
    for (const event of events) {
      const abandon = recoveryAbandonReason(event.received_at, target?.createdAt ?? null);
      if (abandon) {
        await this.markEvent(event.id, 'ignored', abandon);
        console.warn(`[scolia] ${this.board.name}: abandoned throw ${event.message_id}: ${abandon}`);
        continue;
      }
      // One stubborn event must not block recovery of the rest.
      try {
        const result = await ingestScoliaThrowEvent(this.supabase, event, this.atomicIngestion);
        if (result.status === 'processed') {
          console.info(`[scolia] ${this.board.name}: recovered throw ${event.message_id}`);
          if (result.target.kind === 'match') {
            this.publishCommentary(result.target.id, result.throwId, result.accepted);
          }
        }
      } catch (recoveryError) {
        console.error(`[scolia] ${this.board.name}: could not recover throw ${event.message_id}`, recoveryError);
      }
    }
  }

  private async markEvent(eventId: number, status: 'ignored', reason: string) {
    const { error } = await this.supabase
      .from('scolia_events')
      .update({ processing_status: status, processed_at: new Date().toISOString(), processing_error: reason })
      .eq('id', eventId);
    if (error) throw new Error(error.message);
  }

  private async persistMessage(message: ScoliaMessage, receivedAtMs = Date.now()) {
    // Each dart is bounded by its own age, so a backlog behind an outage cannot stretch the window.
    if (message.type === 'THROW_DETECTED' && Date.now() - receivedAtMs > LIVE_DART_DEADLINE_MS) {
      console.error(`[scolia] ${this.board.name}: gave up on throw ${message.id} after ${LIVE_DART_DEADLINE_MS / 1000}s of database errors`);
      return;
    }
    const now = new Date().toISOString();
    let storedEvent: (StoredScoliaEvent & { processing_status: string }) | null;
    let prepared: Prepared | null = null;
    let committed: ScoliaThrowIngestionResult | undefined;
    if (message.type === 'THROW_DETECTED') {
      const persisted = await this.atomicIngestion.persistAndPrepare({
        board_id: this.board.id, message_id: message.id, event_type: message.type,
        payload: message.payload ?? {}, occurred_at: occurredAtForMessage(message),
        received_at: new Date(receivedAtMs).toISOString(),
      });
      storedEvent = persisted.event;
      prepared = persisted.prepared;
      committed = persisted.result;
    } else if (message.type === 'SBC_STATUS') {
      // Replies to our own status requests (including liveness probes) carry state, not history,
      // and arrive every few seconds on a quiet board: only a real change is worth a write.
      this.applyBoardState(boardStatePatchForMessage(message), {});
      return;
    } else {
      const { data: insertedEvent, error: eventError, status: eventStatus } = await this.supabase.from('scolia_events').upsert(
        {
          board_id: this.board.id,
          message_id: message.id,
          event_type: message.type,
          payload: message.payload ?? {},
          occurred_at: occurredAtForMessage(message),
          received_at: new Date(receivedAtMs).toISOString(),
        },
        { onConflict: 'board_id,message_id', ignoreDuplicates: true }
      ).select('id, board_id, message_id, event_type, payload, processing_status').maybeSingle();
      if (eventError) throw databaseError(eventError, eventStatus);

      storedEvent = insertedEvent;
      if (!storedEvent) {
        const { data, error, status } = await this.supabase
          .from('scolia_events')
          .select('id, board_id, message_id, event_type, payload, processing_status')
          .eq('board_id', this.board.id)
          .eq('message_id', message.id)
          .single();
        if (error) throw databaseError(error, status);
        if (!data) throw new Error('Could not reload Scolia event');
        storedEvent = data;
      }
    }

    // Connection status belongs to the socket's open/close handlers: this message may be processed
    // after its socket already closed, and must not report a dead board as connected.
    this.applyBoardState(boardStatePatchForMessage(message), { worker_heartbeat_at: now, last_event_at: now });

    const processingStatus = storedEvent.processing_status as string;
    if (message.type === 'THROW_DETECTED' && (committed || (processingStatus !== 'processed' && processingStatus !== 'ignored'))) {
      // Status writes are independently ordered/retried and never hold this queue.
      {
        const result = committed ?? await ingestScoliaThrowEvent(this.supabase, storedEvent as StoredScoliaEvent, this.atomicIngestion, prepared);
        if (result.status === 'processed' && result.accepted) result.accepted.workerReceivedAtMs = receivedAtMs;
        if (result.status === 'processed') {
          console.info(`[scolia] ${this.board.name}: scored throw ${message.id}`);
          if (result.target.kind === 'match') {
            this.publishCommentary(result.target.id, result.throwId, result.accepted);
          }
        } else {
          console.info(`[scolia] ${this.board.name}: ignored throw ${message.id}: ${result.reason}`);
        }
      }
      return;
    }
    await this.handleCommandResponse(message, now);

    if (
      processingStatus !== 'processed'
      && processingStatus !== 'ignored'
      && message.type === 'TAKEOUT_FINISHED'
      && message.payload?.falseTakeout !== true
    ) {
      const target = await findActiveScoliaBoardOccupant(this.supabase, this.board.id);
      if (target?.kind === 'match') {
        this.scoreBroadcaster.prepare(target.id);
        const bullMatch = target.bullOffThrowing ? await loadBullOffMatch(this.supabase, target.id) : null;
        if (bullMatch?.bull_off?.phase === 'throwing') {
          await updateBullOff(this.supabase, target.id, bullMatch.bull_off, 'takeout', Number(storedEvent.id));
          const { error: bullStatusError } = await this.supabase.from('scolia_events').update({ processing_status: 'processed', processed_at: now }).eq('id', storedEvent.id);
          if (bullStatusError) throw new Error(bullStatusError.message);
          return;
        }
        const sourceThrowId = this.latestAcceptedThrowId;
        this.commentaryQueue.enqueue(async () => {
          await this.commentaryPublisher.publishTakeoutFinished(
            target.id, message.id, () => this.latestAcceptedThrowId === sourceThrowId
          );
        });
      }
    }

    if (processingStatus === 'processed' || processingStatus === 'ignored') return;

    const { error: ignoreError } = await this.supabase
      .from('scolia_events')
      .update({ processing_status: 'ignored', processed_at: now })
      .eq('id', storedEvent.id);
    if (ignoreError) throw new Error(ignoreError.message);
  }

  private publishCommentary(matchId: string, throwId: string, accepted?: AcceptedScoliaDart) {
    if (accepted) this.scoreBroadcaster.publish(matchId, accepted);
    this.latestAcceptedThrowId = throwId;
    this.commentaryQueue.enqueue(async () => {
      await this.commentaryPublisher.publishAcceptedThrow(matchId, throwId, () => this.latestAcceptedThrowId === throwId, accepted);
    });
  }

  private async handleCommandResponse(message: ScoliaMessage, now: string) {
    if (message.type !== 'ACKNOWLEDGED' && message.type !== 'REFUSED') return;
    const replyTo = message.payload?.replyTo;
    if (typeof replyTo !== 'string') return;
    const { data: command, error } = await this.supabase
      .from('scolia_commands')
      .update({
        status: message.type === 'ACKNOWLEDGED' ? 'acknowledged' : 'refused',
        response_payload: message.payload ?? {},
        completed_at: now,
        last_error: message.type === 'REFUSED'
          ? String(message.payload?.errorMessage ?? message.payload?.error ?? 'Scolia refused the command')
          : null,
      })
      .eq('id', replyTo)
      .eq('board_id', this.board.id)
      .eq('status', 'sent')
      .select('command_type, match_id')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (message.type === 'ACKNOWLEDGED' && command?.command_type === 'RESET_PHASE') {
      await this.afterPhaseReset(command.match_id as string | null);
    }
  }

  /** Scolia sends no takeout event after RESET_PHASE, so settle what that event would have. */
  private async afterPhaseReset(matchId: string | null) {
    this.applyBoardState({ board_phase: 'Throw' }, {});
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'GET_SBC_STATUS', id: crypto.randomUUID() }));
    }
    if (!matchId) return;
    const bullMatch = await loadBullOffMatch(this.supabase, matchId);
    if (bullMatch?.bull_off?.phase === 'throwing' && bullMatch.bull_off.awaitingTakeout) {
      await updateBullOff(this.supabase, matchId, bullMatch.bull_off, 'takeout');
    }
  }

  private async updateBoard(values: Record<string, unknown>) {
    this.statusWriter.update(values);
  }

  /** Write board state only when it changed, or when the caller has other fields to record. */
  private applyBoardState(patch: Record<string, unknown>, extra: Record<string, unknown>) {
    const changed = Object.entries(patch).some(([key, value]) => this.boardState[key] !== value);
    this.boardState = { ...this.boardState, ...patch };
    if (changed || Object.keys(extra).length > 0) void this.updateBoard({ ...patch, ...extra });
  }

  private async writeBoard(values: Record<string, unknown>) {
    const { error } = await this.supabase
      .from('scolia_boards')
      .update({ ...values, updated_at: new Date().toISOString() })
      .eq('id', this.board.id);
    if (error) throw new Error(error.message);
  }
}

/** Why a recovered dart must not be scored now, or null when it is still safe to apply. */
export function recoveryAbandonReason(receivedAt: string | null, targetCreatedAt: string | null, now = Date.now()): string | null {
  const received = receivedAt ? Date.parse(receivedAt) : Number.NaN;
  if (!Number.isFinite(received)) return null;
  if (targetCreatedAt && received < Date.parse(targetCreatedAt)) return THROWN_BEFORE_TARGET;
  if (now - received > PENDING_THROW_MAX_AGE_MS) return 'Gave up after repeated processing failures';
  return null;
}

function fetchWithTimeout(input: Parameters<typeof fetch>[0], init?: RequestInit) {
  const timeout = AbortSignal.timeout(SUPABASE_REQUEST_TIMEOUT_MS);
  return fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
}

async function startScoliaWorker() {
  const accessToken = requiredEnvironment('SCOLIA_ACCESS_TOKEN');
  const supabaseUrl = requiredEnvironment('NEXT_PUBLIC_SUPABASE_URL');
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_SECRET_KEY?.trim();
  if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY is required');
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
    global: { fetch: fetchWithTimeout },
  });
  const commentaryPublisher = new ScoliaRealtimeCommentaryPublisher(
    supabase,
    process.env.OPENAI_API_KEY?.trim() || null,
    new ThreadedScoliaCommentaryAnalysis(supabaseUrl, serviceRoleKey)
  );
  if (!commentaryPublisher.enabled) {
    console.info('[commentary] OPENAI_API_KEY is absent; Scolia sideband commentary is disabled');
  }
  const connections = new Map<string, BoardConnection>();
  let stopping = false;
  let syncRunning = false;
  let syncInterval: ReturnType<typeof setInterval> | null = null;
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  let commandInterval: ReturnType<typeof setInterval> | null = null;
  let commentaryInterval: ReturnType<typeof setInterval> | null = null;
  const notificationWork = new WorkerNotifications(({ boardIds, sessionIds, full }) => {
    if (stopping) return;
    void Promise.all([
      ...[...connections.values()]
        .filter((connection) => full || boardIds.includes(connection.boardId))
        .map((connection) => connection.flushCommands()),
      ...(full || sessionIds.length ? [commentaryPublisher.flushPending(full ? undefined : sessionIds)] : []),
    ]).catch((error) => console.error('[scolia] notification reconciliation failed', error));
  });
  // Deliveries are written only by this worker, so they are not subscribed: their retries come
  // from the commentary poll rather than echoes of our own writes.
  const notifications = new ResilientChannel(supabase, 'scolia-worker-work', (channel) => channel
    .on('postgres_changes', { event: '*', schema: 'public', table: 'scolia_commands' }, (payload) => {
      notificationWork.change('commands', payload);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'commentary_realtime_sessions' }, (payload) => {
      const row = payload.eventType === 'DELETE' ? payload.old : payload.new;
      commentaryPublisher.listenerChanged(row, payload.eventType === 'DELETE');
      notificationWork.change('sessions', payload);
    })
    // A match taking a board joins its spectator broadcast topic before the first dart.
    .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, (payload) => {
      if (payload.eventType === 'DELETE') return;
      const row = payload.new as Record<string, unknown>;
      // Same rule as the board occupant: a paused or abandoned match must not evict the live one's channel.
      if (typeof row.scolia_board_id !== 'string' || typeof row.id !== 'string' || row.winner_player_id
        || row.completed_at || row.ended_early || row.paused_at) return;
      for (const connection of connections.values()) {
        if (connection.boardId === row.scolia_board_id) connection.prepareMatch(row.id);
      }
    }), (status) => {
    commentaryPublisher.invalidateListeners();
    if (status === 'SUBSCRIBED') notificationWork.reconnect();
  });
  notifications.start();

  const syncBoards = async () => {
    if (stopping || syncRunning) return;
    syncRunning = true;
    try {
      const accountBoards = await fetchAccountBoards(accessToken);
      const activeSerials = new Set(accountBoards.map((board) => board.serialNumber));
      const { data: knownRows, error: knownRowsError } = await supabase
        .from('scolia_boards')
        .select('id, serial_number, name, is_home_sbc, enabled');
      if (knownRowsError) throw new Error(knownRowsError.message);
      const known = new Map((knownRows ?? []).map((row) => [row.serial_number as string, row]));
      const storedBoards = await Promise.all(
        accountBoards.map(async (board): Promise<StoredBoard> => {
          // Every write here fans out to each open board-status subscriber, so unchanged boards are left alone.
          const row = known.get(board.serialNumber);
          if (row?.enabled && row.name === board.name && row.is_home_sbc === board.isHomeSbc) {
            return { ...board, id: row.id as string };
          }
          const { data, error } = await supabase
            .from('scolia_boards')
            .upsert(
              {
                serial_number: board.serialNumber,
                name: board.name,
                is_home_sbc: board.isHomeSbc,
                enabled: true,
                updated_at: new Date().toISOString(),
              },
              { onConflict: 'serial_number' }
            )
            .select('id')
            .single();
          if (error || !data) throw new Error(error?.message ?? `Could not persist ${board.name}`);
          return { ...board, id: data.id as string };
        })
      );

      const missingSerials = (knownRows ?? [])
        .filter((row) => row.enabled)
        .map((row) => row.serial_number as string)
        .filter((serialNumber) => !activeSerials.has(serialNumber));
      if (missingSerials.length > 0) {
        const { error: disableError } = await supabase
          .from('scolia_boards')
          .update({ enabled: false, worker_connection_status: 'disconnected', updated_at: new Date().toISOString() })
          .in('serial_number', missingSerials);
        if (disableError) throw new Error(disableError.message);
      }

      for (const board of storedBoards) {
        if (connections.has(board.serialNumber)) continue;
        const connection = new BoardConnection(board, accessToken, supabase, commentaryPublisher);
        connections.set(board.serialNumber, connection);
        connection.start();
      }
      for (const [serialNumber, connection] of connections) {
        if (activeSerials.has(serialNumber)) continue;
        connections.delete(serialNumber);
        await connection.stop();
      }
      console.info(`[scolia] managing ${connections.size} board(s)`);
    } finally {
      syncRunning = false;
    }
  };

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.info(`[scolia] stopping (${signal}); closing connections`);
    // Cleanup is best effort: a hung request must never keep a stopping worker alive.
    setTimeout(() => process.exit(0), SHUTDOWN_DEADLINE_MS).unref();
    if (syncInterval) clearInterval(syncInterval);
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    if (commandInterval) clearInterval(commandInterval);
    if (commentaryInterval) clearInterval(commentaryInterval);
    notificationWork.stop();
    try {
      await Promise.allSettled([
        notifications.stop(),
        ...[...connections.values()].map((connection) => connection.stop(SHUTDOWN_DRAIN_MS)),
      ]);
      commentaryPublisher.close();
    } catch (error) {
      console.error('[scolia] shutdown cleanup failed', error);
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // Scolia being unreachable at boot must not crash the worker; the interval keeps retrying.
  await syncBoards().catch((error) => console.error('[scolia] initial board sync failed; retrying', error));
  syncInterval = setInterval(() => {
    void syncBoards().catch((error) => console.error('[scolia] board sync failed', error));
  }, BOARD_SYNC_INTERVAL_MS);
  heartbeatInterval = setInterval(() => {
    void Promise.all([...connections.values()].map((connection) => connection.heartbeat())).catch((error) =>
      console.error('[scolia] heartbeat failed', error)
    );
  }, HEARTBEAT_INTERVAL_MS);
  commandInterval = setInterval(() => {
    void Promise.all([...connections.values()].map((connection) => connection.flushCommands())).catch((error) =>
      console.error('[scolia] command flush failed', error)
    );
  }, COMMAND_POLL_INTERVAL_MS);
  commentaryInterval = setInterval(() => {
    void commentaryPublisher.flushPending().catch((error) =>
      console.error('[commentary] pending sideband delivery failed', error)
    );
  }, COMMENTARY_RETRY_INTERVAL_MS);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startScoliaWorker().catch((error) => {
    console.error('[scolia] worker failed to start', error);
    process.exit(1);
  });
}
