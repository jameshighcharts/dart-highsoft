import type { DartIQEventPriority } from '@/lib/dartiq/events';

export type CommentaryTimingEvent = {
  eventId: string;
  turnId: string;
  playerId: string;
  dartIndex: number;
  priority: DartIQEventPriority;
  guaranteed: boolean;
  expiresOnNextDart?: boolean;
};

export type CommentaryTimingObservation = {
  suppressedPendingSpeech: boolean;
  nextPlayerAlreadyThrowing: boolean;
};

export type CommentaryVisitTimingOptions = {
  ordinaryHoldMs?: number;
};

type PendingResponse = {
  event: CommentaryTimingEvent;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * Listener-local visit cadence. It owns no game facts and only decides when a
 * policy-approved response may begin, or when routine speech has lost its gap.
 */
export class CommentaryVisitTiming {
  private readonly ordinaryHoldMs: number;
  private lastDart: Pick<CommentaryTimingEvent, 'eventId' | 'turnId' | 'dartIndex'> | null = null;
  private pending: PendingResponse | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private idleVersion = 0;
  private speech: { event: CommentaryTimingEvent; startedAt: number; expire: () => void; timer: ReturnType<typeof setTimeout> } | null = null;

  constructor(options: CommentaryVisitTimingOptions = {}) {
    this.ordinaryHoldMs = Math.max(0, options.ordinaryHoldMs ?? 300);
  }

  observeDart(event: CommentaryTimingEvent): CommentaryTimingObservation {
    if (this.lastDart?.eventId === event.eventId) {
      return {
        suppressedPendingSpeech: false,
        nextPlayerAlreadyThrowing: false,
      };
    }

    this.clearIdle();
    const speech = this.speech;
    if (speech && speech.event.eventId !== event.eventId
      && speech.event.priority !== 'terminal' && speech.event.priority !== 'marquee'
      && (speech.event.expiresOnNextDart || speech.event.turnId !== event.turnId || Date.now() - speech.startedAt >= 2_000)) {
      this.finishSpeech();
      speech.expire();
    }
    const nextPlayerAlreadyThrowing = Boolean(
      this.lastDart
      && this.lastDart.turnId !== event.turnId
      && this.lastDart.dartIndex >= 3
    );
    const suppressedPendingSpeech = Boolean(
      this.pending && this.pending.event.eventId !== event.eventId
    );
    if (suppressedPendingSpeech) this.clearPending();

    // Fresh audible reactions retain their gap. Aged routine speech was
    // discarded above; the policy additionally owns significant interruption.

    this.lastDart = {
      eventId: event.eventId,
      turnId: event.turnId,
      dartIndex: event.dartIndex,
    };
    return { suppressedPendingSpeech, nextPlayerAlreadyThrowing };
  }

  schedule(event: CommentaryTimingEvent, deliver: () => boolean): 'held' | 'immediate' {
    if (event.priority === 'ordinary' && !event.guaranteed && this.ordinaryHoldMs > 0) {
      this.clearPending();
      const timer = setTimeout(() => {
        if (this.pending?.event.eventId !== event.eventId) return;
        this.pending = null;
        deliver();
      }, this.ordinaryHoldMs);
      this.pending = { event, timer };
      return 'held';
    }

    this.clearPending();
    deliver();
    return 'immediate';
  }

  /** One nudge per real takeout; no repeating timer or queued idle commentary. */
  scheduleIdle(deliver: (isCurrent: () => boolean) => void, delayMs = 20_000) {
    this.clearIdle();
    const version = this.idleVersion;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (version === this.idleVersion) deliver(() => version === this.idleVersion);
    }, delayMs);
  }

  private clearIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.idleVersion += 1;
  }

  cancelSpeech() {
    this.finishSpeech();
    this.clearIdle();
    this.clearPending();
  }

  /** Bound the entire request-to-playback window, including queued generation. */
  trackSpeech(event: CommentaryTimingEvent, expire: () => void) {
    this.finishSpeech();
    const maximumAgeMs = event.priority === 'terminal' ? 12_000
      : event.priority === 'marquee' ? 8_000 : event.dartIndex < 3 ? 3_000 : 6_000;
    const timer = setTimeout(() => {
      if (this.speech?.timer !== timer) return;
      this.finishSpeech();
      expire();
    }, maximumAgeMs);
    this.speech = { event, startedAt: Date.now(), expire, timer };
  }

  finishSpeech() {
    if (this.speech) clearTimeout(this.speech.timer);
    this.speech = null;
  }

  reset() {
    this.cancelSpeech();
    this.lastDart = null;
  }

  private clearPending() {
    if (this.pending) clearTimeout(this.pending.timer);
    this.pending = null;
  }
}

export function visitTimingInstruction(input: {
  priority: DartIQEventPriority;
  nextPlayerAlreadyThrowing: boolean;
}) {
  if (input.priority === 'terminal' || input.priority === 'marquee') {
    return 'now';
  }
  if (input.nextPlayerAlreadyThrowing) {
    return 'next player throwing';
  }
  return '';
}
