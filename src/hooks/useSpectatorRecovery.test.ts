import { cleanup, act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSpectatorRecovery } from './useSpectatorRecovery';

describe('spectator recovery', () => {
  const refresh = vi.fn().mockResolvedValue(undefined);
  const request = vi.fn();
  const defaults = { matchId: 'm', enabled: true, connected: false, recoveryVersion: 0, refresh };
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.stubGlobal('fetch', request);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    request.mockResolvedValue({ ok: true, json: async () => ({ revision: '1' }) });
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

  it('allows reconnect time, skips unchanged history, and catches edits/deletes by revision', async () => {
    renderHook(() => useSpectatorRecovery(defaults));
    await advance(14_999);
    expect(request).not.toHaveBeenCalled();
    await advance(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    await advance(15_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    request.mockResolvedValue({ ok: true, json: async () => ({ revision: '2' }) });
    await advance(30_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('checks healthy matches once per minute and stops for completed matches', async () => {
    const { rerender } = renderHook(props => useSpectatorRecovery(props), { initialProps: { ...defaults, connected: true } });
    await advance(59_999);
    expect(request).not.toHaveBeenCalled();
    await advance(1);
    expect(request).toHaveBeenCalledTimes(1);
    rerender({ ...defaults, enabled: false });
    await advance(120_000);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('pauses while hidden/offline and checks once on return', async () => {
    Object.defineProperty(document, 'hidden', { value: true });
    renderHook(() => useSpectatorRecovery(defaults));
    await advance(120_000);
    expect(request).not.toHaveBeenCalled();
    Object.defineProperty(document, 'hidden', { value: false });
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(request).toHaveBeenCalledTimes(1);
    Object.defineProperty(navigator, 'onLine', { value: false });
    await advance(120_000);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('reconciles after rejoin then uses slow health checks', async () => {
    const { rerender } = renderHook(props => useSpectatorRecovery(props), { initialProps: defaults });
    await act(async () => rerender({ ...defaults, connected: true, recoveryVersion: 1 }));
    expect(refresh).toHaveBeenCalledTimes(1);
    await advance(120_000);
    expect(request).toHaveBeenCalledTimes(3);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not acknowledge a failed snapshot or overlap slow snapshots', async () => {
    let finish!: () => void;
    refresh.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const { unmount } = renderHook(() => useSpectatorRecovery(defaults));
    await advance(15_000);
    await advance(120_000);
    expect(request).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    unmount();
    refresh.mockRejectedValueOnce(new Error('offline'));
    renderHook(() => useSpectatorRecovery(defaults));
    await advance(15_000);
    await advance(30_000);
    expect(refresh).toHaveBeenCalledTimes(3);
  });
  it('retries a failed initial load even when the channel is connected', async () => {
    renderHook(() => useSpectatorRecovery({ ...defaults, connected: true, hasSnapshot: false }));
    await advance(15_000);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('detects a silent delivery gap while still subscribed', async () => {
    renderHook(() => useSpectatorRecovery({ ...defaults, connected: true }));
    await advance(60_000);
    request.mockResolvedValue({ ok: true, json: async () => ({ revision: 'missed-dart' }) });
    await advance(60_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('retries failed checks within 20 seconds', async () => {
    request.mockRejectedValue(new Error('temporary failure'));
    renderHook(() => useSpectatorRecovery(defaults));
    await advance(15_000);
    await advance(40_000);
    expect(request).toHaveBeenCalledTimes(3);
  });

});
