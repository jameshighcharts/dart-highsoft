type Change = { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> };
export type WorkerWake = { boardIds: string[]; sessionIds: string[]; full: boolean };

/** Coalesce only the affected queues. Heartbeat-only updates do not wake work. */
export class WorkerNotifications {
  private boards = new Set<string>();
  private sessions = new Set<string>();
  private sessionState = new Map<string, string>();
  private full = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly dispatch: (work: WorkerWake) => void;

  constructor(dispatch: (work: WorkerWake) => void) { this.dispatch = dispatch; }

  change(table: 'commands' | 'sessions' | 'deliveries', change: Change) {
    const row = change.eventType === 'DELETE' ? change.old : change.new;
    if (table === 'commands') {
      if (row.status !== 'pending' || typeof row.board_id !== 'string') return;
      this.boards.add(row.board_id);
    } else if (table === 'deliveries') {
      // Failed-attempt updates are handled by the recovery timer, not a retry loop.
      if (change.eventType !== 'INSERT' || row.status !== 'pending' || typeof row.session_id !== 'string') return;
      this.sessions.add(row.session_id);
    } else {
      if (typeof row.id !== 'string') return;
      if (change.eventType === 'DELETE') this.sessionState.delete(row.id);
      else {
        const signature = JSON.stringify([
          row.match_id, row.openai_call_id, row.status, row.epoch, row.persona_id, row.voice,
          row.last_correction_id, row.last_correction_reason,
        ]);
        if (this.sessionState.get(row.id) === signature) return;
        this.sessionState.set(row.id, signature);
        // Bound bookkeeping independently of listener lifetime/database cleanup.
        if (this.sessionState.size > 1_000) this.sessionState.delete(this.sessionState.keys().next().value!);
      }
      this.sessions.add(row.id);
    }
    this.schedule();
  }

  reconnect() {
    this.full = true;
    this.sessionState.clear();
    this.schedule();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.boards.clear();
    this.sessions.clear();
    this.sessionState.clear();
    this.full = false;
  }

  private schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const work = { boardIds: [...this.boards], sessionIds: [...this.sessions], full: this.full };
      this.boards.clear();
      this.sessions.clear();
      this.full = false;
      this.dispatch(work);
    }, 50);
  }
}
/** Independent groups progress concurrently; each callback owns its group's ordering. */
export async function runBoundedWork<T>(groups: readonly T[], concurrency: number, work: (group: T) => Promise<void>) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('Invalid concurrency');
  let next = 0;
  const errors: unknown[] = [];
  await Promise.all(Array.from({ length: Math.min(concurrency, groups.length) }, async () => {
    while (next < groups.length) {
      const group = groups[next++];
      try { await work(group); } catch (error) { errors.push(error); }
    }
  }));
  if (errors.length) throw errors[0];
}

/** Retries the head before allowing later board events to advance. */
export class OrderedWorkQueue {
  private readonly pending: Array<() => Promise<void>> = [];
  private running = false;
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private readonly onError: (error: unknown) => void;
  private readonly retryMs: number;
  private readonly maxAttempts: number;

  constructor(
    onError: (error: unknown) => void,
    retryMs = 1_000,
    maxAttempts = Infinity,
  ) {
    this.onError = onError;
    this.retryMs = retryMs;
    this.maxAttempts = maxAttempts;
  }

  get idle() { return !this.running && this.pending.length === 0; }

  enqueue(work: () => Promise<void>) {
    if (this.stopped) return;
    this.pending.push(work);
    void this.drain();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending.length = 0;
  }

  private async drain() {
    if (this.running || this.timer || this.stopped) return;
    this.running = true;
    try {
      while (!this.stopped && this.pending.length) {
        try {
          await this.pending[0]();
          this.pending.shift();
          this.attempts = 0;
        } catch (error) {
          this.onError(error);
          if (++this.attempts >= this.maxAttempts) {
            this.pending.shift();
            this.attempts = 0;
            continue;
          }
          if (!this.stopped) {
            this.timer = setTimeout(() => {
              this.timer = null;
              void this.drain();
            }, this.retryMs);
          }
          break;
        }
      }
    } finally {
      this.running = false;
    }
  }
}
