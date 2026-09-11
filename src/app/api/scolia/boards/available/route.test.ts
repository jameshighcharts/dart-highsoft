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

/** Resolves the `select(...).in(...)` summary queries with fixed rows. */
function inQuery(rows: unknown[]) {
  return {
    select() {
      return this;
    },
    in() {
      return Promise.resolve({ data: rows, error: null });
    },
  };
}

function mockSupabase({
  boards,
  activeMatches = [],
  activeGames = [],
  gameSessionsError = null,
  matchDetails = [],
  legs = [],
  turns = [],
  gameDetails = [],
  gameThrows = [],
}: {
  boards: BoardRow[];
  activeMatches?: ActiveRow[];
  activeGames?: ActiveRow[];
  gameSessionsError?: { message: string; code?: string } | null;
  matchDetails?: unknown[];
  legs?: unknown[];
  turns?: unknown[];
  gameDetails?: unknown[];
  gameThrows?: unknown[];
}) {
  return {
    from(table: string) {
      if (table === 'legs') return inQuery(legs);
      if (table === 'turns') return inQuery(turns);
      if (table === 'game_throws') return inQuery(gameThrows);
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
          in() {
            return Promise.resolve({ data: matchDetails, error: null });
          },
        };
      }
      if (table === 'game_sessions') {
        return {
          select() {
            return this;
          },
          in() {
            return Promise.resolve({ data: gameDetails, error: null });
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
    const matchDetails = [{
      id: 'match-1',
      start_score: 501,
      legs_to_win: 2,
      created_at: '2026-09-01T11:30:00.000Z',
      match_players: [
        { play_order: 1, player: { display_name: 'Bob' } },
        { play_order: 0, player: { display_name: 'Alice' } },
      ],
    }];
    const legs = [{ id: 'leg-1', match_id: 'match-1', created_at: '2026-09-01T11:30:00.000Z' }];
    const turns = [
      { leg_id: 'leg-1', created_at: '2026-09-01T11:40:00.000Z' },
      { leg_id: 'leg-1', created_at: '2026-09-01T11:41:00.000Z' },
    ];

    getSupabaseServerClientMock.mockReturnValue(mockSupabase({ boards, activeMatches, matchDetails, legs, turns }));

    const response = await GET();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.boards).toEqual([
      expect.objectContaining({ id: 'ready-board', workerConnectionStatus: 'connected', activeGameSessionId: null, selectable: true }),
      expect.objectContaining({
        id: 'busy-board',
        activeMatchId: 'match-1',
        selectable: false,
        activeGame: {
          kind: 'match',
          id: 'match-1',
          label: '501 · first to 2 legs',
          players: ['Alice', 'Bob'],
          startedAt: '2026-09-01T11:30:00.000Z',
          lastActivityAt: '2026-09-01T11:41:00.000Z',
          legsPlayed: 1,
          turnsTaken: 2,
        },
      }),
      expect.objectContaining({ id: 'stale-board', workerConnectionStatus: 'disconnected', selectable: false }),
    ]);
  });

  it('marks a board driving an active party game as busy', async () => {
    const boards = [readyBoard('game-board'), readyBoard('free-board')];
    const activeGames = [{ id: 'game-1', scolia_board_id: 'game-board' }];
    const gameDetails = [{
      id: 'game-1',
      mode: 'cricket',
      created_at: '2026-09-01T11:50:00.000Z',
      game_session_players: [{ play_order: 0, player: { display_name: 'Cara' } }],
    }];
    const gameThrows = [{ session_id: 'game-1', created_at: '2026-09-01T11:55:00.000Z' }];

    getSupabaseServerClientMock.mockReturnValue(mockSupabase({ boards, activeGames, gameDetails, gameThrows }));

    const response = await GET();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.boards).toEqual([
      expect.objectContaining({
        id: 'game-board',
        activeMatchId: null,
        activeGameSessionId: 'game-1',
        selectable: false,
        activeGame: expect.objectContaining({ kind: 'game', label: 'Cricket', players: ['Cara'], turnsTaken: 1, legsPlayed: null }),
      }),
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
