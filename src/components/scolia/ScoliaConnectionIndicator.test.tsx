import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScoliaBoardConnection } from './ScoliaConnectionIndicator';

type Handlers = {
  onUpsert: (status: object) => void;
  onChannelStatus?: (status: string) => void;
  onReconcile: () => void;
};
let handlers: Handlers | null = null;
let hookBoardId: string | null | undefined;
const row = vi.fn();

vi.mock('@/hooks/useScoliaBoardRealtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useScoliaBoardRealtime')>()),
  useScoliaBoardRealtime: (next: Handlers, _enabled: boolean, boardId?: string | null) => {
    handlers = next;
    hookBoardId = boardId;
  },
}));
vi.mock('@/lib/supabaseClient', () => ({
  getSupabaseClient: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row(), error: null }) }) }) }),
  }),
}));

const fresh = () => ({
  board_id: 'b1', name: 'Bergen', is_home_sbc: false, worker_connection_status: 'connected',
  board_status: 'Ready', board_phase: 'Throw', error_type: null, last_event_at: null,
  worker_heartbeat_at: new Date().toISOString(),
});

beforeEach(() => {
  handlers = null;
  row.mockImplementation(fresh);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ScoliaBoardConnection', () => {
  it('subscribes to its one board and shows it ready', async () => {
    render(<ScoliaBoardConnection boardId="b1" />);
    expect(await screen.findByText('Board ready')).toBeTruthy();
    expect(hookBoardId).toBe('b1');
  });

  it('turns into a worker outage once heartbeats stop, without any new event', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<ScoliaBoardConnection boardId="b1" />);
    await screen.findByText('Board ready');
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByText(/Scolia worker offline/)).toBeTruthy();
  });

  it('shows when this viewer’s own live updates are paused, and refetches on resubscribe', async () => {
    const onStatusChange = vi.fn();
    render(<ScoliaBoardConnection boardId="b1" onStatusChange={onStatusChange} />);
    await screen.findByText('Board ready');
    act(() => handlers!.onChannelStatus?.('CHANNEL_ERROR'));
    expect(screen.getByText('Live updates paused')).toBeTruthy();

    row.mockImplementation(() => ({ ...fresh(), board_phase: 'Takeout' }));
    act(() => {
      handlers!.onChannelStatus?.('SUBSCRIBED');
      handlers!.onReconcile();
    });
    await waitFor(() => expect(screen.getByText('Board ready')).toBeTruthy());
    await waitFor(() => expect(onStatusChange).toHaveBeenLastCalledWith(expect.objectContaining({ boardPhase: 'Takeout' })));
  });
});
