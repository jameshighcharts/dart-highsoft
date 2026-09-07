export type RealtimeResponseCompletion<T> = {
  handled: boolean;
  discarded: boolean;
  next: T | null;
};

type QueueOptions<T> = {
  eventId?: (response: T) => string | null;
  onTimeout?: () => void;
  timeoutMs?: number;
};

/**
 * Serializes provider responses without delaying the common idle path. Realtime
 * accepts only one active response; replacements wait for the cancelled
 * response's terminal event, with only the newest replacement retained.
 */
export class RealtimeResponseQueue<T> {
  private phase: 'idle' | 'create_sent' | 'created' = 'idle';
  private activeResponseId: string | null = null;
  private queued: T | null = null;
  private cancelRequested = false;
  private cancelSent = false;
  private requestEventId: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly completedIds = new Set<string>();

  private readonly options: QueueOptions<T>;

  constructor(options: QueueOptions<T> = {}) {
    this.options = options;
  }

  private begin(response: T) {
    this.phase = 'create_sent';
    this.requestEventId = this.options.eventId?.(response) ?? null;
    this.armTimeout();
  }

  private armTimeout() {
    if (this.timer) clearTimeout(this.timer);
    if (!this.options.onTimeout) return;
    this.timer = setTimeout(() => {
      this.reset();
      this.options.onTimeout?.();
    }, this.options.timeoutMs ?? 45_000);
  }

  /** Only a rejection of our outstanding create may release the queue. */
  reject(eventId?: string): RealtimeResponseCompletion<T> {
    if (!eventId || eventId !== this.requestEventId || this.phase !== 'create_sent') {
      return { handled: false, discarded: false, next: null };
    }
    return this.complete();
  }

  get busy() {
    return this.phase !== 'idle';
  }

  get responseId() {
    return this.activeResponseId;
  }

  /** Returns the response to send immediately, or null when it was queued. */
  enqueue(response: T): T | null {
    if (this.busy) {
      this.queued = response;
      return null;
    }
    this.begin(response);
    return response;
  }

  /**
   * Drops any older queued replacement. Cancellation is deferred until
   * response.created when response.create has been sent but is not active yet.
   */
  requestCancellation() {
    this.queued = null;
    if (!this.busy) return { shouldCancel: false, discardedResponseId: null };
    this.cancelRequested = true;
    const discardedResponseId = this.activeResponseId;
    if (this.phase !== 'created' || this.cancelSent) {
      return { shouldCancel: false, discardedResponseId };
    }
    this.cancelSent = true;
    return { shouldCancel: true, discardedResponseId };
  }

  markCreated(responseId: string | null) {
    if (!this.busy) this.phase = 'create_sent';
    this.phase = 'created';
    this.activeResponseId = responseId;
    this.armTimeout();
    const shouldCancel = this.cancelRequested && !this.cancelSent;
    if (shouldCancel) this.cancelSent = true;
    return { shouldCancel, discardedResponseId: this.cancelRequested ? responseId : null };
  }

  complete(responseId?: string): RealtimeResponseCompletion<T> {
    if (responseId && this.completedIds.has(responseId)) return { handled: false, discarded: false, next: null };
    if (!this.busy) return { handled: false, discarded: false, next: null };
    if (responseId && this.activeResponseId && responseId !== this.activeResponseId) {
      return { handled: false, discarded: false, next: null };
    }
    const discarded = this.cancelRequested;
    const next = this.queued;
    const completedId = responseId ?? this.activeResponseId;
    if (completedId) {
      this.completedIds.add(completedId);
      if (this.completedIds.size > 64) this.completedIds.delete(this.completedIds.values().next().value!);
    }
    this.reset();
    if (next) this.begin(next);
    return { handled: true, discarded, next };
  }

  /** Restores idle state if the transport could not send an immediate create. */
  sendFailed() {
    this.reset();
  }

  reset() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.requestEventId = null;
    this.phase = 'idle';
    this.activeResponseId = null;
    this.queued = null;
    this.cancelRequested = false;
    this.cancelSent = false;
  }
}
