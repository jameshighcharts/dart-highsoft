import type { CommentaryPersonaId } from '@/lib/commentary/types';
import {
  CommentaryPolicy,
  type CommentaryPolicyEvent,
} from '@/lib/commentary/commentaryPolicy';
import {
  buildRealtimeOpeningInstructions,
  buildRealtimeResponseInstructions,
} from '@/lib/commentary/realtimePrompt';
import {
  isSuccessfulRealtimeResponse,
  type RealtimeCommentaryCorrectionReason,
  type RealtimeCommentaryCorrectionResponse,
  type RealtimeCommentarySessionRequest,
  type RealtimeCommentarySessionResponse,
} from '@/lib/commentary/realtimeTypes';
import {
  CommentaryVisitTiming,
} from '@/lib/commentary/commentaryVisitTiming';
import type { CommentaryContext } from '@/services/commentaryService';
import type { VoiceOption } from '@/services/ttsService';
import {
  BroadcastDirector,
  storyArcKey,
  type BroadcastCallbackTrigger,
  type BroadcastDirection,
} from '@/lib/commentary/broadcastDirector';
import { DARTIQ_POLICY_VERSION, isMaterialDartIQConsequence } from '@/lib/dartiq/events';
import {
  RealtimeNarrativeWireState,
  renderManualRealtimeEvent,
  renderRealtimeSnapshot,
} from '@/lib/commentary/realtimeWireFormat';
import { RealtimePlayback, hasRealtimeAudioOutput } from '../lib/commentary/realtimePlayback.ts';
import { RealtimeResponseQueue } from '@/lib/commentary/realtimeResponseQueue';

export type RealtimeCommentaryStatus = 'idle' | 'connecting' | 'ready' | 'failed';

