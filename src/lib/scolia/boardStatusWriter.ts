type Status = Record<string, unknown>;
const timestamps = new Set(['worker_heartbeat_at', 'last_event_at', 'updated_at']);
const sameState = (a: Status, b: Status) => [...new Set([...Object.keys(a), ...Object.keys(b)])]
  .every(key => timestamps.has(key) || a[key] === b[key]);

/** Ordered status-only writer. Scoring never waits on status persistence. */
export class BoardStatusWriter {
  private desired: Status = {};
  private written: Status = {};
  private writtenAt = 0;
  private queue: Status[] = [];
  private running: Promise<void> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private readonly write: (value: Status) => Promise<void>;
  private readonly onError: (error: unknown) => void;
  constructor(write: (value: Status) => Promise<void>, onError: (error: unknown) => void) {
    this.write = write; this.onError = onError;
  }
  update(value: Status) {
    if (this.stopped) return;
    this.desired = { ...this.desired, ...value };
    const tail = this.queue.at(-1);
    if (tail && sameState(tail, this.desired)) this.queue[this.queue.length - 1] = { ...this.desired };
    else if (!tail && sameState(this.written, this.desired) && Date.now() - this.writtenAt < 5_000) return;
    else this.queue.push({ ...this.desired });
    // During a prolonged outage only a bounded set of recent status transitions matters.
    if (this.queue.length > 64) this.queue.splice(1, this.queue.length - 64);
    this.drain();
  }
  private drain() {
    if (this.running || this.retry || this.stopped || !this.queue.length) return;
    const value = this.queue.shift()!;
    this.running = this.write(value).then(() => {
      this.written = value; this.writtenAt = Date.now();
      // A heartbeat queued during this write need not cause another identical state write.
      while (this.queue[0] && sameState(value, this.queue[0])) this.queue.shift();
    }).catch(error => {
      this.onError(error);
      this.queue.unshift(value);
      if (!this.stopped) this.retry = setTimeout(() => { this.retry = null; this.drain(); }, 1_000);
    }).finally(() => { this.running = null; this.drain(); });
  }
  async stop() {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    await this.running;
    this.queue = [];
  }
}
