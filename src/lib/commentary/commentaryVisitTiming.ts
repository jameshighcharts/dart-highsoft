import type { DartIQEventPriority } from '@/lib/dartiq/events';

export type CommentaryTimingEvent = {
  eventId: string;
  turnId: string;
  playerId: string;
  dartIndex: number;
  priority: DartIQEventPriority;
  guaranteed: boolean;
};

export type CommentaryTimingObservation = {
  cancelActiveSpeech: boolean;
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
  private active: CommentaryTimingEvent | null = null;

  constructor(options: CommentaryVisitTimingOptions = {}) {
    this.ordinaryHoldMs = Math.max(0, options.ordinaryHoldMs ?? 850);
  }

  observeDart(event: CommentaryTimingEvent): CommentaryTimingObservation {
    if (this.lastDart?.eventId === event.eventId) {
      return {
        cancelActiveSpeech: false,
        suppressedPendingSpeech: false,
        nextPlayerAlreadyThrowing: false,
      };
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

    const cancelActiveSpeech = Boolean(
      this.active
      && this.active.priority === 'ordinary'
      && this.active.eventId !== event.eventId
    );
    if (cancelActiveSpeech) this.active = null;

    this.lastDart = {
      eventId: event.eventId,
      turnId: event.turnId,
      dartIndex: event.dartIndex,
    };
    return { cancelActiveSpeech, suppressedPendingSpeech, nextPlayerAlreadyThrowing };
  }

  schedule(event: CommentaryTimingEvent, deliver: () => boolean): 'held' | 'immediate' {
    if (event.priority === 'ordinary' && !event.guaranteed && this.ordinaryHoldMs > 0) {
      this.clearPending();
      const timer = setTimeout(() => {
        if (this.pending?.event.eventId !== event.eventId) return;
        this.pending = null;
        if (deliver()) this.active = event;
      }, this.ordinaryHoldMs);
      this.pending = { event, timer };
      return 'held';
    }

    this.clearPending();
    if (deliver()) this.active = event;
    return 'immediate';
  }

  responseFinished() {
    this.active = null;
  }

  cancelSpeech() {
    this.clearPending();
    this.active = null;
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
    return 'Timing: speak immediately.';
  }
  if (input.nextPlayerAlreadyThrowing) {
    return 'Timing: the next player is throwing; finish within 10 words.';
  }
  if (input.priority === 'ordinary') {
    return 'Timing: use the natural visit pause.';
  }
  return 'Timing: finish before the next dart.';
}
