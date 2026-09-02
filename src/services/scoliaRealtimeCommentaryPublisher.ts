import type { SupabaseClient } from '@supabase/supabase-js';
import { WebSocket } from 'ws';

import {
  loadScoliaRealtimeDartEvent,
  ScoliaPressureEventCache,
  type ScoliaRealtimeDartEvent,
} from '../lib/commentary/scoliaRealtimeEvent.ts';
import {
  createRealtimeCommentaryCorrectionEnvelope,
  isSuccessfulRealtimeResponse,
  type ActiveRealtimeCommentarySession,
} from '../lib/commentary/realtimeTypes.ts';
import { loadRealtimeCommentarySnapshot } from '../lib/commentary/realtimeSnapshot.ts';
import {
  CommentaryPolicy,
  type CommentaryPolicyEvent,
} from '../lib/commentary/commentaryPolicy.ts';
import { buildRealtimeResponseInstructions } from '../lib/commentary/realtimePrompt.ts';
import {
  CommentaryVisitTiming,
} from '../lib/commentary/commentaryVisitTiming.ts';
import { loadMatch } from '../lib/server/matchGuards.ts';
import { BroadcastDirector } from '../lib/commentary/broadcastDirector.ts';

type DeliveryRow = {
  session_id: string;
  throw_id: string;
  status: 'pending' | 'sent' | 'failed';
  attempts: number;
};

type SidebandConnection = {
  session: ActiveRealtimeCommentarySession;
  socket: WebSocket;
  opened: Promise<void>;
  policy: CommentaryPolicy;
  visitTiming: CommentaryVisitTiming;
  broadcastDirector: BroadcastDirector;
  activeResponseId: string | null;
  responseInFlight: boolean;
};

const OPENAI_REALTIME_SIDEBAND_URL = 'wss://api.openai.com/v1/realtime';
const ACTIVE_HEARTBEAT_WINDOW_MS = 45_000;
const SESSION_LIFETIME_MS = 55 * 60_000;
const MAX_DELIVERY_ATTEMPTS = 3;

function realtimeEventId(prefix: string, id: string) {
  return `${prefix}_${id.replaceAll('-', '')}`;
}

/**
 * Sends accepted Scolia darts from the persistent worker into the browser's
 * OpenAI Realtime call. Supabase is authoritative storage, not a Realtime hop.
 */
export class ScoliaRealtimeCommentaryPublisher {
  private readonly supabase: SupabaseClient;
  private readonly apiKey: string | null;
  private readonly connections = new Map<string, SidebandConnection>();
  private readonly inFlight = new Set<string>();
  private readonly pressureCache = new ScoliaPressureEventCache();
  private readonly matchEpochs = new Map<string, number>();
  private flushingPending = false;
  private controlEventSequence = 0;

  constructor(
    supabase: SupabaseClient,
    apiKey: string | null
  ) {
    this.supabase = supabase;
    this.apiKey = apiKey;
  }

  get enabled() {
    return Boolean(this.apiKey);
  }

  async publishAcceptedThrow(matchId: string, throwId: string): Promise<void> {
    if (!this.apiKey) return;
    const sessions = await this.activeSessions(matchId);
    if (sessions.length === 0) return;
    this.observeEpochs(matchId, sessions);
    const event = await loadScoliaRealtimeDartEvent(
      this.supabase,
      matchId,
      throwId,
      this.pressureCache
    );
    await Promise.all(sessions.map(async (session) => {
      const delivery = await this.ensureDelivery(session.id, throwId);
      if (delivery.status === 'sent' || delivery.status === 'failed') return;
      await this.deliver(session, event, delivery);
    }));
  }

