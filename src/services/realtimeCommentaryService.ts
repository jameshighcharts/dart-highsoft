import type { CommentaryPersonaId } from '@/lib/commentary/types';
import {
  CommentaryPolicy,
  type CommentaryPolicyEvent,
} from '@/lib/commentary/commentaryPolicy';
import { buildRealtimeResponseInstructions } from '@/lib/commentary/realtimePrompt';
import {
  createRealtimeCommentaryCorrectionEnvelope,
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
import { BroadcastDirector } from '@/lib/commentary/broadcastDirector';

export type RealtimeCommentaryStatus = 'idle' | 'connecting' | 'ready' | 'failed';

type RealtimeServerEvent = {
  type?: string;
  delta?: string;
  transcript?: string;
  response_id?: string;
  response?: {
    id?: string;
    status?: string;
    status_details?: { error?: { message?: string }; reason?: string };
  };
  error?: { message?: string };
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
  private activeResponseId: string | null = null;
  private responseInFlight = false;
  private readonly discardedResponseIds = new Set<string>();
  private status: RealtimeCommentaryStatus = 'idle';
  private readonly policy = new CommentaryPolicy();
  private readonly visitTiming = new CommentaryVisitTiming();
  private readonly broadcastDirector = new BroadcastDirector();
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
      this.broadcastDirector.reset({
        sequence: payload.snapshot.narrative.sequence,
        candidates: payload.snapshot.narrative.storyArcCandidates,
      });
      await peer.setRemoteDescription({ type: 'answer', sdp: payload.answerSdp });
      await this.waitForChannel(channel);
      if (payload.snapshotSource === 'browser') this.sendSnapshot(payload.snapshot);
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
    const eventId = crypto.randomUUID();
    const direction = context.narrative
      ? this.broadcastDirector.direct({
          sequence: context.narrative.sequence,
          candidates: context.narrative.storyArcCandidates,
        })
      : null;
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
          text: `AUTHORITATIVE_MATCH_EVENT\n${JSON.stringify({ epoch: this.epoch, event: directedContext })}`,
        }],
      },
    })) return false;

    const policyEvent = this.manualPolicyEvent(eventId, directedContext);
    const timingObservation = this.visitTiming.observeDart({
      ...policyEvent,
      guaranteed: false,
    });
    if (timingObservation.cancelActiveSpeech || timingObservation.suppressedPendingSpeech) {
      if (timingObservation.cancelActiveSpeech) this.clearProviderSpeech();
      this.policy.responseFinished();
    }
    const decision = this.policy.evaluate(policyEvent);
    if (!decision.shouldSpeak) return true;
    if (decision.interrupt) {
      this.visitTiming.cancelSpeech();
      this.clearProviderSpeech();
    }
    const timingEvent = { ...policyEvent, guaranteed: decision.guaranteed };
    this.visitTiming.schedule(timingEvent, () => {
      this.transcript = '';
      this.callbacks.onPlaying?.(true);
      const sent = this.send({
        event_id: `commentary-response-${eventId}`,
        type: 'response.create',
        response: {
          output_modalities: ['audio'],
          instructions: buildRealtimeResponseInstructions({
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
          }),
          metadata: { source: 'browser', epoch: String(this.epoch), priority: decision.priority },
        },
      });
      if (sent) this.responseInFlight = true;
      if (sent && direction?.shouldPromote) this.broadcastDirector.markMentioned(direction);
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
    if (observation.cancelActiveSpeech) this.clearProviderSpeech();
    if (observation.cancelActiveSpeech || observation.suppressedPendingSpeech) {
      this.policy.responseFinished();
    }
  }

  correct(reason: RealtimeCommentaryCorrectionReason) {
    this.cancelSpeech();
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
            text: `AUTHORITATIVE_MATCH_CORRECTION\n${JSON.stringify(
              createRealtimeCommentaryCorrectionEnvelope({
                correctionId,
                epoch: payload.epoch,
                reason,
                snapshot: payload.snapshot,
              })
            )}`,
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
          text: `AUTHORITATIVE_MATCH_SNAPSHOT\n${JSON.stringify({ epoch: this.epoch, snapshot })}`,
        }],
      },
    })) {
      throw new Error('Realtime snapshot data channel was not ready');
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
      if (responseId && this.discardedResponseIds.has(responseId)) return;
      this.activeResponseId = responseId;
      this.responseInFlight = true;
      this.transcript = '';
      this.callbacks.onTranscript?.('');
      this.callbacks.onPlaying?.(true);
      return;
    }

    if (event.type === 'response.output_audio_transcript.delta' && event.delta) {
      if (event.response_id && this.discardedResponseIds.has(event.response_id)) return;
      if (event.response_id && event.response_id !== this.activeResponseId) return;
      this.transcript += event.delta;
      this.callbacks.onTranscript?.(this.transcript.trimStart());
      return;
    }
    if (event.type === 'response.output_audio_transcript.done' && event.transcript) {
      if (event.response_id && this.discardedResponseIds.has(event.response_id)) return;
      if (event.response_id && event.response_id !== this.activeResponseId) return;
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
      if (responseId && this.discardedResponseIds.delete(responseId)) return;
      if (responseId && responseId !== this.activeResponseId) return;
      const completed = isSuccessfulRealtimeResponse(event.response?.status);
      const completedTranscript = this.transcript.trim();
      this.activeResponseId = null;
      this.responseInFlight = false;
      this.policy.responseFinished();
      this.visitTiming.responseFinished();
      this.callbacks.onPlaying?.(false);
      if (completed && completedTranscript) {
        this.callbacks.onTranscriptComplete?.(completedTranscript);
      } else if (!completed) {
        this.transcript = '';
        this.callbacks.onTranscript?.('');
        if (event.response?.status !== 'cancelled') {
          const detail = event.response?.status_details?.error?.message;
          this.callbacks.onError?.(new Error(detail ?? `Realtime commentary response ${event.response?.status ?? 'failed'}`));
        }
      }
      return;
    }
    if (event.type === 'output_audio_buffer.stopped') {
      this.callbacks.onPlaying?.(false);
      return;
    }
    if (event.type === 'error') {
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
    this.activeResponseId = null;
    this.responseInFlight = false;
    this.discardedResponseIds.clear();
  }

  private cancelSpeech(finishPolicy = true) {
    this.visitTiming.cancelSpeech();
    this.clearProviderSpeech();
    if (finishPolicy) this.policy.responseFinished();
  }

  private clearProviderSpeech() {
    if (this.activeResponseId) {
      this.rememberDiscardedResponse(this.activeResponseId);
    }
    if (this.responseInFlight) {
      this.send({
        event_id: `commentary-cancel-${crypto.randomUUID()}`,
        type: 'response.cancel',
      });
    }
    this.send({
      event_id: `commentary-audio-clear-${crypto.randomUUID()}`,
      type: 'output_audio_buffer.clear',
    });
    this.activeResponseId = null;
    this.responseInFlight = false;
    this.transcript = '';
    this.callbacks.onTranscript?.('');
    this.callbacks.onPlaying?.(false);
  }

  private rememberDiscardedResponse(responseId: string) {
    this.discardedResponseIds.add(responseId);
    if (this.discardedResponseIds.size <= 64) return;
    const oldest = this.discardedResponseIds.values().next().value;
    if (oldest) this.discardedResponseIds.delete(oldest);
  }

  private manualPolicyEvent(eventId: string, context: CommentaryContext): CommentaryPolicyEvent {
    const checkedOut = Boolean(context.pressure?.checkedOut) || (!context.busted && context.remainingScore === 0);
    const direction = context.narrative?.broadcastDirection;
    const story = direction?.activeStoryArc ?? context.narrative?.activeStoryArc;
    const signals: CommentaryPolicyEvent['signals'] = context.isNikitaSpecial
      ? ['nikita_special']
      : context.is180
      ? ['one_eighty']
      : checkedOut
        ? ['checkout']
        : context.busted
          ? ['bust']
          : context.pressure?.changedMatchFavorite
            ? ['favorite_change']
            : Math.abs(context.pressure?.matchWpa ?? 0) >= 0.08
              ? ['large_swing']
              : direction?.shouldPromote
                ? ['story_arc']
                : [];
    const priority = context.isNikitaSpecial || context.is180 || checkedOut || context.busted
      ? 'marquee'
      : signals.length > 0
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
      matchWon: false,
      priority,
      signals,
      storyKey: story ? `${story.kind}:${story.subjectPlayerId ?? 'match'}` : undefined,
    };
  }

  private setStatus(status: RealtimeCommentaryStatus) {
    this.status = status;
    this.callbacks.onStatus?.(status);
  }
}
