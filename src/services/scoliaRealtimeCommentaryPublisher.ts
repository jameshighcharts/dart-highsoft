import type { SupabaseClient } from '@supabase/supabase-js';
import { WebSocket } from 'ws';

import {
  loadScoliaRealtimeDartEvent,
  ScoliaDartIQEventCache,
  type ScoliaRealtimeDartEvent,
} from '../lib/commentary/scoliaRealtimeEvent.ts';
import {
  isSuccessfulRealtimeResponse,
  BROADCAST_DIRECTOR_VERSION,
  type ActiveRealtimeCommentarySession,
} from '../lib/commentary/realtimeTypes.ts';
import { loadRealtimeCommentarySnapshot } from '../lib/commentary/realtimeSnapshot.ts';
import {
  CommentaryPolicy,
  type CommentaryPolicyEvent,
} from '../lib/commentary/commentaryPolicy.ts';
import {
  buildRealtimeResponseInstructions,
  buildRealtimeVisitOpeningInstructions,
  buildRealtimeIdleInstructions,
} from '../lib/commentary/realtimePrompt.ts';
import {
  CommentaryVisitTiming,
} from '../lib/commentary/commentaryVisitTiming.ts';
import { DARTIQ_POLICY_VERSION } from '../lib/dartiq/events.ts';
import { loadMatch, isMatchActive } from '../lib/server/matchGuards.ts';
import {
  BroadcastDirector,
  storyArcKey,
  type BroadcastCallbackTrigger,
  type BroadcastDirection,
} from '../lib/commentary/broadcastDirector.ts';
import {
  RealtimeNarrativeWireState,
  renderRealtimeSnapshot,
  renderScoliaRealtimeEvent,
  renderScoliaTakeoutFinished,
} from '../lib/commentary/realtimeWireFormat.ts';
import { RealtimePlayback, hasRealtimeAudioOutput } from '../lib/commentary/realtimePlayback.ts';
import { RealtimeResponseQueue } from '../lib/commentary/realtimeResponseQueue.ts';
import { runBoundedWork } from '../lib/scolia/orderedWorkQueue.ts';

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
  wireState: RealtimeNarrativeWireState;
  playback: RealtimePlayback;
  responseQueue: RealtimeResponseQueue<Record<string, unknown>>;
  pendingStoryResponses: Map<string, WorkerStoryResponse>;
  activeStoryResponse: (WorkerStoryResponse & { responseId: string }) | null;
  transcript: string;
  openingGraceUntilMs: number;
  openingClaimedAtMs: number;
  pendingTakeoutHandoff: {
    sourceDartId: string;
    turnId: string;
    playerId: string;
    playerName: string;
    scoreRemaining: number;
  } | null;
};

type WorkerStoryResponse = {
  sourceEventId: string;
  throwId: string;
  turnId: string;
  direction: BroadcastDirection;
};