  async flushPending(): Promise<void> {
    if (!this.apiKey || this.flushingPending) return;
    this.flushingPending = true;
    try {
      await this.prewarmActiveSessions();
      const { data, error } = await this.supabase
        .from('commentary_realtime_deliveries')
        .select('session_id, throw_id, status, attempts')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(50);
      if (error) throw new Error(error.message);

      for (const delivery of (data ?? []) as DeliveryRow[]) {
        const session = await this.activeSession(delivery.session_id);
        if (!session) continue;
        try {
          this.observeEpochs(session.match_id, [session]);
          const event = await loadScoliaRealtimeDartEvent(
            this.supabase,
            session.match_id,
            delivery.throw_id,
            this.pressureCache
          );
          await this.deliver(session, event, delivery);
        } catch (error) {
          await this.recordFailure(delivery, error);
        }
      }
    } finally {
      this.flushingPending = false;
    }
  }

  close() {
    for (const connection of this.connections.values()) {
      connection.visitTiming.reset();
      connection.socket.close(1000, 'Scolia worker stopping');
    }
    this.connections.clear();
    this.pressureCache.clear();
    this.matchEpochs.clear();
  }

  private async activeSessions(matchId: string): Promise<ActiveRealtimeCommentarySession[]> {
    const now = Date.now();
    const { data, error } = await this.supabase
      .from('commentary_realtime_sessions')
      .select('id, match_id, openai_call_id, persona_id, voice, epoch, last_correction_id, last_correction_reason')
      .eq('match_id', matchId)
      .eq('status', 'active')
      .gte('last_seen_at', new Date(now - ACTIVE_HEARTBEAT_WINDOW_MS).toISOString())
      .gte('created_at', new Date(now - SESSION_LIFETIME_MS).toISOString());
    if (error) throw new Error(error.message);
    return (data ?? []) as ActiveRealtimeCommentarySession[];
  }

  private async prewarmActiveSessions() {
    const now = Date.now();
    const { data, error } = await this.supabase
      .from('commentary_realtime_sessions')
      .select('id, match_id, openai_call_id, persona_id, voice, epoch, last_correction_id, last_correction_reason')
      .eq('status', 'active')
      .gte('last_seen_at', new Date(now - ACTIVE_HEARTBEAT_WINDOW_MS).toISOString())
      .gte('created_at', new Date(now - SESSION_LIFETIME_MS).toISOString());
    if (error) throw new Error(error.message);
    const sessions = (data ?? []) as ActiveRealtimeCommentarySession[];
    for (const matchId of new Set(sessions.map((session) => session.match_id))) {
      this.observeEpochs(matchId, sessions.filter((session) => session.match_id === matchId));
    }
    const activeIds = new Set(sessions.map((session) => session.id));
    for (const [sessionId, connection] of this.connections) {
      if (activeIds.has(sessionId)) continue;
      this.connections.delete(sessionId);
      connection.visitTiming.reset();
      connection.socket.close(1000, 'Realtime listener expired');
    }
    await Promise.allSettled(sessions.map((session) => this.connection(session)));
  }

