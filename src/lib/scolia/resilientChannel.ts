import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

type Status = 'SUBSCRIBED' | 'TIMED_OUT' | 'CLOSED' | 'CHANNEL_ERROR';

// realtime-js rejoins a timed-out or errored channel on its own, but gives up for good after a
// server-side close or a postgres-changes binding mismatch. Anything not subscribed for this
// long is rebuilt from scratch.
const UNSUBSCRIBED_GRACE_MS = 30_000;
const REBUILD_MIN_MS = 1_000;
const REBUILD_MAX_MS = 30_000;

/** A postgres-changes Realtime channel that is always either subscribed or being rebuilt. */
export class ResilientChannel {
  private channel: RealtimeChannel | null = null;
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private generation = 0;
  private stopped = false;
  private readonly supabase: SupabaseClient;
  private readonly topic: string;
  private readonly configure: (channel: RealtimeChannel) => RealtimeChannel;
  private readonly onStatus: (status: Status) => void;

  constructor(
    supabase: SupabaseClient,
    topic: string,
    configure: (channel: RealtimeChannel) => RealtimeChannel,
    onStatus: (status: Status) => void = () => {},
  ) {
    this.supabase = supabase;
    this.topic = topic;
    this.configure = configure;
    this.onStatus = onStatus;
  }

  start() {
    if (this.stopped || this.channel) return;
    // supabase.channel() hands back an existing channel with the same topic, and a channel still
    // leaving keeps its topic for up to its leave timeout; each build gets a topic of its own.
    const channel = this.configure(this.supabase.channel(`${this.topic}-${++this.generation}`));
    this.channel = channel;
    channel.subscribe((status) => {
      if (this.channel !== channel || this.stopped) return;
      this.onStatus(status);
      if (status === 'SUBSCRIBED') {
        this.failures = 0;
        this.clearGrace();
      } else if (status === 'CLOSED') {
        this.rebuild(`${this.topic} closed`);
      } else if (!this.graceTimer) {
        this.graceTimer = setTimeout(() => {
          this.graceTimer = null;
          this.rebuild(`${this.topic} not subscribed after ${UNSUBSCRIBED_GRACE_MS}ms (${status})`);
        }, UNSUBSCRIBED_GRACE_MS);
      }
    });
  }

  async stop() {
    this.stopped = true;
    this.clearGrace();
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    this.rebuildTimer = null;
    const channel = this.channel;
    this.channel = null;
    if (channel) await this.supabase.removeChannel(channel);
  }

  private rebuild(reason: string) {
    if (this.stopped || this.rebuildTimer) return;
    this.clearGrace();
    const channel = this.channel;
    this.channel = null;
    if (channel) {
      void this.supabase.removeChannel(channel).catch((error) =>
        console.warn(`[realtime] could not remove ${this.topic}`, error));
    }
    const delay = Math.min(REBUILD_MAX_MS, REBUILD_MIN_MS * 2 ** this.failures++);
    console.warn(`[realtime] ${reason}; resubscribing in ${delay}ms`);
    this.rebuildTimer = setTimeout(() => {
      this.rebuildTimer = null;
      this.start();
    }, delay);
  }

  private clearGrace() {
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = null;
  }
}
