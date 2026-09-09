import { cleanup, act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getRealtimeMetricsSnapshot } from '@/lib/match/realtimeMetrics';
import { useRealtime } from './useRealtime';

const onMock = vi.fn();
const subscribeMock = vi.fn();
const unsubscribeMock = vi.fn();
const channelMock = vi.fn();
const getSupabaseClientMock = vi.fn();

vi.mock('@/lib/supabaseClient', () => ({
  getSupabaseClient: () => getSupabaseClientMock(),
}));

describe('useRealtime', () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  beforeEach(() => {
    vi.clearAllMocks();
    window.__dartRealtimeMetrics = {};

    onMock.mockImplementation(() => mockChannel);
    subscribeMock.mockImplementation((callback?: (status: string) => void) => {
      callback?.('SUBSCRIBED');
      return mockChannel;
    });
    unsubscribeMock.mockImplementation(() => mockChannel);
    channelMock.mockImplementation(() => mockChannel);

    getSupabaseClientMock.mockResolvedValue({
      channel: channelMock,
      removeChannel: vi.fn().mockResolvedValue('ok'),
    });
  });

  const mockChannel = {
    on: onMock,
    subscribe: subscribeMock,
    unsubscribe: unsubscribeMock,
    track: vi.fn(),
    send: vi.fn(),
  };

  it('subscribes to turns and throws with match_id filters', async () => {
    renderHook(() => useRealtime('match-123'));

    await waitFor(() => {
      expect(channelMock).toHaveBeenCalledWith(
        'dart_match_match-123',
        expect.objectContaining({
          config: expect.objectContaining({
            presence: expect.any(Object),
          }),
        })
      );
    });

    const postgresCalls = onMock.mock.calls.filter(
      ([eventName]) => eventName === 'postgres_changes'
    );

    const throwsCall = postgresCalls.find(
      ([, payload]) => payload && typeof payload === 'object' && (payload as { table?: string }).table === 'throws'
    );
    const turnsCall = postgresCalls.find(
      ([, payload]) => payload && typeof payload === 'object' && (payload as { table?: string }).table === 'turns'
    );

    expect(throwsCall?.[1]).toEqual(
      expect.objectContaining({
        filter: 'match_id=eq.match-123',
      })
    );
    expect(turnsCall?.[1]).toEqual(
      expect.objectContaining({
        filter: 'match_id=eq.match-123',
      })
    );
  });

  it('marks connection as error when postgres_changes subscription fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { result } = renderHook(() => useRealtime('match-123'));

    await waitFor(() => {
      expect(result.current.connectionStatus).toBe('connected');
    });

    const systemCall = onMock.mock.calls.find(([eventName]) => eventName === 'system');
    expect(systemCall).toBeDefined();

    const systemHandler = systemCall?.[2] as ((payload: unknown) => void) | undefined;
    expect(systemHandler).toBeDefined();

    systemHandler?.({
      extension: 'postgres_changes',
      status: 'error',
      message: 'Unable to subscribe to changes with given parameters',
    });

    expect(warnSpy).toHaveBeenCalled();
    await waitFor(() => {
      expect(result.current.connectionStatus).toBe('error');
      expect(result.current.connectionError).toBe('Unable to subscribe to changes with given parameters');
    });
    warnSpy.mockRestore();
  });

  it('ignores empty prototype-only postgres_changes system payload noise', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { result } = renderHook(() => useRealtime('match-123'));

    await waitFor(() => {
      expect(result.current.connectionStatus).toBe('connected');
    });

    const systemCall = onMock.mock.calls.find(([eventName]) => eventName === 'system');
    expect(systemCall).toBeDefined();

    const systemHandler = systemCall?.[2] as ((payload: unknown) => void) | undefined;
    expect(systemHandler).toBeDefined();

    // Simulates payloads where properties live on prototype (keys() is empty).
    const prototypeOnlyPayload = Object.create({
      extension: 'postgres_changes',
      status: 'error',
      message: 'Unable to subscribe to changes with given parameters',
    });

    systemHandler?.(prototypeOnlyPayload);

    await waitFor(() => {
      expect(result.current.connectionStatus).toBe('connected');
    });

    expect(warnSpy).toHaveBeenCalledWith('Realtime postgres_changes warning ignored:', prototypeOnlyPayload);
    warnSpy.mockRestore();
  });

  it('filters lineup inserts/updates while retaining delete handling, and uses a private score channel', async () => {
    const { result } = renderHook(() => useRealtime('match-123'));
    await waitFor(() => expect(result.current.isConnected).toBe(true));
    expect(channelMock).toHaveBeenCalledWith('live_match_match-123', { config: { private: true } });
    const lineup = onMock.mock.calls.filter(([type, config]) => type === 'postgres_changes' && config.table === 'match_players');
    expect(lineup.map(([, config]) => [config.event, config.filter])).toEqual([
      ['INSERT', 'match_id=eq.match-123'], ['UPDATE', 'match_id=eq.match-123'], ['DELETE', undefined],
    ]);
    const handler = vi.fn();
    window.addEventListener('supabase-match-players-change', handler);
    const deletion = lineup.find(([, config]) => config.event === 'DELETE')![2];
    deletion({ eventType: 'DELETE', new: {}, old: { match_id: 'other' } });
    expect(handler).not.toHaveBeenCalled();
    deletion({ eventType: 'DELETE', new: {}, old: { match_id: 'match-123' } });
    expect(handler).toHaveBeenCalledOnce();
    window.removeEventListener('supabase-match-players-change', handler);
  });

  it('reports private-channel failure separately from WAL and counts validated broadcasts after recovery', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let status!: (value: string, error?: Error) => void;
    let receive!: (event: { payload: unknown }) => void;
    const fast = {
      on: vi.fn((_type, _filter, handler) => { receive = handler; return fast; }),
      subscribe: vi.fn(callback => { status = callback; }),
    };
    channelMock.mockImplementation(name => name.startsWith('live_match_') ? fast : mockChannel);
    const { result, unmount } = renderHook(() => useRealtime('match-123'));
    await waitFor(() => { expect(result.current.isConnected).toBe(true); expect(fast.subscribe).toHaveBeenCalled(); });
    status('CHANNEL_ERROR', new Error('not authorized'));
    status('CHANNEL_ERROR', new Error('not authorized'));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(getRealtimeMetricsSnapshot('match-123')?.broadcastStatus).toBe('error');
    expect(result.current.isConnected).toBe(true);
    status('SUBSCRIBED');
    expect(getRealtimeMetricsSnapshot('match-123')?.broadcastStatus).toBe('connected');
    const packet = { matchId: 'match-123', turn: { id: 't', leg_id: 'l', player_id: 'p', turn_number: 1,
      total_scored: 0, busted: false, tiebreak_round: null, live_revision: '1' },
      throws: [{ id: 'd', turn_id: 't', dart_index: 1, segment: 'S20', scored: 20, live_revision: '2' }] };
    receive({ payload: { ...packet, matchId: 'other' } });
    expect(getRealtimeMetricsSnapshot('match-123')?.scoringCommitBroadcasts).toBe(0);
    receive({ payload: packet });
    expect(getRealtimeMetricsSnapshot('match-123')?.scoringCommitBroadcasts).toBe(1);
    unmount();
    status('CHANNEL_ERROR');
    expect(getRealtimeMetricsSnapshot('match-123')?.broadcastStatus).toBe('disconnected');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('sets error status on explicit channel error lifecycle status', async () => {
    subscribeMock.mockImplementation((callback?: (status: string) => void) => {
      callback?.('CHANNEL_ERROR');
      return mockChannel;
    });

    const { result } = renderHook(() => useRealtime('match-123'));

    await waitFor(() => {
      expect(result.current.connectionStatus).toBe('error');
    });
  });
  it('replaces a failed WAL channel and ignores its late status callbacks', async () => {
    vi.useFakeTimers();
    const statuses: Array<(status: string) => void> = [];
    subscribeMock.mockImplementation(callback => { statuses.push(callback); return mockChannel; });
    const { result, unmount } = renderHook(() => useRealtime('match-123'));
    await act(async () => {});
    const wal = statuses[channelMock.mock.calls.findIndex(([name]) => name === 'dart_match_match-123')];
    await act(async () => wal('CHANNEL_ERROR'));
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(channelMock.mock.calls.filter(([name]) => name === 'dart_match_match-123')).toHaveLength(2);
    const replacement = statuses.at(-1)!;
    await act(async () => replacement('SUBSCRIBED'));
    expect(result.current.isConnected).toBe(true);
    await act(async () => wal('CLOSED'));
    expect(result.current.isConnected).toBe(true);
    unmount();
  });

  it('does not create channels after an unmounted async initialization resolves', async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise(value => { resolve = value; });
    getSupabaseClientMock.mockReturnValue(pending);
    const { unmount } = renderHook(() => useRealtime('match-123'));
    unmount();
    await act(async () => resolve({ channel: channelMock, removeChannel: vi.fn() }));
    expect(channelMock).not.toHaveBeenCalled();
  });

  it('keeps healthy subscriptions across rerenders and releases both on unmount', async () => {
    const { rerender, unmount } = renderHook(() => useRealtime('match-123'));
    await act(async () => {});
    rerender();
    expect(channelMock).toHaveBeenCalledTimes(2);
    const client = await getSupabaseClientMock.mock.results[0].value;
    expect(client.removeChannel).not.toHaveBeenCalled();
    unmount();
    expect(client.removeChannel).toHaveBeenCalledTimes(2);
  });

  it('waits for removal before joining the same topic again', async () => {
    vi.useFakeTimers();
    const statuses: Array<(status: string) => void> = [];
    subscribeMock.mockImplementation(callback => { statuses.push(callback); return mockChannel; });
    const { unmount } = renderHook(() => useRealtime('match-123'));
    await act(async () => {});
    const client = await getSupabaseClientMock.mock.results[0].value;
    let removed!: () => void;
    client.removeChannel.mockReturnValueOnce(new Promise<void>(resolve => { removed = resolve; }));
    const wal = statuses[channelMock.mock.calls.findIndex(([name]) => name === 'dart_match_match-123')];
    await act(async () => wal('CLOSED'));
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(channelMock.mock.calls.filter(([name]) => name === 'dart_match_match-123')).toHaveLength(1);
    await act(async () => removed());
    expect(channelMock.mock.calls.filter(([name]) => name === 'dart_match_match-123')).toHaveLength(2);
    unmount();
  });

  it('lets the SDK recover without replacing a healthy channel', async () => {
    vi.useFakeTimers();
    const statuses: Array<(status: string) => void> = [];
    subscribeMock.mockImplementation(callback => { statuses.push(callback); return mockChannel; });
    renderHook(() => useRealtime('match-123'));
    await act(async () => {});
    const wal = statuses[channelMock.mock.calls.findIndex(([name]) => name === 'dart_match_match-123')];
    await act(async () => wal('CHANNEL_ERROR'));
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    await act(async () => wal('SUBSCRIBED'));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(channelMock.mock.calls.filter(([name]) => name === 'dart_match_match-123')).toHaveLength(1);
  });

  it('exposes the SDK failure and retains it after recovery without accepting stale failures', async () => {
    const statuses: Array<(status: string, error?: Error) => void> = [];
    subscribeMock.mockImplementation(callback => { statuses.push(callback); return mockChannel; });
    const { result, rerender } = renderHook(id => useRealtime(id), { initialProps: 'match-123' });
    await act(async () => {});
    const wal = statuses[channelMock.mock.calls.findIndex(([name]) => name === 'dart_match_match-123')];
    await act(async () => wal('CHANNEL_ERROR', new Error('mismatch between server and client bindings')));
    expect(result.current.connectionError).toBe('mismatch between server and client bindings');
    await act(async () => wal('CHANNEL_ERROR'));
    expect(result.current.connectionError).toBe('mismatch between server and client bindings');
    await act(async () => wal('SUBSCRIBED'));
    expect(result.current.isConnected).toBe(true);
    expect(result.current.connectionError).toBe('mismatch between server and client bindings');
    await act(async () => rerender('other-match'));
    expect(result.current.connectionError).toBeNull();
    await act(async () => wal('CHANNEL_ERROR', new Error('late error')));
    expect(result.current.connectionError).toBeNull();
  });

});
