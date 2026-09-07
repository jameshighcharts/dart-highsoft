import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrderedWorkQueue, WorkerNotifications, runBoundedWork } from './orderedWorkQueue';

afterEach(() => vi.useRealTimers());

describe('WorkerNotifications', () => {
  it('coalesces commands for their own boards without waking commentary', async () => {
    vi.useFakeTimers();
    const dispatch = vi.fn();
    const notifications = new WorkerNotifications(dispatch);
    const change = { eventType: 'INSERT', new: { board_id: 'board-a', status: 'pending' }, old: {} };
    notifications.change('commands', change);
    notifications.change('commands', change);
    await vi.advanceTimersByTimeAsync(50);
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ boardIds: ['board-a'], sessionIds: [], full: false });
    notifications.stop();
  });

  it('ignores heartbeat-only and delivery retry updates but wakes corrections and deletion', async () => {
    vi.useFakeTimers();
    const dispatch = vi.fn();
    const notifications = new WorkerNotifications(dispatch);
    const row = { id: 's', match_id: 'm', status: 'active', epoch: 0, last_seen_at: 'first' };
    notifications.change('sessions', { eventType: 'INSERT', new: row, old: {} });
    await vi.advanceTimersByTimeAsync(50);
    dispatch.mockClear();
    notifications.change('sessions', { eventType: 'UPDATE', new: { ...row, last_seen_at: 'later' }, old: { id: 's' } });
    notifications.change('deliveries', { eventType: 'UPDATE', new: { session_id: 's', status: 'pending', attempts: 1 }, old: {} });
    await vi.advanceTimersByTimeAsync(50);
    expect(dispatch).not.toHaveBeenCalled();
    notifications.change('sessions', { eventType: 'UPDATE', new: { ...row, epoch: 1 }, old: { id: 's' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(dispatch).toHaveBeenLastCalledWith({ boardIds: [], sessionIds: ['s'], full: false });
    notifications.change('sessions', { eventType: 'DELETE', old: { id: 's' }, new: {} });
    await vi.advanceTimersByTimeAsync(50);
    expect(dispatch).toHaveBeenCalledTimes(2);
    notifications.stop();
  });

  it('scopes new deliveries and reconciles all queues after reconnect', async () => {
    vi.useFakeTimers();
    const dispatch = vi.fn();
    const notifications = new WorkerNotifications(dispatch);
    notifications.change('deliveries', { eventType: 'INSERT', new: { session_id: 's', status: 'pending' }, old: {} });
    await vi.advanceTimersByTimeAsync(50);
    expect(dispatch).toHaveBeenLastCalledWith({ boardIds: [], sessionIds: ['s'], full: false });
    notifications.reconnect();
    await vi.advanceTimersByTimeAsync(50);
    expect(dispatch).toHaveBeenLastCalledWith({ boardIds: [], sessionIds: [], full: true });
    notifications.reconnect();
    notifications.stop();
    await vi.advanceTimersByTimeAsync(50);
    expect(dispatch).toHaveBeenCalledTimes(2);
  });
});

describe('runBoundedWork', () => {
  it('lets other matches advance around a blocked match without exceeding the bound', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const finished: number[] = [];
    let active = 0;
    let peak = 0;
    const run = runBoundedWork([0, 1, 2, 3, 4], 2, async (id) => {
      peak = Math.max(peak, ++active);
      if (id === 0) await blocked;
      finished.push(id);
      active -= 1;
    });
    await vi.waitFor(() => expect(finished).toEqual([1, 2, 3, 4]));
    expect(peak).toBe(2);
    release();
    await run;
    expect(finished).toEqual([1, 2, 3, 4, 0]);
  });

  it('drains remaining groups even after failures', async () => {
    const work = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    await expect(runBoundedWork([1, 2, 3], 1, work)).rejects.toThrow('offline');
    expect(work).toHaveBeenCalledTimes(3);
  });
});

describe('OrderedWorkQueue', () => {
  it('retries a failed dart before the next dart and takeout can advance', async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const first = vi.fn().mockRejectedValueOnce(new Error('database unavailable')).mockImplementation(async () => { calls.push('dart 1'); });
    const queue = new OrderedWorkQueue(vi.fn());
    queue.enqueue(first);
    queue.enqueue(async () => { calls.push('dart 2'); });
    queue.enqueue(async () => { calls.push('takeout'); });
    await vi.advanceTimersByTimeAsync(999);
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toEqual(['dart 1', 'dart 2', 'takeout']);
    expect(queue.idle).toBe(true);
    queue.stop();
  });

  it('keeps scoring independent of blocked commentary and stops pending retries', async () => {
    vi.useFakeTimers();
    const commentary = new OrderedWorkQueue(vi.fn());
    const scoring = new OrderedWorkQueue(vi.fn());
    const fail = vi.fn().mockRejectedValue(new Error('provider unavailable'));
    commentary.enqueue(fail);
    const score = vi.fn().mockResolvedValue(undefined);
    scoring.enqueue(score);
    await vi.advanceTimersByTimeAsync(0);
    expect(score).toHaveBeenCalledOnce();
    commentary.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fail).toHaveBeenCalledOnce();
    scoring.stop();
  });

  it('can abandon a permanently invalid commentary item without blocking later calls', async () => {
    vi.useFakeTimers();
    const queue = new OrderedWorkQueue(vi.fn(), 100, 3);
    const fail = vi.fn().mockRejectedValue(new Error('deleted dart'));
    const next = vi.fn().mockResolvedValue(undefined);
    queue.enqueue(fail);
    queue.enqueue(next);
    await vi.advanceTimersByTimeAsync(200);
    expect(fail).toHaveBeenCalledTimes(3);
    expect(next).toHaveBeenCalledOnce();
    queue.stop();
  });
});