  private async activeSession(sessionId: string): Promise<ActiveRealtimeCommentarySession | null> {
    const now = Date.now();
    const { data, error } = await this.supabase
      .from('commentary_realtime_sessions')
      .select('id, match_id, openai_call_id, persona_id, voice, epoch, last_correction_id, last_correction_reason')
      .eq('id', sessionId)
      .eq('status', 'active')
      .gte('last_seen_at', new Date(now - ACTIVE_HEARTBEAT_WINDOW_MS).toISOString())
      .gte('created_at', new Date(now - SESSION_LIFETIME_MS).toISOString())
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as ActiveRealtimeCommentarySession | null) ?? null;
  }

  private async ensureDelivery(sessionId: string, throwId: string): Promise<DeliveryRow> {
    const { error: insertError } = await this.supabase
      .from('commentary_realtime_deliveries')
      .upsert(
        { session_id: sessionId, throw_id: throwId },
        { onConflict: 'session_id,throw_id', ignoreDuplicates: true }
      );
    if (insertError) throw new Error(insertError.message);

    const { data, error } = await this.supabase
      .from('commentary_realtime_deliveries')
      .select('session_id, throw_id, status, attempts')
      .eq('session_id', sessionId)
      .eq('throw_id', throwId)
      .single();
    if (error || !data) throw new Error(error?.message ?? 'Could not load commentary delivery');
    return data as DeliveryRow;
  }

  private async deliver(
    session: ActiveRealtimeCommentarySession,
    event: ScoliaRealtimeDartEvent,
    delivery: DeliveryRow
  ) {
    const deliveryKey = `${delivery.session_id}:${delivery.throw_id}`;
    if (this.inFlight.has(deliveryKey)) return;
    this.inFlight.add(deliveryKey);
    try {
      const connection = await this.connection(session);
      const direction = event.narrative
        ? connection.broadcastDirector.direct({
            sequence: event.narrative.sequence,
            candidates: event.narrative.storyArcCandidates,
            matchWinnerId: event.matchWon ? event.playerId : null,
          })
        : null;
      const directedEvent: ScoliaRealtimeDartEvent = direction && event.narrative
        ? {
            ...event,
            narrative: {
              ...event.narrative,
              activeStoryArc: direction.activeStoryArc,
              broadcastDirection: direction,
            },
          }
        : event;
      this.send(connection, {
        event_id: realtimeEventId('scolia_context', event.dartId),
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{
            type: 'input_text',
            text: `AUTHORITATIVE_SCOLIA_EVENT\n${JSON.stringify({ epoch: session.epoch, event: directedEvent })}`,
          }],
        },
      });

      const story = direction?.activeStoryArc ?? directedEvent.narrative?.activeStoryArc;
      const baseSignals = event.pressure?.signals ?? [];
      const signals = [
        ...baseSignals,
        ...(event.nikitaSpecial ? ['nikita_special' as const] : []),
        ...(direction?.shouldPromote ? ['story_arc' as const] : []),
      ];
      const policyPriority = direction?.shouldPromote && (event.priority === 'silent' || event.priority === 'ordinary')
        ? 'notable'
        : event.priority;
      const policyEvent: CommentaryPolicyEvent = {
        eventId: event.eventId,
        playerId: event.playerId,
        turnId: event.turnId,
        dartIndex: event.dartIndex,
        scored: event.scored,
        turnScore: event.turnScore,
        scoreBefore: event.pressure?.scoreBefore,
        checkedOut: event.checkedOut,
        busted: event.busted,
        matchWon: event.matchWon,
        priority: policyPriority,
        signals,
        storyKey: story ? `${story.kind}:${story.subjectPlayerId ?? 'match'}` : undefined,
      };
      const timingObservation = connection.visitTiming.observeDart({
        ...policyEvent,
        guaranteed: false,
      });
      if (timingObservation.cancelActiveSpeech) {
        this.cancelProviderSpeech(connection, 'visit_timing');
      }
      if (timingObservation.cancelActiveSpeech || timingObservation.suppressedPendingSpeech) {
        connection.policy.responseFinished();
      }

      const decision = connection.policy.evaluate(policyEvent);
      if (decision.shouldSpeak) {
        if (decision.interrupt) {
          connection.visitTiming.cancelSpeech();
          this.cancelProviderSpeech(connection, 'priority_interrupt');
        }
        connection.visitTiming.schedule(
          { ...policyEvent, guaranteed: decision.guaranteed },
          () => {
            try {
              this.send(connection, {
                event_id: realtimeEventId('scolia_response', event.dartId),
                type: 'response.create',
                response: {
                  output_modalities: ['audio'],
                  instructions: buildRealtimeResponseInstructions({
                    personaId: session.persona_id,
                    priority: decision.priority,
                    dartIndex: event.dartIndex,
                    turnScore: event.turnScore,
                    checkedOut: event.checkedOut,
                    busted: event.busted,
                    visitDarts: event.visitDarts,
                    nextPlayerAlreadyThrowing: timingObservation.nextPlayerAlreadyThrowing,
                    direction,
                    nikitaSpecial: event.nikitaSpecial,
                  }),
                  metadata: {
                    source: 'scolia-worker',
                    dart_id: event.dartId,
                    priority: decision.priority,
                    epoch: String(session.epoch),
                  },
                },
              });
              connection.responseInFlight = true;
              if (direction?.shouldPromote) connection.broadcastDirector.markMentioned(direction);
              return true;
            } catch (error) {
              connection.policy.responseFinished();
              console.warn(
                `[commentary] Could not dispatch timed response: ${
                  error instanceof Error ? error.message : 'unknown error'
                }`
              );
              return false;
            }
          }
        );
      }

      const { error } = await this.supabase
        .from('commentary_realtime_deliveries')
        .update({
          status: 'sent',
          attempts: delivery.attempts + 1,
          sent_at: new Date().toISOString(),
          last_error: null,
        })
        .eq('session_id', delivery.session_id)
        .eq('throw_id', delivery.throw_id)
        .eq('status', 'pending');
      if (error) throw new Error(error.message);
    } catch (error) {
      await this.recordFailure(delivery, error);
    } finally {
      this.inFlight.delete(deliveryKey);
    }
  }

  private async connection(session: ActiveRealtimeCommentarySession): Promise<SidebandConnection> {
    const existing = this.connections.get(session.id);
    if (
      existing?.session.openai_call_id === session.openai_call_id
      && existing.socket.readyState !== WebSocket.CLOSING
      && existing.socket.readyState !== WebSocket.CLOSED
    ) {
      await existing.opened;
      if (session.epoch > existing.session.epoch) {
        await this.applyCorrection(existing, session);
      } else {
        existing.session = session;
      }
      return existing;
    }
    existing?.socket.close(1000, 'Realtime call replaced');

    const url = new URL(OPENAI_REALTIME_SIDEBAND_URL);
    url.searchParams.set('call_id', session.openai_call_id);
    const socket = new WebSocket(url, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    let resolveOpen!: () => void;
    let rejectOpen!: (error: Error) => void;
    const opened = new Promise<void>((resolve, reject) => {
      resolveOpen = resolve;
      rejectOpen = reject;
    });
    const connection: SidebandConnection = {
      session,
      socket,
      opened,
      policy: new CommentaryPolicy(),
      visitTiming: new CommentaryVisitTiming(),
      broadcastDirector: new BroadcastDirector(),
      activeResponseId: null,
      responseInFlight: false,
    };
    this.connections.set(session.id, connection);

    const timeout = setTimeout(() => {
      rejectOpen(new Error('OpenAI Realtime sideband connection timed out'));
      socket.close();
    }, 10_000);
    socket.once('open', () => {
      clearTimeout(timeout);
      void this.seedConnection(connection).then(resolveOpen, (error: unknown) => {
        rejectOpen(error instanceof Error ? error : new Error('Could not seed Realtime session'));
        socket.close();
      });
    });
    socket.on('message', (raw) => {
      try {
        const event = JSON.parse(raw.toString()) as {
          type?: string;
          response?: {
            id?: string;
            status?: string;
            status_details?: { error?: { message?: string }; reason?: string };
          };
          error?: { message?: string };
        };
        if (event.type === 'response.created') {
          connection.activeResponseId = event.response?.id ?? null;
          connection.responseInFlight = true;
        }
        if (event.type === 'response.done') {
          const responseId = event.response?.id;
          if (!responseId || responseId === connection.activeResponseId) {
            connection.activeResponseId = null;
            connection.responseInFlight = false;
            connection.policy.responseFinished();
            connection.visitTiming.responseFinished();
            if (!isSuccessfulRealtimeResponse(event.response?.status) && event.response?.status !== 'cancelled') {
              console.warn(
                `[commentary] Realtime response ${event.response?.status ?? 'failed'}: ${
                  event.response?.status_details?.error?.message ??
                  event.response?.status_details?.reason ??
                  'no provider detail'
                }`
              );
            }
          }
        }
        if (event.type === 'error') {
          console.warn(`[commentary] Realtime sideband error: ${event.error?.message ?? 'unknown error'}`);
        }
      } catch {
        // Ignore malformed provider telemetry without breaking delivery.
      }
    });
    socket.once('error', (error) => {
      clearTimeout(timeout);
      rejectOpen(error);
    });
    socket.once('close', () => {
      clearTimeout(timeout);
      connection.visitTiming.reset();
      if (this.connections.get(session.id) === connection) this.connections.delete(session.id);
    });

    await opened;
    return connection;
  }

  private async seedConnection(connection: SidebandConnection) {
    const match = await loadMatch(this.supabase, connection.session.match_id);
    if (!match) throw new Error('Could not load match for Realtime snapshot');
    const snapshot = await loadRealtimeCommentarySnapshot(this.supabase, match);
    connection.broadcastDirector.reset({
      sequence: snapshot.narrative.sequence,
      candidates: snapshot.narrative.storyArcCandidates,
    });
    this.send(connection, {
      event_id: realtimeEventId('match_snapshot', connection.session.id),
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{
          type: 'input_text',
          text: `AUTHORITATIVE_MATCH_SNAPSHOT\n${JSON.stringify({ epoch: connection.session.epoch, snapshot })}`,
        }],
      },
    });
  }

  private async applyCorrection(
    connection: SidebandConnection,
    session: ActiveRealtimeCommentarySession
  ) {
    this.cancelProviderSpeech(connection, 'authoritative_correction');
    connection.policy.reset(session.epoch);
    connection.visitTiming.reset();
    connection.broadcastDirector.reset();
    connection.session = session;
    const match = await loadMatch(this.supabase, session.match_id);
    if (!match) throw new Error('Could not load corrected match snapshot');
    const snapshot = await loadRealtimeCommentarySnapshot(this.supabase, match);
    connection.broadcastDirector.reset({
      sequence: snapshot.narrative.sequence,
      candidates: snapshot.narrative.storyArcCandidates,
    });
    this.send(connection, {
      event_id: realtimeEventId('match_correction', `${session.id}-${session.epoch}`),
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{
          type: 'input_text',
          text: `AUTHORITATIVE_MATCH_CORRECTION\n${JSON.stringify(
            createRealtimeCommentaryCorrectionEnvelope({
              correctionId: session.last_correction_id ?? `worker:${session.id}:${session.epoch}`,
              reason: session.last_correction_reason ?? 'throw_updated',
              epoch: session.epoch,
              snapshot,
            })
          )}`,
        }],
      },
    });
  }

  private cancelProviderSpeech(connection: SidebandConnection, reason: string) {
    const controlId = realtimeEventId(
      reason,
      `${connection.session.id}-${++this.controlEventSequence}`
    );
    if (connection.responseInFlight) {
      this.send(connection, {
        event_id: `${controlId}_cancel`,
        type: 'response.cancel',
      });
    }
    this.send(connection, {
      event_id: `${controlId}_clear`,
      type: 'output_audio_buffer.clear',
    });
    connection.activeResponseId = null;
    connection.responseInFlight = false;
  }

  private observeEpochs(matchId: string, sessions: ActiveRealtimeCommentarySession[]) {
    const newestEpoch = sessions.reduce((latest, session) => Math.max(latest, session.epoch), 0);
    const knownEpoch = this.matchEpochs.get(matchId);
    if (knownEpoch !== undefined && newestEpoch > knownEpoch) this.pressureCache.delete(matchId);
    this.matchEpochs.set(matchId, Math.max(knownEpoch ?? 0, newestEpoch));
  }

  private send(connection: SidebandConnection, event: Record<string, unknown>) {
    if (connection.socket.readyState !== WebSocket.OPEN) {
      throw new Error('OpenAI Realtime sideband is not open');
    }
    connection.socket.send(JSON.stringify(event));
  }

  private async recordFailure(delivery: DeliveryRow, error: unknown) {
    const attempts = delivery.attempts + 1;
    const message = error instanceof Error ? error.message : 'Unknown Realtime sideband failure';
    const { error: updateError } = await this.supabase
      .from('commentary_realtime_deliveries')
      .update({
        status: attempts >= MAX_DELIVERY_ATTEMPTS ? 'failed' : 'pending',
        attempts,
        last_error: message,
      })
      .eq('session_id', delivery.session_id)
      .eq('throw_id', delivery.throw_id)
      .eq('status', 'pending');
    if (updateError) throw new Error(updateError.message);
    console.warn(`[commentary] Scolia throw ${delivery.throw_id} sideband delivery failed: ${message}`);
  }
}
