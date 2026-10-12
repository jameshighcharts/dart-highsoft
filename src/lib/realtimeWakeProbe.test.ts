import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installRealtimeWakeProbe, WAKE_PROBE_TIMEOUT_MS } from './realtimeWakeProbe';

type Status = 'sent' | 'ok' | 'error' | 'timeout' | 'disconnected';

function fakeRealtime() {
  let callback: (status: Status) => void = () => {};
  let pending = false;
  const realtime = {
    timeouts: 0,
    onHeartbeat: (next: (status: Status) => void) => { callback = next; },
    isConnected: vi.fn(() => true),
    // Mirrors realtime-js: a heartbeat still pending when the next is sent is a timeout.
    sendHeartbeat: vi.fn(() => {
      if (pending) { pending = false; realtime.timeouts += 1; callback('timeout'); return; }
      pending = true;
      callback('sent');
    }),
    reply: () => { pending = false; callback('ok'); },
  };
  return realtime;
}

describe('realtime wake probe', () => {
  const target = Object.assign(new EventTarget(), { document: Object.assign(new EventTarget(), { hidden: false }) });
  let uninstall = () => {};
  beforeEach(() => { vi.useFakeTimers(); target.document.hidden = false; });
  afterEach(() => { uninstall(); vi.useRealTimers(); });

  it('reconnects a socket that does not answer after the device wakes', async () => {
    const realtime = fakeRealtime();
    uninstall = installRealtimeWakeProbe(realtime, target as never);
    target.document.dispatchEvent(new Event('visibilitychange'));
    expect(realtime.sendHeartbeat).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(WAKE_PROBE_TIMEOUT_MS);
    expect(realtime.timeouts).toBe(1);
  });

  it('leaves a healthy socket alone', async () => {
    const realtime = fakeRealtime();
    uninstall = installRealtimeWakeProbe(realtime, target as never);
    target.dispatchEvent(new Event('online'));
    realtime.reply();
    await vi.advanceTimersByTimeAsync(WAKE_PROBE_TIMEOUT_MS * 2);
    expect(realtime.sendHeartbeat).toHaveBeenCalledTimes(1);
    expect(realtime.timeouts).toBe(0);
  });

  it('does not mistake a fresh scheduled heartbeat for a dead socket', async () => {
    const realtime = fakeRealtime();
    uninstall = installRealtimeWakeProbe(realtime, target as never);
    target.dispatchEvent(new Event('focus'));
    realtime.reply();
    await vi.advanceTimersByTimeAsync(WAKE_PROBE_TIMEOUT_MS - 1_000);
    realtime.sendHeartbeat(); // the SDK's own interval heartbeat
    await vi.advanceTimersByTimeAsync(1_000);
    expect(realtime.timeouts).toBe(0);
  });

  it('reconnects at once when a heartbeat was already overdue before waking', async () => {
    const realtime = fakeRealtime();
    uninstall = installRealtimeWakeProbe(realtime, target as never);
    realtime.sendHeartbeat();
    await vi.advanceTimersByTimeAsync(WAKE_PROBE_TIMEOUT_MS);
    target.document.dispatchEvent(new Event('visibilitychange'));
    expect(realtime.timeouts).toBe(1);
  });

  it('does nothing while hidden or disconnected', () => {
    const realtime = fakeRealtime();
    uninstall = installRealtimeWakeProbe(realtime, target as never);
    target.document.hidden = true;
    target.document.dispatchEvent(new Event('visibilitychange'));
    target.document.hidden = false;
    realtime.isConnected.mockReturnValue(false);
    target.dispatchEvent(new Event('online'));
    expect(realtime.sendHeartbeat).not.toHaveBeenCalled();
  });
});
