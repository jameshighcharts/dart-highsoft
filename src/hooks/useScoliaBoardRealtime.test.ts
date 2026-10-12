import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useScoliaBoardRealtime } from './useScoliaBoardRealtime';

const onMock = vi.fn();
const subscribeMock = vi.fn();
const channelMock = vi.fn();
const removeChannelMock = vi.fn();
const getSupabaseClientMock = vi.fn();

vi.mock('@/lib/supabaseClient', () => ({
  getSupabaseClient: () => getSupabaseClientMock(),
}));

const mockChannel = {
  on: onMock,
  subscribe: subscribeMock,
};

describe('useScoliaBoardRealtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onMock.mockReturnValue(mockChannel);
    subscribeMock.mockReturnValue(mockChannel);
    channelMock.mockReturnValue(mockChannel);
    getSupabaseClientMock.mockResolvedValue({
      channel: channelMock,
      removeChannel: removeChannelMock,
    });
  });

  it('watches both match and party-game occupancy when requested', async () => {
    const onOccupancyChange = vi.fn();
    const onReconcile = vi.fn();
    subscribeMock.mockImplementation((callback?: (status: string) => void) => {
      callback?.('SUBSCRIBED');
      return mockChannel;
    });

    const { unmount } = renderHook(() => useScoliaBoardRealtime({
      onUpsert: vi.fn(),
      onRemove: vi.fn(),
      onOccupancyChange,
      onReconcile,
    }));

    await waitFor(() => expect(subscribeMock).toHaveBeenCalledOnce());

    const occupancyCalls = onMock.mock.calls.filter(([, config]) => {
      const table = (config as { table?: string }).table;
      return table === 'matches' || table === 'game_sessions';
    });

    expect(occupancyCalls.map(([, config]) => (config as { table: string }).table)).toEqual([
      'matches',
      'game_sessions',
    ]);

    for (const call of occupancyCalls) {
      const callback = call[2] as () => void;
      callback();
    }
    expect(onOccupancyChange).toHaveBeenCalledTimes(2);
    expect(onReconcile).toHaveBeenCalledOnce();

    unmount();
    expect(removeChannelMock).toHaveBeenCalledWith(mockChannel);
  });

  it('skips occupancy subscriptions for status-only consumers', async () => {
    renderHook(() => useScoliaBoardRealtime({
      onUpsert: vi.fn(),
      onRemove: vi.fn(),
      onReconcile: vi.fn(),
    }));

    await waitFor(() => expect(subscribeMock).toHaveBeenCalledOnce());

    expect(onMock).toHaveBeenCalledOnce();
    expect(onMock.mock.calls[0][1]).toEqual(expect.objectContaining({
      table: 'scolia_board_public_status',
    }));
  });

  it('filters a single-board subscription server-side and ignores other boards', async () => {
    const onUpsert = vi.fn();
    const onRemove = vi.fn();
    renderHook(() => useScoliaBoardRealtime({ onUpsert, onRemove, onReconcile: vi.fn() }, true, 'board-1'));

    await waitFor(() => expect(subscribeMock).toHaveBeenCalledOnce());

    const configs = onMock.mock.calls.map(([, config]) => config as { event: string; filter?: string });
    expect(configs).toEqual([
      expect.objectContaining({ event: 'INSERT', filter: 'board_id=eq.board-1' }),
      expect.objectContaining({ event: 'UPDATE', filter: 'board_id=eq.board-1' }),
      expect.objectContaining({ event: 'DELETE' }),
    ]);
    expect(configs[2].filter).toBeUndefined();

    const update = onMock.mock.calls[1][2] as (payload: { new: unknown }) => void;
    update({ new: { board_id: 'board-1', name: 'Bergen', worker_connection_status: 'connected' } });
    expect(onUpsert).toHaveBeenCalledWith(expect.objectContaining({ boardId: 'board-1' }));

    const remove = onMock.mock.calls[2][2] as (payload: { old: unknown }) => void;
    remove({ old: { board_id: 'board-2' } });
    expect(onRemove).not.toHaveBeenCalled();
    remove({ old: { board_id: 'board-1' } });
    expect(onRemove).toHaveBeenCalledWith('board-1');
  });
});
