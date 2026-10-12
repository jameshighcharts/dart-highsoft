import { RealtimeClient } from '@supabase/realtime-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installRealtimeWakeProbe, WAKE_PROBE_TIMEOUT_MS } from './realtimeWakeProbe';

const INTERVAL = 10_000;

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

  it('never probes just before a scheduled heartbeat, which would close a healthy socket', async () => {
    const realtime = fakeRealtime();
    uninstall = installRealtimeWakeProbe(realtime, target as never, INTERVAL);
    realtime.sendHeartbeat(); // scheduled tick
    realtime.reply();
    await vi.advanceTimersByTimeAsync(9_000);
    target.document.dispatchEvent(new Event('visibilitychange'));
    expect(realtime.sendHeartbeat).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    realtime.sendHeartbeat(); // the imminent tick is the probe
    realtime.reply();
    await vi.advanceTimersByTimeAsync(WAKE_PROBE_TIMEOUT_MS);
    expect(realtime.timeouts).toBe(0);
  });

  it('still catches a dead socket when the imminent scheduled heartbeat goes unanswered', async () => {
    const realtime = fakeRealtime();
    uninstall = installRealtimeWakeProbe(realtime, target as never, INTERVAL);
    realtime.sendHeartbeat();
    realtime.reply();
    await vi.advanceTimersByTimeAsync(9_000);
    target.document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(1_000);
    realtime.sendHeartbeat(); // tick, never answered
    await vi.advanceTimersByTimeAsync(WAKE_PROBE_TIMEOUT_MS);
    expect(realtime.timeouts).toBe(1);
  });

  it('probes at once when the next scheduled heartbeat is still far off', async () => {
    const realtime = fakeRealtime();
    uninstall = installRealtimeWakeProbe(realtime, target as never, INTERVAL);
    realtime.sendHeartbeat();
    realtime.reply();
    await vi.advanceTimersByTimeAsync(3_000);
    target.document.dispatchEvent(new Event('visibilitychange'));
    expect(realtime.sendHeartbeat).toHaveBeenCalledTimes(2);
  });

  it('times the next scheduled heartbeat from the reply to a probe, which reschedules it', async () => {
    const realtime = fakeRealtime();
    uninstall = installRealtimeWakeProbe(realtime, target as never, INTERVAL);
    realtime.sendHeartbeat(); // scheduled tick at 0, so the next would have been at 10s
    realtime.reply();
    await vi.advanceTimersByTimeAsync(3_000);
    target.document.dispatchEvent(new Event('visibilitychange'));
    realtime.reply(); // the probe's reply moves the next scheduled tick to 13s
    await vi.advanceTimersByTimeAsync(7_500);
    target.document.dispatchEvent(new Event('visibilitychange')); // 10.5s: no tick is imminent, so probe
    expect(realtime.sendHeartbeat).toHaveBeenCalledTimes(3);
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

/** Just enough WebSocket for realtime-js: opens on the next tick and records what is sent. */
class FakeSocket {
  static latest: FakeSocket;
  readyState = 0;
  binaryType = 'arraybuffer';
  sent: unknown[][] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeSocket.latest = this;
    setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 0);
  }
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close(code = 1000) { this.readyState = 3; this.onclose?.({ code }); }
  heartbeats() { return this.sent.filter(([, , topic, event]) => topic === 'phoenix' && event === 'heartbeat'); }
  replyToHeartbeat() {
    const [, ref] = this.heartbeats().at(-1)!;
    this.onmessage?.({ data: JSON.stringify([null, ref, 'phoenix', 'phx_reply', { status: 'ok', response: {} }]) });
  }
}

describe('realtime wake probe against the real realtime-js client', () => {
  const target = Object.assign(new EventTarget(), { document: Object.assign(new EventTarget(), { hidden: false }) });
  let uninstall = () => {};
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { uninstall(); vi.useRealTimers(); });

  it('probes a wake that follows an earlier probe, whose reply rescheduled the heartbeat', async () => {
    const statuses: string[] = [];
    const client = new RealtimeClient('ws://realtime.test/realtime/v1', {
      params: { apikey: 'anon' }, heartbeatIntervalMs: INTERVAL, transport: FakeSocket as never,
    });
    uninstall = installRealtimeWakeProbe({
      onHeartbeat: (callback) => client.onHeartbeat((status) => { statuses.push(status); callback(status as Status); }),
      sendHeartbeat: () => client.sendHeartbeat(),
      isConnected: () => client.isConnected(),
    }, target as never, INTERVAL);
    client.connect();
    await vi.advanceTimersByTimeAsync(INTERVAL); // first scheduled heartbeat, answered
    const socket = FakeSocket.latest;
    socket.replyToHeartbeat();
    await vi.advanceTimersByTimeAsync(3_000);
    target.document.dispatchEvent(new Event('visibilitychange'));
    expect(socket.heartbeats()).toHaveLength(2);
    socket.replyToHeartbeat(); // realtime-js now schedules the next heartbeat 10s from here
    await vi.advanceTimersByTimeAsync(7_500);
    target.document.dispatchEvent(new Event('visibilitychange'));
    expect(socket.heartbeats()).toHaveLength(3); // the old schedule would have been due; the real one is not
    await vi.advanceTimersByTimeAsync(WAKE_PROBE_TIMEOUT_MS); // the socket died: no reply
    expect(statuses).toContain('timeout');
    expect(socket.readyState).toBe(3);
    client.disconnect();
  });
});
