import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

vi.mock('server-only', () => ({}));

const getSupabaseServerClientMock = vi.fn();

vi.mock('@/lib/supabaseServer', () => ({
  getSupabaseServerClient: () => getSupabaseServerClientMock(),
}));

type BoardRow = {
  id: string;
  name: string;
  is_home_sbc: boolean;
  worker_connection_status: string;
  board_status: string | null;
  worker_heartbeat_at: string | null;
};

type ActiveRow = { id: string; scolia_board_id: string | null };

function readyBoard(id: string, overrides: Partial<BoardRow> = {}): BoardRow {
  return {
    id,
    name: `${id} board`,
    is_home_sbc: false,
    worker_connection_status: 'connected',
    board_status: 'Ready',
    worker_heartbeat_at: '2026-09-01T11:59:30.000Z',
    ...overrides,
  };
}

function mockSupabase({
  boards,
  activeMatches = [],
  activeGames = [],
  gameSessionsError = null,
}: {
  boards: BoardRow[];
  activeMatches?: ActiveRow[];
  activeGames?: ActiveRow[];
  gameSessionsError?: { message: string; code?: string } | null;
}) {
  return {
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
      if (table === 'game_sessions') {
        return {
          select() {
            return this;
          },
          eq(column: string, value: unknown) {
            expect([column, value]).toEqual(['status', 'active']);
            return this;
          },
          not(column: string, operator: string, value: unknown) {
            expect([column, operator, value]).toEqual(['scolia_board_id', 'is', null]);
            return Promise.resolve(gameSessionsError
              ? { data: null, error: gameSessionsError }
              : { data: activeGames, error: null });
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

describe('GET /api/scolia/boards/available', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-01T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('marks only live, ready, unused boards as selectable', async () => {
    const boards = [
      readyBoard('ready-board', { name: 'Ready board', is_home_sbc: true }),
      readyBoard('busy-board', { name: 'Busy board' }),
      readyBoard('stale-board', { name: 'Stale board', worker_heartbeat_at: '2026-09-01T11:58:00.000Z' }),
    ];
    const activeMatches = [{ id: 'match-1', scolia_board_id: 'busy-board' }];

    getSupabaseServerClientMock.mockReturnValue(mockSupabase({ boards, activeMatches }));

    const response = await GET();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.boards).toEqual([
      expect.objectContaining({ id: 'ready-board', workerConnectionStatus: 'connected', activeGameSessionId: null, selectable: true }),
      expect.objectContaining({ id: 'busy-board', activeMatchId: 'match-1', selectable: false }),
      expect.objectContaining({ id: 'stale-board', workerConnectionStatus: 'disconnected', selectable: false }),
    ]);
  });

  it('marks a board driving an active party game as busy', async () => {
    const boards = [readyBoard('game-board'), readyBoard('free-board')];
    const activeGames = [{ id: 'game-1', scolia_board_id: 'game-board' }];

    getSupabaseServerClientMock.mockReturnValue(mockSupabase({ boards, activeGames }));

    const response = await GET();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.boards).toEqual([
      expect.objectContaining({ id: 'game-board', activeMatchId: null, activeGameSessionId: 'game-1', selectable: false }),
      expect.objectContaining({ id: 'free-board', activeMatchId: null, activeGameSessionId: null, selectable: true }),
    ]);
  });

  it('tolerates a missing game_sessions table', async () => {
    getSupabaseServerClientMock.mockReturnValue(mockSupabase({
      boards: [readyBoard('ready-board')],
      gameSessionsError: { message: 'relation "game_sessions" does not exist', code: '42P01' },
    }));

    const response = await GET();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.boards[0]).toEqual(expect.objectContaining({ id: 'ready-board', selectable: true }));
  });
});
