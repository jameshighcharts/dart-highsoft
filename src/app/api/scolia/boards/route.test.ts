import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

vi.mock('server-only', () => ({}));

const listScoliaBoardsMock = vi.fn();
const getSupabaseServerClientMock = vi.fn();

vi.mock('@/lib/scolia/access', () => ({
  requireScoliaBoardManagementAccess: () => null,
}));

vi.mock('@/lib/scolia/client', () => ({
  listScoliaBoards: (...args: unknown[]) => listScoliaBoardsMock(...args),
  connectScoliaBoard: vi.fn(),
  ScoliaApiError: class ScoliaApiError extends Error {},
}));

vi.mock('@/lib/supabaseServer', () => ({
  getSupabaseServerClient: () => getSupabaseServerClientMock(),
}));

describe('GET /api/scolia/boards', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('includes the ongoing app match for each busy board', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-01T12:00:00.000Z'));
    listScoliaBoardsMock.mockResolvedValue([{
      name: 'Office board',
      serialNumber: 'SCOLIA-1',
      isHomeSbc: false,
    }]);

    const statuses = [{
      id: 'board-1',
      serial_number: 'SCOLIA-1',
      worker_connection_status: 'connected',
      board_status: 'Ready',
      board_phase: 'Throw',
      error_type: null,
      last_event_at: '2026-09-01T11:59:59.000Z',
      worker_heartbeat_at: '2026-09-01T11:59:50.000Z',
    }];
    const activeMatches = [{
      id: 'match-1',
      scolia_board_id: 'board-1',
      start_score: '501',
      legs_to_win: 3,
      created_at: '2026-09-01T11:30:00.000Z',
      match_players: [
        { play_order: 1, players: { display_name: 'Second' } },
        { play_order: 0, players: { display_name: 'First' } },
      ],
      legs: [{ winner_player_id: 'player-1' }, { winner_player_id: null }],
    }];

    getSupabaseServerClientMock.mockReturnValue({
      from(table: string) {
        if (table === 'scolia_boards') {
          return {
            select() { return this; },
            eq() { return Promise.resolve({ data: statuses, error: null }); },
          };
        }
        if (table === 'matches') {
          return {
            select() { return this; },
            not() { return this; },
            is() { return this; },
            eq() { return Promise.resolve({ data: activeMatches, error: null }); },
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.boards[0]).toEqual(expect.objectContaining({
      name: 'Office board',
      workerConnectionStatus: 'connected',
      activeMatch: {
        id: 'match-1',
        startScore: '501',
        legsToWin: 3,
        completedLegs: 1,
        playerNames: ['First', 'Second'],
        createdAt: '2026-09-01T11:30:00.000Z',
      },
    }));
  });
});
