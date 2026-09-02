import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

vi.mock('server-only', () => ({}));

const getSupabaseServerClientMock = vi.fn();

vi.mock('@/lib/supabaseServer', () => ({
  getSupabaseServerClient: () => getSupabaseServerClientMock(),
}));

describe('GET /api/scolia/boards/available', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-01T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('marks only live, ready, unused boards as selectable', async () => {
    const boards = [
      {
        id: 'ready-board',
        name: 'Ready board',
        is_home_sbc: true,
        worker_connection_status: 'connected',
        board_status: 'Ready',
        worker_heartbeat_at: '2026-09-01T11:59:30.000Z',
      },
      {
        id: 'busy-board',
        name: 'Busy board',
        is_home_sbc: false,
        worker_connection_status: 'connected',
        board_status: 'Ready',
        worker_heartbeat_at: '2026-09-01T11:59:30.000Z',
      },
      {
        id: 'stale-board',
        name: 'Stale board',
        is_home_sbc: false,
        worker_connection_status: 'connected',
        board_status: 'Ready',
        worker_heartbeat_at: '2026-09-01T11:58:00.000Z',
      },
    ];
    const activeMatches = [{ id: 'match-1', scolia_board_id: 'busy-board' }];

    getSupabaseServerClientMock.mockReturnValue({
      from(table: string) {
        if (table === 'scolia_boards') {
          return {
            select() {
              return this;
            },
            eq() {
              return this;
            },
            order() {
              return Promise.resolve({ data: boards, error: null });
            },
          };
        }
        if (table === 'matches') {
          return {
            select() {
              return this;
            },
            is() {
              return this;
            },
            eq() {
              return Promise.resolve({ data: activeMatches, error: null });
            },
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    });

    const response = await GET();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.boards).toEqual([
      expect.objectContaining({ id: 'ready-board', workerConnectionStatus: 'connected', selectable: true }),
      expect.objectContaining({ id: 'busy-board', activeMatchId: 'match-1', selectable: false }),
      expect.objectContaining({ id: 'stale-board', workerConnectionStatus: 'disconnected', selectable: false }),
    ]);
  });
});
