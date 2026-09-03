import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { assertScoliaBoardAvailable, findActiveScoliaBoardTarget } from './scoliaBoardTarget.ts';
import { createSupabaseMock, type MockRow } from '@/test-utils/gameSupabaseMock';

const BOARD = 'board-1';
const NOW = Date.parse('2026-09-01T12:00:00.000Z');

function activeMatch(overrides: Partial<MockRow> = {}): MockRow {
  return {
    id: 'match-1',
    scolia_board_id: BOARD,
    winner_player_id: null,
    completed_at: null,
    ended_early: false,
    created_at: '2026-09-01T10:00:00.000Z',
    ...overrides,
  };
}

function activeGame(overrides: Partial<MockRow> = {}): MockRow {
  return {
    id: 'game-1',
    scolia_board_id: BOARD,
    status: 'active',
    created_at: '2026-09-01T11:00:00.000Z',
    ...overrides,
  };
}

function readyBoard(overrides: Partial<MockRow> = {}): MockRow {
  return {
    id: BOARD,
    enabled: true,
    worker_connection_status: 'connected',
    board_status: 'Ready',
    worker_heartbeat_at: '2026-09-01T11:59:50.000Z',
    ...overrides,
  };
}

describe('findActiveScoliaBoardTarget', () => {
  it('returns the active match when only a match is assigned', async () => {
    const supabase = createSupabaseMock({
      matches: [activeMatch(), activeMatch({ id: 'other-board', scolia_board_id: 'board-2' }), activeMatch({ id: 'done', winner_player_id: 'p' })],
      game_sessions: [activeGame({ status: 'completed' })],
    });
    await expect(findActiveScoliaBoardTarget(supabase as never, BOARD)).resolves.toEqual({ kind: 'match', id: 'match-1' });
  });

  it('returns the active game when only a game session is assigned', async () => {
    const supabase = createSupabaseMock({
      matches: [activeMatch({ ended_early: true }), activeMatch({ id: 'completed', completed_at: '2026-09-01T10:30:00.000Z' })],
      game_sessions: [activeGame(), activeGame({ id: 'other', scolia_board_id: 'board-2' })],
    });
    await expect(findActiveScoliaBoardTarget(supabase as never, BOARD)).resolves.toEqual({ kind: 'game', id: 'game-1' });
  });

  it('returns null when nothing is assigned', async () => {
    const supabase = createSupabaseMock({ matches: [], game_sessions: [] });
    await expect(findActiveScoliaBoardTarget(supabase as never, BOARD)).resolves.toBeNull();
  });

  it('picks the newest of the two among several candidates', async () => {
    const supabase = createSupabaseMock({
      matches: [],
      game_sessions: [
        activeGame({ id: 'old', created_at: '2026-09-01T09:00:00.000Z' }),
        activeGame({ id: 'new', created_at: '2026-09-01T11:30:00.000Z' }),
      ],
    });
    await expect(findActiveScoliaBoardTarget(supabase as never, BOARD)).resolves.toEqual({ kind: 'game', id: 'new' });
    const gameQuery = supabase.opsFor('game_sessions', 'select')[0]!;
    expect(gameQuery.orders).toEqual([{ column: 'created_at', ascending: false }]);
    expect(gameQuery.limit).toBe(1);
  });

  describe('when both a match and a game are active', () => {
    beforeEach(() => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('prefers the newer game and warns', async () => {
      const supabase = createSupabaseMock({ matches: [activeMatch()], game_sessions: [activeGame()] });
      await expect(findActiveScoliaBoardTarget(supabase as never, BOARD)).resolves.toEqual({ kind: 'game', id: 'game-1' });
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(`board ${BOARD} has both an active match and game session`));
    });

    it('prefers the newer match and warns', async () => {
      const supabase = createSupabaseMock({
        matches: [activeMatch({ created_at: '2026-09-01T11:30:00.000Z' })],
        game_sessions: [activeGame()],
      });
      await expect(findActiveScoliaBoardTarget(supabase as never, BOARD)).resolves.toEqual({ kind: 'match', id: 'match-1' });
      expect(console.warn).toHaveBeenCalledTimes(1);
    });
  });

  it('tolerates a missing game_sessions table (42P01)', async () => {
    const supabase = createSupabaseMock({
      matches: [activeMatch()],
      game_sessions: () => ({ data: null, error: { message: 'relation does not exist', code: '42P01' } }),
    });
    await expect(findActiveScoliaBoardTarget(supabase as never, BOARD)).resolves.toEqual({ kind: 'match', id: 'match-1' });
  });

  it('throws on other query errors', async () => {
    const supabase = createSupabaseMock({
      matches: () => ({ data: null, error: { message: 'matches down' } }),
      game_sessions: [],
    });
    await expect(findActiveScoliaBoardTarget(supabase as never, BOARD)).rejects.toThrow('matches down');
  });
});

describe('assertScoliaBoardAvailable', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 404 when the board does not exist or is disabled', async () => {
    const supabase = createSupabaseMock({
      scolia_boards: [readyBoard({ enabled: false })],
      matches: [],
      game_sessions: [],
    });
    await expect(assertScoliaBoardAvailable(supabase as never, BOARD)).resolves.toEqual({
      ok: false,
      status: 404,
      error: 'Scolia board not found',
    });
  });

  it('returns 409 when the board drives an active match', async () => {
    const supabase = createSupabaseMock({ scolia_boards: [readyBoard()], matches: [activeMatch()], game_sessions: [] });
    await expect(assertScoliaBoardAvailable(supabase as never, BOARD)).resolves.toEqual({
      ok: false,
      status: 409,
      error: 'This Scolia board is already assigned to an active match',
    });
  });

  it('returns 409 when the board drives an active game', async () => {
    const supabase = createSupabaseMock({ scolia_boards: [readyBoard()], matches: [], game_sessions: [activeGame()] });
    await expect(assertScoliaBoardAvailable(supabase as never, BOARD)).resolves.toEqual({
      ok: false,
      status: 409,
      error: 'This Scolia board is already assigned to an active game',
    });
  });

  it.each([
    ['stale heartbeat', readyBoard({ worker_heartbeat_at: '2026-09-01T11:58:00.000Z' })],
    ['worker disconnected', readyBoard({ worker_connection_status: 'disconnected' })],
    ['board not Ready', readyBoard({ board_status: 'Takeout' })],
  ])('returns 409 not ready for %s', async (_label, board) => {
    const supabase = createSupabaseMock({ scolia_boards: [board], matches: [], game_sessions: [] });
    await expect(assertScoliaBoardAvailable(supabase as never, BOARD)).resolves.toEqual({
      ok: false,
      status: 409,
      error: 'This Scolia board is not ready',
    });
  });

  it('returns ok for a ready, unused board', async () => {
    const supabase = createSupabaseMock({ scolia_boards: [readyBoard()], matches: [], game_sessions: [] });
    await expect(assertScoliaBoardAvailable(supabase as never, BOARD)).resolves.toEqual({ ok: true });
    const boardQuery = supabase.opsFor('scolia_boards', 'select')[0]!;
    expect(boardQuery.filters).toEqual([
      { kind: 'eq', column: 'id', value: BOARD },
      { kind: 'eq', column: 'enabled', value: true },
    ]);
  });
});