const OPENAI_REALTIME_SIDEBAND_URL = 'wss://api.openai.com/v1/realtime';
const ACTIVE_HEARTBEAT_WINDOW_MS = 45_000;
const SESSION_LIFETIME_MS = 55 * 60_000;
const MAX_DELIVERY_ATTEMPTS = 3;
const OPENING_GRACE_MS = 15_000;
const SESSION_COLUMNS = 'id, match_id, openai_call_id, persona_id, voice, epoch, last_correction_id, last_correction_reason, opening_call_claimed_at';

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
  private readonly dartIQCache = new ScoliaDartIQEventCache();
  private readonly matchEpochs = new Map<string, number>();
  private flushingPending = false;
  private controlEventSequence = 0;
  private readonly matchWork = new Map<string, Promise<void>>();

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

  private serialize<T>(matchId: string, work: () => Promise<T>): Promise<T> {
    const run = (this.matchWork.get(matchId) ?? Promise.resolve()).then(work);
    const settled = run.then(() => undefined, () => undefined);
    this.matchWork.set(matchId, settled);
    void settled.then(() => {
      if (this.matchWork.get(matchId) === settled) this.matchWork.delete(matchId);
    });
    return run;
  }

  publishAcceptedThrow(matchId: string, throwId: string, isCurrent?: () => boolean): Promise<void> {
    return this.serialize(matchId, () => this.publishAcceptedThrowNow(matchId, throwId, isCurrent));
  }

  private async publishAcceptedThrowNow(matchId: string, throwId: string, isCurrent?: () => boolean): Promise<void> {
    if (!this.apiKey) return;
    const sessions = await this.activeSessions(matchId);
    if (sessions.length === 0) return;
    this.observeEpochs(matchId, sessions);
    const event = await loadScoliaRealtimeDartEvent(
      this.supabase,
      matchId,
      throwId,
      this.dartIQCache
    );
    await Promise.all(sessions.map(async (session) => {
      const delivery = await this.ensureDelivery(session.id, throwId);
      if (delivery.status === 'sent' || delivery.status === 'failed') return;
      await this.deliver(session, event, delivery, isCurrent);
    }));
  }

  /** Announces the next visit only when Scolia confirms the board is physically clear. */
  publishTakeoutFinished(matchId: string, takeoutEventId: string, isCurrent?: () => boolean): Promise<number> {
    return this.serialize(matchId, () => this.publishTakeoutFinishedNow(matchId, takeoutEventId, isCurrent));
  }

  private async publishTakeoutFinishedNow(matchId: string, takeoutEventId: string, isCurrent?: () => boolean): Promise<number> {
    if (!this.apiKey) return 0;
    const sessions = await this.activeSessions(matchId);
    this.observeEpochs(matchId, sessions);
    const announced = await Promise.all(sessions.map(async (session) => {
      const connection = await this.connection(session);
      const handoff = connection.pendingTakeoutHandoff;
      if (!handoff || isCurrent?.() === false) return false;
      connection.pendingTakeoutHandoff = null;
      this.send(connection, {
        event_id: realtimeEventId('scolia_takeout_context', takeoutEventId),
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{
            type: 'input_text',
            text: renderScoliaTakeoutFinished({
              epoch: session.epoch,
              takeoutEventId,
              playerName: handoff.playerName,
              scoreRemaining: handoff.scoreRemaining,
            }),
          }],
        },
      });
      connection.visitTiming.scheduleIdle((isStillWaiting) => {
        void this.publishIdleCall(connection, matchId, takeoutEventId, isStillWaiting).catch((error: unknown) => {
          console.warn('[commentary] Idle call skipped:', error instanceof Error ? error.message : 'unknown error');
        });
      });
      if (!connection.policy.canStartWalkOn() || connection.responseQueue.busy || connection.playback.busy) return false;
      connection.policy.recordWalkOn();
      this.enqueueProviderResponse(connection, {
        event_id: realtimeEventId('scolia_takeout_response', takeoutEventId),
        type: 'response.create',
        response: {
          output_modalities: ['audio'],
          instructions: buildRealtimeVisitOpeningInstructions(session.persona_id),
          metadata: {
            source: 'scolia-worker-takeout',
            source_dart_id: handoff.sourceDartId,
            turn_id: handoff.turnId,
            player_id: handoff.playerId,
            priority: 'ordinary',
            epoch: String(session.epoch),
          },
        },
      });
      return true;
    }));
    return announced.filter(Boolean).length;
  }

  private async publishIdleCall(
    connection: SidebandConnection,
    matchId: string,
    takeoutEventId: string,
    isStillWaiting: () => boolean
  ) {
    const epoch = connection.session.epoch;
    if (!isStillWaiting() || !connection.policy.canStartIdleCall()) return;
    const [match, sessions] = await Promise.all([
      loadMatch(this.supabase, matchId), this.activeSessions(matchId),
    ]);
    if (!match || !isMatchActive(match) || !isStillWaiting()
      || this.connections.get(connection.session.id) !== connection
      || !sessions.some((session) => session.id === connection.session.id && session.epoch === epoch)
      || !connection.policy.canStartIdleCall() || connection.responseQueue.busy || connection.playback.busy) return;
    connection.policy.recordIdleCall();
    try {
      this.enqueueProviderResponse(connection, {
        event_id: realtimeEventId('scolia_idle_response', takeoutEventId),
        type: 'response.create',
        response: {
          output_modalities: ['audio'],
          instructions: buildRealtimeIdleInstructions(connection.session.persona_id),
          metadata: { source: 'scolia-worker-idle', priority: 'ordinary', epoch: String(epoch) },
        },
      });
    } catch (error) {
      connection.policy.responseFinished();
      throw error;
    }
  }

  async flushPending(sessionIds?: readonly string[]): Promise<void> {
    if (!this.apiKey || this.flushingPending) return;
    if (sessionIds?.length === 0) return;
    this.flushingPending = true;
    try {
      let query = this.supabase
        .from('commentary_realtime_deliveries')
        .select('session_id, throw_id, status, attempts')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(50);
      if (sessionIds) query = query.in('session_id', [...sessionIds]);
      const [sessions, { data, error }] = await Promise.all([this.loadActiveSessions(sessionIds), query]);
      if (error) throw new Error(error.message);
      const sessionById = new Map(sessions.map((session) => [session.id, session]));
      const groups = new Map<string, { sessions: ActiveRealtimeCommentarySession[]; deliveries: DeliveryRow[] }>();
      for (const session of sessions) {
        const group = groups.get(session.match_id) ?? { sessions: [], deliveries: [] };
        group.sessions.push(session);
        groups.set(session.match_id, group);
      }
      for (const delivery of (data ?? []) as DeliveryRow[]) {
        const session = sessionById.get(delivery.session_id);
        if (session) groups.get(session.match_id)!.deliveries.push(delivery);
      }
      await runBoundedWork([...groups], 4, async ([matchId, group]) => {
        await this.serialize(matchId, async () => {
          this.observeEpochs(matchId, group.sessions);
          await Promise.allSettled(group.sessions.map((session) => this.connection(session)));
          for (const delivery of group.deliveries) {
            const session = sessionById.get(delivery.session_id)!;
            try {
              const currentDelivery = await this.ensureDelivery(session.id, delivery.throw_id);
              if (currentDelivery.status !== 'pending') continue;
              const event = await loadScoliaRealtimeDartEvent(this.supabase, matchId, delivery.throw_id, this.dartIQCache);
              await this.deliver(session, event, currentDelivery);
            } catch (error) {
              await this.recordFailure(delivery, error);
            }
          }
        });
      });
    } finally {
      this.flushingPending = false;
    }
  }

  close() {
    for (const connection of this.connections.values()) {
      connection.responseQueue.reset();
      connection.playback.reset();
      connection.visitTiming.reset();
      connection.socket.close(1000, 'Scolia worker stopping');
    }
    this.connections.clear();
    this.dartIQCache.clear();
    this.matchEpochs.clear();
  }

  private async activeSessions(matchId: string): Promise<ActiveRealtimeCommentarySession[]> {
    const now = Date.now();
    const { data, error } = await this.supabase
      .from('commentary_realtime_sessions')
      .select(SESSION_COLUMNS)
      .eq('match_id', matchId)
      .eq('status', 'active')
      .gte('last_seen_at', new Date(now - ACTIVE_HEARTBEAT_WINDOW_MS).toISOString())
      .gte('created_at', new Date(now - SESSION_LIFETIME_MS).toISOString());
    if (error) throw new Error(error.message);
    return (data ?? []) as ActiveRealtimeCommentarySession[];
  }

  private async loadActiveSessions(sessionIds?: readonly string[]) {
    const now = Date.now();
    let query = this.supabase
      .from('commentary_realtime_sessions')
      .select(SESSION_COLUMNS)
      .eq('status', 'active')
      .gte('last_seen_at', new Date(now - ACTIVE_HEARTBEAT_WINDOW_MS).toISOString())
      .gte('created_at', new Date(now - SESSION_LIFETIME_MS).toISOString());
    if (sessionIds) query = query.in('id', [...sessionIds]);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const sessions = (data ?? []) as ActiveRealtimeCommentarySession[];
    const activeIds = new Set(sessions.map((session) => session.id));
    for (const [sessionId, connection] of this.connections) {
      if (sessionIds && !sessionIds.includes(sessionId)) continue;
      if (activeIds.has(sessionId)) continue;
      this.connections.delete(sessionId);
      connection.visitTiming.reset();
      connection.socket.close(1000, 'Realtime listener expired');
    }
    return sessions;
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
    delivery: DeliveryRow,
    isCurrent?: () => boolean,
  ) {
    const deliveryKey = `${delivery.session_id}:${delivery.throw_id}`;
    if (this.inFlight.has(deliveryKey)) return;
    this.inFlight.add(deliveryKey);
    try {
      // Do not let an old retry overwrite newer model context or speech policy.
      if (event.isLatestDart === false || isCurrent?.() === false) {
        await this.markDeliverySent(delivery);
        return;
      }
      const connection = await this.connection(session);
      if (isCurrent?.() === false) {
        await this.markDeliverySent(delivery);
        return;
      }
      if (event.dartIndex === 1) connection.pendingTakeoutHandoff = null;
      const resolvedMatchWinnerId = event.dartiq?.legResolution?.matchWon
        ? event.dartiq.legResolution.winnerPlayerId
        : event.matchWon
          ? event.playerId
          : null;
      const observedTriggers: BroadcastCallbackTrigger[] = [
        ...(event.dartiq?.signals.includes('favorite_change')
          ? ['probability_reversal' as const]
          : []),
        ...(event.checkedOut || event.dartiq?.semanticStakes.oneDartFinishAvailable
          ? ['next_checkout_chance' as const]
          : []),
        ...(event.checkedOut ? ['next_pressure_conversion' as const] : []),
        ...(event.dartiq?.legResolution ? ['leg_resolution' as const] : []),
        ...(event.dartiq?.legResolution?.matchWon ? ['match_resolution' as const] : []),
      ];
      const direction = connection.broadcastDirector.direct({
        sequence: event.narrative?.sequence ?? event.dartiq?.sequence ?? 0,
        candidates: event.narrative?.storyArcCandidates ?? [],
        matchWinnerId: resolvedMatchWinnerId,
        observedTriggers,
        triggerPlayerId: event.dartiq?.legResolution?.winnerPlayerId ?? event.playerId,
        rivalry: connection.wireState.observeRivalryDart(event),
      });
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
      const nextPlayer = event.dartiq?.nextPlayer;
      const visitEnded = event.dartIndex >= 3 || event.busted || event.checkedOut;
      connection.pendingTakeoutHandoff = visitEnded && nextPlayer && !event.dartiq?.legResolution
        ? {
            sourceDartId: event.dartId,
            turnId: event.turnId,
            playerId: nextPlayer.playerId,
            playerName: connection.wireState.name(nextPlayer.playerId),
            scoreRemaining: nextPlayer.scoreRemaining,
          }
        : connection.pendingTakeoutHandoff;
      this.send(connection, {
        event_id: realtimeEventId('scolia_context', event.dartId),
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{
            type: 'input_text',
            text: renderScoliaRealtimeEvent(
              session.epoch,
              directedEvent,
              connection.wireState,
              direction ?? undefined
            ),
          }],
        },
      });

      const story = direction?.activeStoryArc ?? directedEvent.narrative?.activeStoryArc;
      const baseSignals = event.dartiq?.signals ?? [];
      const signals = [
        ...baseSignals,
        ...(direction.rivalry?.stage === 'anticipate' ? ['one_dart_finish_created' as const] : []),
        ...(event.nikitaSpecial ? ['nikita_special' as const] : []),
        ...(direction?.shouldPromote ? ['story_arc' as const] : []),
      ];
      const resolvedMatchWon = resolvedMatchWinnerId !== null;
      const policyPriority = resolvedMatchWon
        ? 'terminal'
        : (direction?.shouldPromote || direction.rivalry?.stage === 'anticipate')
          && (event.priority === 'silent' || event.priority === 'ordinary')
        ? 'notable'
        : event.priority;
      const policyEvent: CommentaryPolicyEvent = {
        eventId: event.eventId,
        playerId: event.playerId,
        turnId: event.turnId,
        dartIndex: event.dartIndex,
        scored: event.scored,
        turnScore: event.turnScore,
        scoreBefore: event.dartiq?.scoreBefore,
        checkedOut: event.checkedOut,
        busted: event.busted,
        matchWon: resolvedMatchWon,
        priority: policyPriority,
        signals,
        storyKey: direction?.rivalry
          ? `${direction.rivalry.rivalry.key}:${direction.rivalry.development}`
          : story ? `${story.kind}:${story.subjectPlayerId ?? 'match'}` : undefined,
      };
      const timingObservation = connection.visitTiming.observeDart({
        ...policyEvent,
        guaranteed: false,
      });
      if (timingObservation.suppressedPendingSpeech) {
        connection.policy.responseFinished();
      }

      const decision = connection.policy.evaluate(policyEvent);
      if (direction) {
        void this.persistArcLifecycle(session, event, direction).catch((error: unknown) => {
          console.error('Could not record commentary story lifecycle:', error instanceof Error ? error.message : 'unknown error');
        });
      }
      void this.persistPolicyDecision(session, event, policyEvent, decision).catch((error: unknown) => {
        console.error(
          'Could not record DartIQ commentary policy decision:',
          error instanceof Error ? error.message : 'unknown error'
        );
      });
      if (decision.shouldSpeak) {
        if (decision.interrupt || Date.now() < connection.openingGraceUntilMs) {
          connection.visitTiming.cancelSpeech();
          this.cancelProviderSpeech(connection, decision.interrupt ? 'priority_interrupt' : 'opening_handoff');
          connection.openingGraceUntilMs = 0;
        }
        connection.visitTiming.schedule(
          { ...policyEvent, guaranteed: decision.guaranteed,
            expiresOnNextDart: direction.rivalry?.stage === 'anticipate' },
          () => {
            if (isCurrent?.() === false) {
              connection.policy.responseFinished();
              return false;
            }
            let storyToken: string | null = null;
            try {
              storyToken = direction?.rivalry
                ? `${session.epoch}:${event.eventId}:${direction.rivalry.rivalry.key}`
                : direction?.shouldPromote && direction.activeStoryArc
                ? `${session.epoch}:${event.eventId}:${storyArcKey(direction.activeStoryArc)}`
                : null;
              if (storyToken && direction) {
                connection.pendingStoryResponses.set(storyToken, {
                  sourceEventId: event.eventId,
                  throwId: event.dartId,
                  turnId: event.turnId,
                  direction,
                });
              }
              this.enqueueProviderResponse(connection, {
                event_id: realtimeEventId('scolia_response', event.dartId),
                type: 'response.create',
                response: {
                  output_modalities: ['audio'],
                  instructions: buildRealtimeResponseInstructions({
                    eventId: event.eventId,
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
                    legResolved: Boolean(event.dartiq?.legResolution),
                    nextLegAvailable: Boolean(event.dartiq?.legResolution?.nextLeg),
                    // Hardware handoff is a later TAKEOUT_FINISHED event.
                    nextPlayerAvailable: false,
                    historicalFocus: event.dartIndex === 3
                      && Boolean(connection.wireState.historicalCandidateForDart(event)),
                  }),
                  metadata: {
                    source: 'scolia-worker',
                    dart_id: event.dartId,
                    priority: decision.priority,
                    epoch: String(session.epoch),
                    ...(storyToken ? { story_token: storyToken } : {}),
                  },
                },
              }, { ...policyEvent, guaranteed: decision.guaranteed,
                expiresOnNextDart: direction.rivalry?.stage === 'anticipate' });
              // A queued introduction has spent its editorial beat even if a
              // fresher dart interrupts the audio. Callback fulfilment still
              // waits for a genuinely completed response.
              if (direction?.rivalry) {
                connection.wireState.rivalry.dispatched(direction.rivalry);
              } else if (direction?.shouldPromote) {
                connection.broadcastDirector.markMentioned(direction);
              }
              return true;
            } catch (error) {
              if (storyToken) connection.pendingStoryResponses.delete(storyToken);
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

      await this.markDeliverySent(delivery);
    } catch (error) {
      await this.recordFailure(delivery, error);
    } finally {
      this.inFlight.delete(deliveryKey);
    }
  }

  private async markDeliverySent(delivery: DeliveryRow) {
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
  }

  private async persistPolicyDecision(
    session: ActiveRealtimeCommentarySession,
    event: ScoliaRealtimeDartEvent,
    policyEvent: CommentaryPolicyEvent,
    decision: ReturnType<CommentaryPolicy['evaluate']>
  ) {
    const result = await this.supabase
      .from('dartiq_commentary_policy_decisions')
      .upsert({
        session_id: session.id,
        match_id: session.match_id,
        throw_id: event.dartId,
        turn_id: event.turnId,
        source_event_id: policyEvent.eventId,
        epoch: session.epoch,
        channel: 'scolia_worker',
        policy_version: DARTIQ_POLICY_VERSION,
        priority: decision.priority,
        signals: policyEvent.signals,
        should_speak: decision.shouldSpeak,
        guaranteed: decision.guaranteed,
        interrupt: decision.interrupt,
        reason: decision.reason,
        evaluated_at: new Date().toISOString(),
      }, {
        onConflict: 'session_id,epoch,source_event_id,policy_version',
        ignoreDuplicates: true,
      });
    if (result.error) {
      console.error('Could not record DartIQ commentary policy decision:', result.error.message);
    }
  }

  private async persistArcLifecycle(
    session: ActiveRealtimeCommentarySession,
    event: ScoliaRealtimeDartEvent,
    direction: BroadcastDirection
  ) {
    if (direction.lifecycleEvents.length === 0) return;
    const occurredAt = new Date().toISOString();
    const rows = direction.lifecycleEvents.map((lifecycle) => ({
      session_id: session.id,
      match_id: session.match_id,
      throw_id: event.dartId,
      turn_id: event.turnId,
      source_event_id: event.eventId,
      epoch: session.epoch,
      sequence: direction.sequence,
      channel: 'scolia_worker',
      director_version: BROADCAST_DIRECTOR_VERSION,
      arc_key: lifecycle.arcKey,
      arc_kind: lifecycle.arc.kind,
      subject_player_id: lifecycle.arc.subjectPlayerId,
      counterpart_player_id: lifecycle.arc.counterpartPlayerId,
      lifecycle_event: lifecycle.type,
      close_reason: lifecycle.closeReason ?? null,
      phase: lifecycle.arc.phase,
      treatment: lifecycle.arc.treatment,
      strength: lifecycle.arc.strength,
      callback_trigger: lifecycle.callbackTrigger,
      evidence: lifecycle.arc.evidence,
      occurred_at: occurredAt,
    }));
    const result = await this.supabase.from('dartiq_commentary_arc_events').upsert(rows, {
      onConflict: 'session_id,epoch,source_event_id,arc_key,lifecycle_event',
      ignoreDuplicates: true,
    });
    if (result.error) throw new Error(result.error.message);
  }

  private async persistArcResponseCompleted(
    session: ActiveRealtimeCommentarySession,
    story: WorkerStoryResponse & { responseId: string },
    transcript: string
  ) {
    const arc = story.direction.activeStoryArc;
    const trigger = story.direction.callback?.trigger;
    if (!arc || !trigger) return;
    const base = {
      session_id: session.id,
      match_id: session.match_id,
      throw_id: story.throwId,
      turn_id: story.turnId,
      source_event_id: story.sourceEventId,
      epoch: session.epoch,
      sequence: story.direction.sequence,
      channel: 'scolia_worker',
      director_version: BROADCAST_DIRECTOR_VERSION,
      arc_key: storyArcKey(arc),
      arc_kind: arc.kind,
      subject_player_id: arc.subjectPlayerId,
      counterpart_player_id: arc.counterpartPlayerId,
      phase: arc.phase,
      treatment: arc.treatment,
      strength: arc.strength,
      callback_trigger: trigger,
      evidence: arc.evidence,
      occurred_at: new Date().toISOString(),
    };
    const rows: Record<string, unknown>[] = [{
      ...base,
      lifecycle_event: 'response_completed',
      close_reason: null,
      provider_response_id: story.responseId,
      transcript,
    }];
    const result = await this.supabase.from('dartiq_commentary_arc_events').upsert(rows, {
      onConflict: 'session_id,epoch,source_event_id,arc_key,lifecycle_event',
      ignoreDuplicates: true,
    });
    if (result.error) throw new Error(result.error.message);
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
        if (session.opening_call_claimed_at) {
          const claimedAt = new Date(session.opening_call_claimed_at).getTime();
          const graceUntil = claimedAt + OPENING_GRACE_MS;
          if (claimedAt > existing.openingClaimedAtMs) {
            existing.openingClaimedAtMs = claimedAt;
            existing.openingGraceUntilMs = graceUntil;
            existing.policy.recordAmbientCall(claimedAt);
          }
        }
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
      wireState: new RealtimeNarrativeWireState(),
      playback: new RealtimePlayback(),
      responseQueue: new RealtimeResponseQueue({
        eventId: (event) => typeof event.event_id === 'string' ? event.event_id : null,
        onTimeout: () => {
          connection.visitTiming.reset();
          connection.policy.responseFinished();
          try {
            this.send(connection, { type: 'response.cancel' });
            this.send(connection, { type: 'output_audio_buffer.clear' });
          } catch {
            // A dead transport cannot cancel; replacing it is the recovery path.
          } finally {
            socket.close(1011, 'Response lifecycle timed out');
          }
        },
      }),
      pendingStoryResponses: new Map(),
      activeStoryResponse: null,
      transcript: '',
      openingGraceUntilMs: session.opening_call_claimed_at
        ? new Date(session.opening_call_claimed_at).getTime() + OPENING_GRACE_MS
        : 0,
      openingClaimedAtMs: session.opening_call_claimed_at
        ? new Date(session.opening_call_claimed_at).getTime()
        : 0,
      pendingTakeoutHandoff: null,
    };
    if (session.opening_call_claimed_at) {
      connection.policy.recordAmbientCall(new Date(session.opening_call_claimed_at).getTime());
    }
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
          delta?: string;
          transcript?: string;
          response_id?: string;
          response?: {
            id?: string;
            status?: string;
            output?: { content?: { type?: string }[] }[];
            metadata?: Record<string, string>;
            status_details?: { error?: { message?: string }; reason?: string };
          };
          error?: { message?: string; event_id?: string };
        };
        if (event.type === 'response.created') {
          const responseId = event.response?.id ?? null;
          connection.playback.created(responseId);
          const cancellation = connection.responseQueue.markCreated(responseId);
          if (cancellation.shouldCancel) this.sendProviderCancellation(connection);
          connection.transcript = '';
          const storyToken = event.response?.metadata?.story_token;
          const pendingStory = storyToken
            ? connection.pendingStoryResponses.get(storyToken)
            : undefined;
          if (storyToken) connection.pendingStoryResponses.delete(storyToken);
          connection.activeStoryResponse = responseId && pendingStory
            ? { ...pendingStory, responseId }
            : null;
          if (responseId && pendingStory?.direction.rivalry) {
            connection.wireState.rivalry.responseCreated(responseId, pendingStory.direction.rivalry);
          }
        }
        if (
          event.type === 'response.output_audio_transcript.delta'
          && (!event.response_id || event.response_id === connection.responseQueue.responseId)
          && event.delta
        ) {
          connection.transcript += event.delta;
        }
        if (
          event.type === 'response.output_audio_transcript.done'
          && (!event.response_id || event.response_id === connection.responseQueue.responseId)
          && event.transcript
        ) {
          connection.transcript = event.transcript;
        }
        if (event.type === 'output_audio_buffer.stopped' || event.type === 'output_audio_buffer.cleared') {
          connection.wireState.rivalry.playbackStopped(
            event.response_id, event.type === 'output_audio_buffer.cleared'
          );
          if (connection.playback.stopped(event.response_id) && !connection.responseQueue.busy) {
            connection.visitTiming.finishSpeech();
            connection.policy.responseFinished();
          }
        }
        if (event.type === 'response.done') {
          const responseId = event.response?.id;
          const completion = connection.responseQueue.complete(responseId);
          if (completion.handled) {
            const completed = isSuccessfulRealtimeResponse(event.response?.status);
            connection.playback.generationFinished(responseId, completed && !completion.discarded
              && hasRealtimeAudioOutput(event.response));
            const completedTranscript = connection.transcript.trim();
            connection.wireState.rivalry.generationFinished(
              responseId, completedTranscript,
              completed && !completion.discarded && hasRealtimeAudioOutput(event.response)
            );
            const completedStory = connection.activeStoryResponse;
            if (
              !completion.discarded
              && completed
              && completedTranscript
              && completedStory
              && !completedStory.direction.rivalry
              && (!responseId || responseId === completedStory.responseId)
            ) {
              connection.broadcastDirector.markResponseCompleted(
                completedStory.direction
              );
              void this.persistArcResponseCompleted(
                connection.session,
                completedStory,
                completedTranscript
              ).catch((error: unknown) => {
                console.error('Could not record completed story response:', error instanceof Error ? error.message : 'unknown error');
              });
            }
            connection.activeStoryResponse = null;
            connection.transcript = '';
            if (completion.next) {
              try {
                this.send(connection, completion.next);
              } catch (error) {
                connection.responseQueue.sendFailed();
                connection.policy.responseFinished();
                console.warn(`[commentary] Could not dispatch queued response: ${
                  error instanceof Error ? error.message : 'unknown error'
                }`);
              }
            } else if (!connection.playback.busy) {
              connection.visitTiming.finishSpeech();
              connection.policy.responseFinished();
            }
            if (!completion.discarded && !completed && event.response?.status !== 'cancelled') {
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
          const rejection = connection.responseQueue.reject(event.error?.event_id);
          if (rejection.handled) {
            if (!rejection.next) connection.pendingStoryResponses.clear();
            connection.activeStoryResponse = null;
            connection.transcript = '';
            if (rejection.next) {
              try {
                this.send(connection, rejection.next);
              } catch {
                connection.responseQueue.sendFailed();
                socket.close(1011, 'Could not send replacement response');
              }
            } else {
              connection.policy.responseFinished();
            }
          }
          const message = event.error?.message ?? 'unknown error';
          // Realtime can finish a response between our cancellation request
          // and the provider processing it. response.done still reconciles
          // the queue, so the resulting no-active-response error is harmless.
          if (!message.includes('Cancellation failed: no active response found')) {
            console.warn(`[commentary] Realtime sideband error: ${message}`);
          }
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
      rejectOpen(new Error('Realtime sideband closed before becoming ready'));
      connection.responseQueue.reset();
      connection.playback.reset();
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
          text: renderRealtimeSnapshot(connection.session.epoch, snapshot, connection.wireState),
        }],
      },
    });
  }

  private async applyCorrection(
    connection: SidebandConnection,
    session: ActiveRealtimeCommentarySession
  ) {
    this.cancelProviderSpeech(connection, 'authoritative_correction');
    connection.wireState.rivalry.reset(null);
    connection.policy.reset(session.epoch);
    connection.visitTiming.reset();
    connection.broadcastDirector.reset();
    connection.pendingTakeoutHandoff = null;
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
          text: `AUTHORITATIVE CORRECTION · ${session.last_correction_reason ?? 'throw updated'}\n${renderRealtimeSnapshot(session.epoch, snapshot, connection.wireState)}`,
        }],
      },
    });
  }

  private cancelProviderSpeech(connection: SidebandConnection, reason: string) {
    connection.wireState.rivalry.cancelPending();
    connection.visitTiming.finishSpeech();
    const controlId = realtimeEventId(
      reason,
      `${connection.session.id}-${++this.controlEventSequence}`
    );
    connection.playback.reset();
    const cancellation = connection.responseQueue.requestCancellation();
    if (cancellation.shouldCancel) {
      this.sendProviderCancellation(connection, `${controlId}_cancel`);
    }
    this.send(connection, {
      event_id: `${controlId}_clear`,
      type: 'output_audio_buffer.clear',
    });
    connection.pendingStoryResponses.clear();
    connection.activeStoryResponse = null;
    connection.transcript = '';
  }

  private enqueueProviderResponse(
    connection: SidebandConnection,
    event: Record<string, unknown>,
    speechEvent?: Parameters<CommentaryVisitTiming['trackSpeech']>[0]
  ) {
    connection.visitTiming.trackSpeech(speechEvent ?? {
      eventId: String(event.event_id ?? 'ambient'), turnId: 'ambient', playerId: '',
      dartIndex: 3, priority: 'ordinary', guaranteed: false,
    }, () => {
      try {
        this.cancelProviderSpeech(connection, 'stale_speech');
      } catch {
        connection.socket.close(1011, 'Could not discard stale speech');
      } finally {
        connection.policy.responseFinished();
      }
    });
    const immediate = connection.responseQueue.enqueue(event);
    if (!immediate) return;
    try {
      this.send(connection, immediate);
    } catch (error) {
      connection.visitTiming.finishSpeech();
      connection.responseQueue.sendFailed();
      throw error;
    }
  }

  private sendProviderCancellation(connection: SidebandConnection, eventId?: string) {
    this.send(connection, {
      event_id: eventId ?? realtimeEventId(
        'deferred_cancel',
        `${connection.session.id}-${++this.controlEventSequence}`
      ),
      type: 'response.cancel',
    });
  }

  private observeEpochs(matchId: string, sessions: ActiveRealtimeCommentarySession[]) {
    const newestEpoch = sessions.reduce((latest, session) => Math.max(latest, session.epoch), 0);
    const knownEpoch = this.matchEpochs.get(matchId);
    if (knownEpoch !== undefined && newestEpoch > knownEpoch) this.dartIQCache.delete(matchId);
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
