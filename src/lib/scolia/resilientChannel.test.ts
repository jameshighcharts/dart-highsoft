// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ResilientChannel } from './resilientChannel';

type Status = 'SUBSCRIBED' | 'TIMED_OUT' | 'CLOSED' | 'CHANNEL_ERROR';

function fakeSupabase() {
  const channels: { topic: string; emit: (status: Status) => void }[] = [];
  const removeChannel = vi.fn(async () => 'ok');
  const supabase = {
    channel: vi.fn((topic: string) => {
      let callback: (status: Status) => void = () => {};
      const channel = {
        on: vi.fn(() => channel),
        subscribe: vi.fn((cb: (status: Status) => void) => { callback = cb; return channel; }),
      };
      channels.push({ topic, emit: (status) => callback(status) });
      return channel;
    }),
    removeChannel,
  } as unknown as SupabaseClient;
  return { supabase, channels, removeChannel };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ResilientChannel', () => {
  it('rebuilds a channel the server closed, under a fresh topic', async () => {
    const { supabase, channels, removeChannel } = fakeSupabase();
    const statuses: Status[] = [];
    const channel = new ResilientChannel(supabase, 'work', (c) => c, (status) => statuses.push(status));
    channel.start();
    channels[0].emit('SUBSCRIBED');
    channels[0].emit('CLOSED');
    expect(removeChannel).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1_000);
    const [first, second] = channels.map((c) => c.topic);
    expect(first).toMatch(/^work-\d+$/);
    expect(second).toMatch(/^work-\d+$/);
    expect(second).not.toBe(first);
    channels[1].emit('SUBSCRIBED');
    expect(statuses).toEqual(['SUBSCRIBED', 'CLOSED', 'SUBSCRIBED']);
  });

  it('leaves realtime-js to rejoin a briefly errored channel', async () => {
    const { supabase, channels } = fakeSupabase();
    new ResilientChannel(supabase, 'work', (c) => c).start();
    channels[0].emit('CHANNEL_ERROR');
    await vi.advanceTimersByTimeAsync(20_000);
    channels[0].emit('SUBSCRIBED');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(channels).toHaveLength(1);
  });

  it('rebuilds a channel that stays unsubscribed, backing off between attempts', async () => {
    const { supabase, channels } = fakeSupabase();
    new ResilientChannel(supabase, 'work', (c) => c).start();
    channels[0].emit('TIMED_OUT');
    await vi.advanceTimersByTimeAsync(31_000);
    expect(channels).toHaveLength(2);
    channels[1].emit('CLOSED');
    await vi.advanceTimersByTimeAsync(1_500);
    expect(channels).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(channels).toHaveLength(3);
  });

  it('rebuilds a channel that never reports any status', async () => {
    const { supabase, channels } = fakeSupabase();
    new ResilientChannel(supabase, 'work', (c) => c).start();
    await vi.advanceTimersByTimeAsync(31_000);
    expect(channels).toHaveLength(2);
  });

  it('gives a remounted instance a topic of its own', () => {
    const { supabase, channels } = fakeSupabase();
    const first = new ResilientChannel(supabase, 'game', (c) => c);
    first.start();
    void first.stop();
    new ResilientChannel(supabase, 'game', (c) => c).start();
    expect(channels[1].topic).not.toBe(channels[0].topic);
  });

  it('ignores late events from a replaced channel and stops cleanly', async () => {
    const { supabase, channels, removeChannel } = fakeSupabase();
    const channel = new ResilientChannel(supabase, 'work', (c) => c);
    channel.start();
    channels[0].emit('CLOSED');
    await vi.advanceTimersByTimeAsync(1_000);
    channels[1].emit('SUBSCRIBED');
    channels[0].emit('CLOSED');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(channels).toHaveLength(2);

    await channel.stop();
    expect(removeChannel).toHaveBeenCalledTimes(2);
    channels[1].emit('CLOSED');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(channels).toHaveLength(2);
  });
});
