import { updateBullOff } from '../lib/server/bullOff.ts';
import { loadMatch as loadBullOffMatch } from '../lib/server/matchGuards.ts';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { pathToFileURL } from 'node:url';

import {
  boardStatePatchForMessage,
  occurredAtForMessage,
  parseScoliaMessage,
  reconnectDelayMs,
  type ScoliaMessage,
} from '../lib/scolia/protocol.ts';
import {
  ingestScoliaThrowEvent,
  type StoredScoliaEvent,
} from '../lib/server/scoliaThrowIngestion.ts';
import { findActiveScoliaBoardTarget } from '../lib/server/scoliaBoardTarget.ts';
import {
  staleCommandAction,
  staleCommandCutoff,
  SCOLIA_COMMAND_ACK_TIMEOUT_MS,
} from '../lib/scolia/commandRecovery.ts';
import { ScoliaRealtimeCommentaryPublisher } from '../services/scoliaRealtimeCommentaryPublisher.ts';
import { OrderedWorkQueue, WorkerNotifications } from '../lib/scolia/orderedWorkQueue.ts';

type AccountBoard = {
  name: string;
  serialNumber: string;
  isHomeSbc: boolean;
};

type StoredBoard = AccountBoard & { id: string };

const SCOLIA_REST_BASE_URL = 'https://game.scoliadarts.com';
const SCOLIA_WEBSOCKET_URL = 'wss://game.scoliadarts.com/api/v1/social';
const BOARD_SYNC_INTERVAL_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const COMMAND_POLL_INTERVAL_MS = 15_000;
const COMMENTARY_RETRY_INTERVAL_MS = 15_000;

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
  private flushingCommands = false;
  private commandRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private latestAcceptedThrowId: string | null = null;

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
    this.messageQueue = new OrderedWorkQueue((error) => {
      console.error(`[scolia] ${this.board.name}: retrying queued event`, error);
    });
    this.commentaryQueue = new OrderedWorkQueue((error) => {
      console.warn(`[commentary] ${this.board.name}: retrying delivery`, error);
    }, 2_000, 3);
  }

  start() {
    void this.connect();
  }

  get boardId() { return this.board.id; }

  async stop() {
    this.stopped = true;
    this.messageQueue.stop();
    this.commentaryQueue.stop();
    if (this.commandRecoveryTimer) clearTimeout(this.commandRecoveryTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, 'Worker stopping');
    await this.updateBoard({ worker_connection_status: 'disconnected', worker_heartbeat_at: new Date().toISOString() });
  }

  private async connect() {
    if (this.stopped) return;
    await this.updateBoard({ worker_connection_status: this.reconnectAttempt ? 'reconnecting' : 'connecting' });

    const url = new URL(SCOLIA_WEBSOCKET_URL);
    url.searchParams.set('serialNumber', this.board.serialNumber);
    url.searchParams.set('accessToken', this.accessToken);
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.addEventListener('open', () => {
      if (this.socket !== socket || this.stopped) return;
      this.reconnectAttempt = 0;
      console.info(`[scolia] ${this.board.name}: cloud connection open`);
      void this.updateBoard({ worker_connection_status: 'connected' });
      socket.send(JSON.stringify({ type: 'GET_SBC_STATUS', id: crypto.randomUUID() }));
      this.enqueue(() => this.processPendingThrows());
      this.enqueue(() => this.flushCommands());
    });

    socket.addEventListener('message', (event) => {
      if (this.socket !== socket || typeof event.data !== 'string') return;
      const message = parseScoliaMessage(event.data);
      if (!message) {
        console.warn(`[scolia] ${this.board.name}: ignored invalid message`);
        return;
      }
      this.enqueue(() => this.persistMessage(message));
    });

    socket.addEventListener('error', () => {
      console.warn(`[scolia] ${this.board.name}: cloud connection error`);
    });

    socket.addEventListener('close', (event) => {
      if (this.socket === socket) this.socket = null;
      if (this.stopped) return;
      const delay = reconnectDelayMs(event.code, this.reconnectAttempt++);
      console.warn(`[scolia] ${this.board.name}: closed (${event.code}); retrying in ${delay}ms`);
      void this.updateBoard({ worker_connection_status: 'reconnecting' });
      this.reconnectTimer = setTimeout(() => void this.connect(), delay);
    });
  }

  async heartbeat() {
    if (this.stopped) return;
    await this.updateBoard({ worker_heartbeat_at: new Date().toISOString() });
    if (this.messageQueue.idle) this.enqueue(() => this.processPendingThrows());
  }

  async flushCommands() {
    if (this.stopped || this.flushingCommands || this.socket?.readyState !== WebSocket.OPEN) return;
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
    const { data, error } = await this.supabase
      .from('scolia_events')
      .select('id, board_id, message_id, event_type, payload')
      .eq('board_id', this.board.id)
      .eq('event_type', 'THROW_DETECTED')
      .in('processing_status', ['pending', 'failed'])
      .order('id', { ascending: true });
    if (error) throw new Error(error.message);
    for (const event of (data ?? []) as StoredScoliaEvent[]) {
      const result = await ingestScoliaThrowEvent(this.supabase, event);
      if (result.status === 'processed') {
        console.info(`[scolia] ${this.board.name}: recovered throw ${event.message_id}`);
        if (result.target.kind === 'match') {
          this.publishCommentary(result.target.id, result.throwId);
        }
      }
    }
  }

  private async persistMessage(message: ScoliaMessage) {
    const now = new Date().toISOString();
    const { data: insertedEvent, error: eventError } = await this.supabase.from('scolia_events').upsert(
      {
        board_id: this.board.id,
        message_id: message.id,
        event_type: message.type,
        payload: message.payload ?? {},
        occurred_at: occurredAtForMessage(message),
        received_at: now,
      },
      { onConflict: 'board_id,message_id', ignoreDuplicates: true }
    ).select('id, board_id, message_id, event_type, payload, processing_status').maybeSingle();
    if (eventError) throw new Error(eventError.message);

    let storedEvent = insertedEvent;
    if (!storedEvent) {
      const { data, error } = await this.supabase
        .from('scolia_events')
        .select('id, board_id, message_id, event_type, payload, processing_status')
        .eq('board_id', this.board.id)
        .eq('message_id', message.id)
        .single();
      if (error || !data) throw new Error(error?.message ?? 'Could not reload Scolia event');
      storedEvent = data;
    }

    const boardUpdate = this.updateBoard({
      ...boardStatePatchForMessage(message),
      worker_connection_status: 'connected',
      worker_heartbeat_at: now,
      last_event_at: now,
    });

    const processingStatus = storedEvent.processing_status as string;
    if (message.type === 'THROW_DETECTED' && processingStatus !== 'processed' && processingStatus !== 'ignored') {
      // Persist the event first, then overlap independent status/scoring work.
      // Wait for both before advancing the board queue, even if either fails.
      const results = await Promise.allSettled([boardUpdate, (async () => {
        const result = await ingestScoliaThrowEvent(this.supabase, storedEvent as StoredScoliaEvent);
        if (result.status === 'processed') {
          console.info(`[scolia] ${this.board.name}: scored throw ${message.id}`);
          if (result.target.kind === 'match') {
            this.publishCommentary(result.target.id, result.throwId);
          }
        } else {
          console.info(`[scolia] ${this.board.name}: ignored throw ${message.id}: ${result.reason}`);
        }
      })()]);
      for (const result of results) {
        if (result.status === 'rejected') throw result.reason;
      }
      return;
    }
    await boardUpdate;
    await this.handleCommandResponse(message, now);

    if (
      processingStatus !== 'processed'
      && processingStatus !== 'ignored'
      && message.type === 'TAKEOUT_FINISHED'
      && message.payload?.falseTakeout !== true
    ) {
      const target = await findActiveScoliaBoardTarget(this.supabase, this.board.id);
      if (target?.kind === 'match') {
        const bullMatch = await loadBullOffMatch(this.supabase, target.id);
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

  private publishCommentary(matchId: string, throwId: string) {
    this.latestAcceptedThrowId = throwId;
    this.commentaryQueue.enqueue(async () => {
      await this.commentaryPublisher.publishAcceptedThrow(matchId, throwId, () => this.latestAcceptedThrowId === throwId);
    });
  }

  private async handleCommandResponse(message: ScoliaMessage, now: string) {
    if (message.type !== 'ACKNOWLEDGED' && message.type !== 'REFUSED') return;
    const replyTo = message.payload?.replyTo;
    if (typeof replyTo !== 'string') return;
    const { error } = await this.supabase
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
      .eq('status', 'sent');
    if (error) throw new Error(error.message);
  }

  private async updateBoard(values: Record<string, unknown>) {
    const { error } = await this.supabase
      .from('scolia_boards')
      .update({ ...values, updated_at: new Date().toISOString() })
      .eq('id', this.board.id);
    if (error) throw new Error(error.message);
  }
}

async function startScoliaWorker() {
  const accessToken = requiredEnvironment('SCOLIA_ACCESS_TOKEN');
  const supabaseUrl = requiredEnvironment('NEXT_PUBLIC_SUPABASE_URL');
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_SECRET_KEY?.trim();
  if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY is required');
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const commentaryPublisher = new ScoliaRealtimeCommentaryPublisher(
    supabase,
    process.env.OPENAI_API_KEY?.trim() || null
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
  const notifications = supabase.channel('scolia-worker-work')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'scolia_commands' }, (payload) => {
      notificationWork.change('commands', payload);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'commentary_realtime_sessions' }, (payload) => {
      notificationWork.change('sessions', payload);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'commentary_realtime_deliveries' }, (payload) => {
      notificationWork.change('deliveries', payload);
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') notificationWork.reconnect();
    });

  const syncBoards = async () => {
    if (stopping || syncRunning) return;
    syncRunning = true;
    try {
      const accountBoards = await fetchAccountBoards(accessToken);
      const activeSerials = new Set(accountBoards.map((board) => board.serialNumber));
      const storedBoards = await Promise.all(
        accountBoards.map(async (board): Promise<StoredBoard> => {
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

      const { data: enabledRows, error: enabledRowsError } = await supabase
        .from('scolia_boards')
        .select('serial_number')
        .eq('enabled', true);
      if (enabledRowsError) throw new Error(enabledRowsError.message);
      const missingSerials = (enabledRows ?? [])
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
    console.info(`[scolia] received ${signal}; closing connections`);
    if (syncInterval) clearInterval(syncInterval);
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    if (commandInterval) clearInterval(commandInterval);
    if (commentaryInterval) clearInterval(commentaryInterval);
    notificationWork.stop();
    await supabase.removeChannel(notifications);
    await Promise.all([...connections.values()].map((connection) => connection.stop()));
    commentaryPublisher.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await syncBoards();
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