type RealtimeServerEvent = {
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

type PendingStoryResponse = {
  sourceEventId: string;
  turnId?: string;
  direction: BroadcastDirection;
};

type RealtimeCommentaryCallbacks = {
  onStatus?: (status: RealtimeCommentaryStatus) => void;
  onTranscript?: (transcript: string) => void;
  onTranscriptComplete?: (transcript: string) => void;
  onPlaying?: (playing: boolean) => void;
  onError?: (error: Error) => void;
};

type ConnectOptions = {
  matchId: string;
  personaId: CommentaryPersonaId;
  voice: VoiceOption;
};

const SESSION_URL = '/api/commentary/realtime/session';
const HEARTBEAT_INTERVAL_MS = 20_000;

function createClientInstanceId(): string {
  const storageKey = 'realtime-commentary-client-id';
  try {
    const saved = sessionStorage.getItem(storageKey);
    if (saved) return saved;
    const created = crypto.randomUUID();
    sessionStorage.setItem(storageKey, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

/** Browser WebRTC transport. Audio remains OpenAI -> browser even when the worker controls the session. */
export class RealtimeCommentaryService {
  private readonly callbacks: RealtimeCommentaryCallbacks;
  private peer: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private audio: HTMLAudioElement | null = null;
  private audioContext: AudioContext | null = null;
  private audioSource: MediaStreamAudioSourceNode | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private sessionId: string | null = null;
  private matchId: string | null = null;
  private personaId: CommentaryPersonaId = 'chad';
  private epoch = 0;
  private transcript = '';
  private readonly playback = new RealtimePlayback();
  private readonly responseQueue = new RealtimeResponseQueue<Record<string, unknown>>({
    eventId: (event) => typeof event.event_id === 'string' ? event.event_id : null,
    onTimeout: () => {
      this.sendProviderCancellation();
      void this.closeTransport(true).then(() => this.setStatus('failed'));
    },
  });
  private openingResponseInFlight = false;
  private readonly pendingStoryResponses = new Map<string, PendingStoryResponse>();
  private activeStoryResponse: (PendingStoryResponse & { responseId: string }) | null = null;
  private readonly discardedResponseIds = new Set<string>();
  private status: RealtimeCommentaryStatus = 'idle';
  private readonly policy = new CommentaryPolicy();
  private readonly visitTiming = new CommentaryVisitTiming();
  private readonly broadcastDirector = new BroadcastDirector();
  private readonly wireState = new RealtimeNarrativeWireState();
  private correctionQueue: Promise<void> = Promise.resolve();

  constructor(callbacks: RealtimeCommentaryCallbacks = {}) {
    this.callbacks = callbacks;
  }

  getStatus() {
    return this.status;
  }

  /** Resume a dedicated output context inside the user's settings click. */
  async unlock(): Promise<void> {
    this.audioContext ??= new AudioContext();
    if (this.audioContext.state !== 'running') await this.audioContext.resume();
    if (this.audio?.srcObject) {
      await this.audio.play().catch(() => {
        // The running AudioContext remains the fallback output path.
      });
    }
  }

  async connect(options: ConnectOptions): Promise<void> {
    await this.close();
    this.setStatus('connecting');
    this.matchId = options.matchId;
    this.personaId = options.personaId;

    try {
      const peer = new RTCPeerConnection();
      let disconnectedTimer: ReturnType<typeof setTimeout> | null = null;
      peer.addEventListener('connectionstatechange', () => {
        if (this.peer !== peer) return;
        if (peer.connectionState === 'connected') {
          if (disconnectedTimer) clearTimeout(disconnectedTimer);
          disconnectedTimer = null;
          return;
        }
        if (peer.connectionState === 'failed' || peer.connectionState === 'closed') {
          this.setStatus('failed');
          void this.closeTransport(true);
          return;
        }
        if (peer.connectionState === 'disconnected' && !disconnectedTimer) {
          disconnectedTimer = setTimeout(() => {
            if (this.peer === peer && peer.connectionState === 'disconnected') {
              this.setStatus('failed');
              void this.closeTransport(true);
            }
          }, 3_000);
        }
      });
      const audio = document.createElement('audio');
      audio.autoplay = true;
      audio.setAttribute('playsinline', 'true');
      peer.ontrack = (event) => {
        const stream = event.streams[0] ?? new MediaStream([event.track]);
        audio.srcObject = stream;
        void audio.play().then(() => {
          // Native WebRTC media playback is the primary path. Avoid doubling it
          // through Web Audio when autoplay succeeds.
          this.audioSource?.disconnect();
          this.audioSource = null;
        }).catch(() => {
          if (this.audioContext?.state !== 'running') return;
          this.audioSource?.disconnect();
          this.audioSource = this.audioContext.createMediaStreamSource(stream);
          this.audioSource.connect(this.audioContext.destination);
        });
      };
      peer.addTransceiver('audio', { direction: 'recvonly' });

      const channel = peer.createDataChannel('oai-events');
      channel.addEventListener('message', (event) => this.handleEvent(event.data));
      channel.addEventListener('close', () => {
        if (this.peer === peer) {
          this.setStatus('failed');
          void this.closeTransport(true);
        }
      });

      this.peer = peer;
      this.channel = channel;
      this.audio = audio;

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      if (!offer.sdp) throw new Error('Browser did not create a WebRTC offer');

      const request: RealtimeCommentarySessionRequest = {
        matchId: options.matchId,
        clientInstanceId: createClientInstanceId(),
        offerSdp: offer.sdp,
        personaId: options.personaId,
        voice: options.voice,
      };
      const response = await fetch(SESSION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const payload = (await response.json()) as RealtimeCommentarySessionResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Could not create realtime commentary session');

      this.sessionId = payload.sessionId;
      this.epoch = payload.epoch;
      this.policy.reset(payload.epoch);
      // Keep local fallback history ready even when the worker sends the snapshot.
      this.wireState.reset(payload.snapshot);
      this.broadcastDirector.reset({
        sequence: payload.snapshot.narrative.sequence,
        candidates: payload.snapshot.narrative.storyArcCandidates,
      });
      await peer.setRemoteDescription({ type: 'answer', sdp: payload.answerSdp });
      await this.waitForChannel(channel);
      if (payload.snapshotSource === 'browser' || payload.openingCallClaimed) {
        this.sendSnapshot(payload.snapshot);
      }
      if (payload.openingCallClaimed) this.requestOpeningCall();
      this.setStatus('ready');
      this.startHeartbeat();
    } catch (error) {
      const failure = error instanceof Error ? error : new Error('Realtime commentary connection failed');
      this.setStatus('failed');
      this.callbacks.onError?.(failure);
      await this.closeTransport(false);
      throw failure;
    }
  }

  commentate(context: CommentaryContext): boolean {
    const eventId = context.turnId ?? crypto.randomUUID();
    const resolvedWinnerId = context.dartiq?.legResolution?.matchWon
      ? context.dartiq.legResolution.winnerPlayerId
      : null;
    const observedTriggers: BroadcastCallbackTrigger[] = [
      ...(context.dartiq?.changedMatchFavorite ? ['probability_reversal' as const] : []),
      ...(context.dartiq?.checkedOut || context.dartiq?.oneDartFinishAvailable
        ? ['next_checkout_chance' as const]
        : []),
      ...(context.dartiq?.checkedOut ? ['next_pressure_conversion' as const] : []),
      ...(context.dartiq?.legResolution ? ['leg_resolution' as const] : []),
      ...(context.dartiq?.legResolution?.matchWon ? ['match_resolution' as const] : []),
    ];
    const direction = this.broadcastDirector.direct({
      sequence: context.narrative?.sequence ?? 0,
      candidates: context.narrative?.storyArcCandidates ?? [],
      matchWinnerId: resolvedWinnerId,
      observedTriggers,
      triggerPlayerId: context.dartiq?.legResolution?.winnerPlayerId ?? context.playerId,
      rivalry: this.wireState.observeRivalryVisit(context),
    });
    const directedContext: CommentaryContext = direction && context.narrative
      ? {
          ...context,
          narrative: {
            ...context.narrative,
            activeStoryArc: direction.activeStoryArc,
            broadcastDirection: direction,
          },
        }
      : context;
    if (!this.send({
      event_id: `commentary-context-${eventId}`,
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{
          type: 'input_text',
          text: renderManualRealtimeEvent(
            this.epoch,
            directedContext,
            this.wireState,
            direction ?? undefined
          ),
        }],
      },
    })) return false;
    if (direction) this.recordArcLifecycle(direction, eventId, context.turnId);

    const policyEvent = this.manualPolicyEvent(eventId, directedContext);
    const timingObservation = this.visitTiming.observeDart({
      ...policyEvent,
      guaranteed: false,
    });
    if (timingObservation.suppressedPendingSpeech) {
      this.policy.responseFinished();
    }
    const decision = this.policy.evaluate(policyEvent);
    this.recordPolicyDecision(policyEvent, decision, context.turnId);
    if (!decision.shouldSpeak) return true;
    if (this.openingResponseInFlight) {
      this.openingResponseInFlight = false;
      this.visitTiming.cancelSpeech();
      this.clearProviderSpeech();
    }
    if (decision.interrupt) {
      this.visitTiming.cancelSpeech();
      this.clearProviderSpeech();
    }
    const timingEvent = { ...policyEvent, guaranteed: decision.guaranteed };
    this.visitTiming.schedule(timingEvent, () => {
      this.transcript = '';
      this.callbacks.onPlaying?.(true);
      const storyToken = direction?.rivalry
        ? `${this.epoch}:${eventId}:${direction.rivalry.rivalry.key}`
        : direction?.shouldPromote && direction.activeStoryArc
        ? `${this.epoch}:${eventId}:${storyArcKey(direction.activeStoryArc)}`
        : null;
      if (storyToken && direction) {
        this.pendingStoryResponses.set(storyToken, {
          sourceEventId: eventId,
          ...(context.turnId ? { turnId: context.turnId } : {}),
          direction,
        });
      }
      const sent = this.enqueueProviderResponse({
        event_id: `commentary-response-${eventId}`,
        type: 'response.create',
        response: {
          output_modalities: ['audio'],
          instructions: buildRealtimeResponseInstructions({
            eventId,
            personaId: this.personaId,
            priority: decision.priority,
            dartIndex: policyEvent.dartIndex,
            turnScore: policyEvent.turnScore,
            checkedOut: policyEvent.checkedOut,
            busted: policyEvent.busted,
            visitDarts: directedContext.throws,
            nextPlayerAlreadyThrowing: timingObservation.nextPlayerAlreadyThrowing,
            direction: directedContext.narrative?.broadcastDirection,
            nikitaSpecial: directedContext.isNikitaSpecial,
            fairEndingPending: Boolean(directedContext.dartiq?.fairEnding && ['completing_round', 'tiebreak'].includes(directedContext.dartiq!.fairEnding!.phase)),
            legResolved: Boolean(directedContext.dartiq?.legResolution),
            nextLegAvailable: Boolean(directedContext.dartiq?.legResolution?.nextLeg),
            nextPlayerAvailable: Boolean(directedContext.dartiq?.nextOpponentThreat),
          }),
          metadata: {
            source: 'browser',
            epoch: String(this.epoch),
            priority: decision.priority,
            ...(storyToken ? { story_token: storyToken } : {}),
          },
        },
      });
      if (!sent && storyToken) this.pendingStoryResponses.delete(storyToken);
      if (sent && direction?.rivalry) {
        this.wireState.rivalry.dispatched(direction.rivalry);
      } else if (sent && direction?.shouldPromote) {
        this.broadcastDirector.markMentioned(direction);
      }
      return sent;
    });
    return true;
  }

  /** Observe every accepted browser-side dart, including darts that do not earn speech. */
  observeMatchDart(input: {
    eventId: string;
    turnId: string;
    playerId?: string;
    dartIndex: number;
  }) {
    const observation = this.visitTiming.observeDart({
      ...input,
      playerId: input.playerId ?? 'unknown',
      priority: 'silent',
      guaranteed: false,
    });
    if (observation.suppressedPendingSpeech) {
      this.policy.responseFinished();
    }
  }

  correct(reason: RealtimeCommentaryCorrectionReason) {
    this.cancelSpeech();
    this.wireState.rivalry.reset(null);
    const sessionId = this.sessionId;
    const matchId = this.matchId;
    if (!sessionId || !matchId || this.status !== 'ready') return;
    const correctionId = crypto.randomUUID();
    this.correctionQueue = this.correctionQueue.then(async () => {
      const response = await fetch(SESSION_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, matchId, correctionId, reason }),
      });
      const payload = (await response.json()) as RealtimeCommentaryCorrectionResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Could not correct realtime commentary');
      if (this.sessionId !== sessionId || this.matchId !== matchId) return;
      this.epoch = payload.epoch;
      this.policy.reset(payload.epoch);
      this.broadcastDirector.reset({
        sequence: payload.snapshot.narrative.sequence,
        candidates: payload.snapshot.narrative.storyArcCandidates,
      });
      this.transcript = '';
      this.callbacks.onTranscript?.('');
      if (!this.send({
        event_id: `commentary-correction-${correctionId}`,
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{
            type: 'input_text',
            text: `AUTHORITATIVE CORRECTION · ${reason.replaceAll('_', ' ')}\n${renderRealtimeSnapshot(payload.epoch, payload.snapshot, this.wireState)}`,
          }],
        },
      })) throw new Error('Realtime correction data channel was not ready');
    }).catch((error: unknown) => {
      this.callbacks.onError?.(
        error instanceof Error ? error : new Error('Realtime commentary correction failed')
      );
    });
  }

  private sendSnapshot(snapshot: RealtimeCommentarySessionResponse['snapshot']) {
    if (!this.send({
      event_id: `commentary-snapshot-${crypto.randomUUID()}`,
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{
          type: 'input_text',
          text: renderRealtimeSnapshot(this.epoch, snapshot, this.wireState),
        }],
      },
    })) {
      throw new Error('Realtime snapshot data channel was not ready');
    }
  }

  private requestOpeningCall() {
    const sent = this.enqueueProviderResponse({
      event_id: `commentary-opening-${crypto.randomUUID()}`,
      type: 'response.create',
      response: {
        output_modalities: ['audio'],
        instructions: buildRealtimeOpeningInstructions(this.personaId),
        metadata: { source: 'browser-opening', epoch: String(this.epoch), priority: 'ordinary' },
      },
    });
    if (sent) {
      this.openingResponseInFlight = true;
      this.policy.recordAmbientCall(Date.now(), true);
      this.callbacks.onPlaying?.(true);
    }
  }

  skip() {
    this.cancelSpeech();
  }

  async close(): Promise<void> {
    await this.closeTransport(true);
    this.setStatus('idle');
  }

  async dispose(): Promise<void> {
    await this.close();
    this.audioSource?.disconnect();
    this.audioSource = null;
    await this.audioContext?.close();
    this.audioContext = null;
  }

  private async waitForChannel(channel: RTCDataChannel): Promise<void> {
    if (channel.readyState === 'open') return;
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('Realtime data channel timed out')), 10_000);
      channel.addEventListener('open', () => {
        window.clearTimeout(timeout);
        resolve();
      }, { once: true });
      channel.addEventListener('error', () => {
        window.clearTimeout(timeout);
        reject(new Error('Realtime data channel failed'));
      }, { once: true });
    });
  }

  private send(event: Record<string, unknown>): boolean {
    if (this.channel?.readyState !== 'open') return false;
    this.channel.send(JSON.stringify(event));
    return true;
  }

  private handleEvent(raw: unknown) {
    if (typeof raw !== 'string') return;
    let event: RealtimeServerEvent;
    try {
      event = JSON.parse(raw) as RealtimeServerEvent;
    } catch {
      return;
    }

    if (event.type === 'response.created') {
      const responseId = event.response?.id ?? null;
      this.playback.created(responseId);
      const cancellation = this.responseQueue.markCreated(responseId);
      if (cancellation.discardedResponseId) {
        this.rememberDiscardedResponse(cancellation.discardedResponseId);
      }
      if (cancellation.shouldCancel) this.sendProviderCancellation();
      const storyToken = event.response?.metadata?.story_token;
      const pendingStory = storyToken ? this.pendingStoryResponses.get(storyToken) : undefined;
      if (storyToken) this.pendingStoryResponses.delete(storyToken);
      this.activeStoryResponse = responseId && pendingStory
        ? { ...pendingStory, responseId }
        : null;
      if (responseId && pendingStory?.direction.rivalry) {
        this.wireState.rivalry.responseCreated(responseId, pendingStory.direction.rivalry);
      }
      this.transcript = '';
      this.callbacks.onTranscript?.('');
      this.callbacks.onPlaying?.(true);
      return;
    }

    if (event.type === 'response.output_audio_transcript.delta' && event.delta) {
      if (event.response_id && this.discardedResponseIds.has(event.response_id)) return;
      if (event.response_id && event.response_id !== this.responseQueue.responseId) return;
      this.transcript += event.delta;
      this.callbacks.onTranscript?.(this.transcript.trimStart());
      return;
    }
    if (event.type === 'response.output_audio_transcript.done' && event.transcript) {
      if (event.response_id && this.discardedResponseIds.has(event.response_id)) return;
      if (event.response_id && event.response_id !== this.responseQueue.responseId) return;
      this.transcript = event.transcript;
      this.callbacks.onTranscript?.(event.transcript);
      return;
    }
    if (event.type === 'output_audio_buffer.started') {
      this.callbacks.onPlaying?.(true);
      return;
    }
    if (event.type === 'response.done') {
      const responseId = event.response?.id;
      const completion = this.responseQueue.complete(responseId);
      if (!completion.handled) return;
      if (responseId) this.discardedResponseIds.delete(responseId);
      const completed = isSuccessfulRealtimeResponse(event.response?.status);
      this.playback.generationFinished(responseId, completed && !completion.discarded
        && hasRealtimeAudioOutput(event.response));
      const completedTranscript = this.transcript.trim();
      this.wireState.rivalry.generationFinished(responseId, completedTranscript,
        completed && !completion.discarded && hasRealtimeAudioOutput(event.response));
      this.openingResponseInFlight = false;
      if (!completion.discarded && completed && completedTranscript) {
        if (this.activeStoryResponse && this.activeStoryResponse.responseId === responseId
          && !this.activeStoryResponse.direction.rivalry) {
          this.broadcastDirector.markResponseCompleted(
            this.activeStoryResponse.direction
          );
          this.recordArcResponseCompleted(this.activeStoryResponse, completedTranscript);
        }
        this.callbacks.onTranscriptComplete?.(completedTranscript);
      } else if (!completion.discarded && !completed) {
        this.transcript = '';
        this.callbacks.onTranscript?.('');
        if (event.response?.status !== 'cancelled') {
          const detail = event.response?.status_details?.error?.message;
          this.callbacks.onError?.(new Error(detail ?? `Realtime commentary response ${event.response?.status ?? 'failed'}`));
        }
      }
      this.activeStoryResponse = null;
      this.transcript = '';
      if (completion.next && this.send(completion.next)) {
        this.callbacks.onPlaying?.(true);
      } else {
        if (completion.next) this.responseQueue.sendFailed();
        if (completion.next || !this.playback.busy) {
          this.policy.responseFinished();
          this.callbacks.onPlaying?.(false);
        }
      }
      return;
    }
    if (event.type === 'output_audio_buffer.stopped' || event.type === 'output_audio_buffer.cleared') {
      this.wireState.rivalry.playbackStopped(event.response_id, event.type === 'output_audio_buffer.cleared');
      if (this.playback.stopped(event.response_id) && !this.responseQueue.busy) {
        this.policy.responseFinished();
        this.callbacks.onPlaying?.(false);
      }
      return;
    }
    if (event.type === 'error') {
      const rejection = this.responseQueue.reject(event.error?.event_id);
      if (rejection.handled) {
        if (!rejection.next) this.pendingStoryResponses.clear();
        this.activeStoryResponse = null;
        this.transcript = '';
        this.openingResponseInFlight = false;
        if (!rejection.next || !this.send(rejection.next)) {
          if (rejection.next) this.responseQueue.sendFailed();
          this.policy.responseFinished();
          this.callbacks.onPlaying?.(false);
        }
      }
      this.callbacks.onError?.(new Error(event.error?.message ?? 'OpenAI Realtime error'));
    }
  }

  private startHeartbeat() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = setInterval(() => {
      void this.controlSession('PATCH');
    }, HEARTBEAT_INTERVAL_MS);
  }

  private async controlSession(method: 'PATCH' | 'DELETE') {
    if (!this.sessionId || !this.matchId) return;
    try {
      await fetch(SESSION_URL, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: this.sessionId, matchId: this.matchId }),
        keepalive: method === 'DELETE',
      });
    } catch {
      // Stale rows expire by heartbeat age; cleanup must never block teardown.
    }
  }

  private async closeTransport(notifyServer: boolean) {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    if (notifyServer) await this.controlSession('DELETE');
    this.channel?.close();
    this.peer?.close();
    this.audio?.pause();
    if (this.audio) this.audio.srcObject = null;
    this.channel = null;
    this.peer = null;
    this.audio = null;
    this.audioSource?.disconnect();
    this.audioSource = null;
    this.sessionId = null;
    this.matchId = null;
    this.epoch = 0;
    this.policy.reset(0);
    this.visitTiming.reset();
    this.broadcastDirector.reset();
    this.wireState.reset();
    this.responseQueue.reset();
    this.playback.reset();
    this.openingResponseInFlight = false;
    this.pendingStoryResponses.clear();
    this.activeStoryResponse = null;
    this.discardedResponseIds.clear();
  }

  private cancelSpeech(finishPolicy = true) {
    this.visitTiming.cancelSpeech();
    this.clearProviderSpeech();
    if (finishPolicy) this.policy.responseFinished();
  }

  private clearProviderSpeech() {
    this.wireState.rivalry.cancelPending();
    this.playback.reset();
    const cancellation = this.responseQueue.requestCancellation();
    if (cancellation.discardedResponseId) {
      this.rememberDiscardedResponse(cancellation.discardedResponseId);
    }
    if (cancellation.shouldCancel) this.sendProviderCancellation();
    this.send({
      event_id: `commentary-audio-clear-${crypto.randomUUID()}`,
      type: 'output_audio_buffer.clear',
    });
    this.pendingStoryResponses.clear();
    this.activeStoryResponse = null;
    this.openingResponseInFlight = false;
    this.transcript = '';
    this.callbacks.onTranscript?.('');
    this.callbacks.onPlaying?.(false);
  }

  private enqueueProviderResponse(event: Record<string, unknown>) {
    const immediate = this.responseQueue.enqueue(event);
    if (!immediate) return true;
    if (this.send(immediate)) return true;
    this.responseQueue.sendFailed();
    return false;
  }

  private sendProviderCancellation() {
    this.send({
      event_id: `commentary-cancel-${crypto.randomUUID()}`,
      type: 'response.cancel',
    });
  }

  private rememberDiscardedResponse(responseId: string) {
    this.discardedResponseIds.add(responseId);
    if (this.discardedResponseIds.size <= 64) return;
    const oldest = this.discardedResponseIds.values().next().value;
    if (oldest) this.discardedResponseIds.delete(oldest);
  }

  private manualPolicyEvent(eventId: string, context: CommentaryContext): CommentaryPolicyEvent {
    const checkedOut = Boolean(context.dartiq?.checkedOut) || (!context.busted && context.remainingScore === 0);
    const matchWon = Boolean(context.dartiq?.legResolution?.matchWon)
      || (checkedOut && context.gameContext.playerLegsWon + 1 >= context.gameContext.legsToWin);
    const consequence = {
      leg: context.dartiq?.peakLegConsequence ?? Math.abs(context.dartiq?.legWpa ?? 0),
      match: context.dartiq?.peakMatchConsequence ?? Math.abs(context.dartiq?.matchWpa ?? 0),
    };
    const materialConsequence = isMaterialDartIQConsequence(
      consequence,
      context.gameContext.allPlayers.length
    );
    const direction = context.narrative?.broadcastDirection;
    const story = direction?.activeStoryArc ?? context.narrative?.activeStoryArc;
    const signals = new Set<CommentaryPolicyEvent['signals'][number]>(context.dartiq?.signals ?? []);
    if (context.isNikitaSpecial) signals.add('nikita_special');
    if (context.is180) signals.add('one_eighty');
    if (checkedOut) signals.add('checkout');
    if ((context.dartiq?.unconvertedMatchFinishChancesInVisit ?? 0) >= 2) {
      signals.add('match_finish_chances_unconverted');
    }
    if (context.busted) signals.add('bust');
    if (context.dartiq?.changedMatchFavorite) signals.add('favorite_change');
    if (materialConsequence) signals.add('large_swing');
    if (direction?.shouldPromote) signals.add('story_arc');
    const signalList = [...signals];
    const semanticBust = context.busted && Boolean(
      context.dartiq?.oneDartFinishAvailable
      || context.dartiq?.matchWinAvailableThisVisit
    );
    const priority = matchWon
      ? 'terminal'
      : context.isNikitaSpecial
        || context.is180
        || checkedOut
        || semanticBust
        ? 'marquee'
      : signalList.length > 0
        ? 'notable'
        : direction?.shouldPromote
          ? 'notable'
          : 'ordinary';
    return {
      eventId,
      playerId: context.playerId,
      turnId: `manual-turn-${context.gameContext.overallTurnNumber}`,
      dartIndex: context.gameContext.dartsUsedThisTurn,
      scored: context.throws.at(-1)?.scored ?? 0,
      turnScore: context.totalScore,
      scoreBefore: checkedOut ? context.totalScore : context.remainingScore + context.totalScore,
      checkedOut,
      busted: context.busted,
      matchWon,
      priority,
      signals: signalList,
      storyKey: story ? `${story.kind}:${story.subjectPlayerId ?? 'match'}` : undefined,
    };
  }

  private recordPolicyDecision(
    event: CommentaryPolicyEvent,
    decision: ReturnType<CommentaryPolicy['evaluate']>,
    turnId?: string
  ) {
    if (!this.sessionId || !this.matchId) return;
    void fetch(SESSION_URL, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'policy_decision',
        sessionId: this.sessionId,
        matchId: this.matchId,
        sourceEventId: event.eventId,
        ...(turnId ? { turnId } : {}),
        epoch: this.epoch,
        policyVersion: DARTIQ_POLICY_VERSION,
        priority: decision.priority,
        signals: event.signals,
        shouldSpeak: decision.shouldSpeak,
        guaranteed: decision.guaranteed,
        interrupt: decision.interrupt,
        reason: decision.reason,
        evaluatedAt: new Date().toISOString(),
      }),
      keepalive: true,
    }).then((response) => {
      if (!response.ok) {
        console.warn('Could not record DartIQ commentary policy decision', response.status);
      }
    }).catch(() => {
      // Commentary remains available if optional calibration telemetry fails.
    });
  }

  private recordArcLifecycle(direction: BroadcastDirection, sourceEventId: string, turnId?: string) {
    for (const lifecycle of direction.lifecycleEvents) {
      this.recordArcEvent({
        sourceEventId,
        ...(turnId ? { turnId } : {}),
        sequence: direction.sequence,
        arc: lifecycle.arc,
        lifecycleEvent: lifecycle.type,
        ...(lifecycle.closeReason ? { closeReason: lifecycle.closeReason } : {}),
      });
    }
  }

  private recordArcResponseCompleted(
    story: PendingStoryResponse & { responseId: string },
    transcript: string
  ) {
    const arc = story.direction.activeStoryArc;
    if (!arc) return;
    this.recordArcEvent({
      sourceEventId: story.sourceEventId,
      ...(story.turnId ? { turnId: story.turnId } : {}),
      sequence: story.direction.sequence,
      arc,
      lifecycleEvent: 'response_completed',
      providerResponseId: story.responseId,
      transcript,
    });
  }

  private recordArcEvent(event: Record<string, unknown>) {
    if (!this.sessionId || !this.matchId) return;
    void fetch(SESSION_URL, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'arc_event',
        sessionId: this.sessionId,
        matchId: this.matchId,
        epoch: this.epoch,
        occurredAt: new Date().toISOString(),
        ...event,
      }),
      keepalive: true,
    }).then((response) => {
      if (!response.ok) console.warn('Could not record commentary story lifecycle', response.status);
    }).catch(() => {
      // Story telemetry is optional and never blocks commentary.
    });
  }

  private setStatus(status: RealtimeCommentaryStatus) {
    this.status = status;
    this.callbacks.onStatus?.(status);
  }
}
