import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoardStatusWriter } from './boardStatusWriter';
afterEach(() => vi.useRealTimers());
describe('independent board status writes', () => {
  it('coalesces routine darts but writes transitions and refreshes heartbeat after five seconds', async () => {
    vi.useFakeTimers();
    const write = vi.fn().mockResolvedValue(undefined);
    const writer = new BoardStatusWriter(write, vi.fn());
    writer.update({ board_phase: 'Throw', worker_heartbeat_at: '1' });
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 3; i++) writer.update({ board_phase: 'Throw', worker_heartbeat_at: String(i + 2), last_event_at: String(i) });
    expect(write).toHaveBeenCalledTimes(1);
    writer.update({ board_phase: 'Takeout' });
    await vi.advanceTimersByTimeAsync(0);
    expect(write).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5_001);
    writer.update({ worker_heartbeat_at: 'fresh' });
    await vi.advanceTimersByTimeAsync(0);
    expect(write).toHaveBeenCalledTimes(3);
    await writer.stop();
  });
  it('retries in order without letting an older write overwrite a newer phase', async () => {
    vi.useFakeTimers();
    const write = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const errors = vi.fn();
    const writer = new BoardStatusWriter(write, errors);
    writer.update({ board_phase: 'Takeout' });
    writer.update({ board_phase: 'Throw' });
    await vi.advanceTimersByTimeAsync(0);
    expect(write).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_001);
    expect(write.mock.calls.map(([row]) => row.board_phase)).toEqual(['Takeout', 'Takeout', 'Throw']);
    expect(errors).toHaveBeenCalledOnce();
    await writer.stop();
  });
});
