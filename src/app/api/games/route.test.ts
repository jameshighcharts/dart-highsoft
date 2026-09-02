import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';
import { createSupabaseMock, filterValue, type MockOp, type MockRow, type TableHandler } from '@/test-utils/gameSupabaseMock';
import { BOARD_ID, PLAYER_A, PLAYER_B, PLAYER_C } from '@/test-utils/gameFixtures';

vi.mock('server-only', () => ({}));

const getSupabaseServerClientMock = vi.fn();

vi.mock('@/lib/supabaseServer', () => ({
  getSupabaseServerClient: () => getSupabaseServerClientMock(),
}));

const PLAYERS = [PLAYER_A, PLAYER_B, PLAYER_C];

function request(body: unknown) {
  return new Request('http://localhost/api/games', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function readyBoard(): MockRow {
  return {
    id: BOARD_ID,
    enabled: true,
    worker_connection_status: 'connected',
    board_status: 'Ready',
    worker_heartbeat_at: new Date().toISOString(),
  };
}

function baseTables(overrides: Record<string, MockRow[] | TableHandler> = {}) {
  return {
    players: PLAYERS.map((id) => ({ id })),
    game_sessions: [] as MockRow[],
    game_session_players: [] as MockRow[],
    game_throws: [] as MockRow[],
    scolia_boards: [] as MockRow[],
    matches: [] as MockRow[],
    ...overrides,
  };
}

describe('POST /api/games', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('rejects invalid JSON', async () => {
    const response = await POST(request('{nope'));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
  });

  it('rejects an unknown mode with 400', async () => {
    const response = await POST(request({ mode: 'x01', playerIds: PLAYERS }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Unknown game mode' });
    expect(getSupabaseServerClientMock).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', undefined],
    ['not an array', PLAYER_A],
    ['non-uuid entries', ['player-1', PLAYER_B]],
    ['non-string entries', [1, 2]],
  ])('rejects playerIds that are %s with 400', async (_label, playerIds) => {
    const response = await POST(request({ mode: 'cricket', playerIds }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'playerIds must be a list of player ids' });
  });

  it('rejects a malformed scoliaBoardId with 400', async () => {
    const response = await POST(request({ mode: 'cricket', playerIds: PLAYERS, scoliaBoardId: 'board-1' }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'scoliaBoardId must be a valid id' });
  });

  it('rejects a config the engine refuses with 400', async () => {
    const supabase = createSupabaseMock(baseTables());
    getSupabaseServerClientMock.mockReturnValue(supabase);

    const response = await POST(request({ mode: 'cricket', playerIds: PLAYERS, config: { variant: 'golf' } }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'variant must be "standard" or "cut_throat"' });
    expect(supabase.ops).toHaveLength(0);
  });

  it('rejects duplicate players and too few players with 400', async () => {
    const supabase = createSupabaseMock(baseTables());
    getSupabaseServerClientMock.mockReturnValue(supabase);

    const duplicates = await POST(request({ mode: 'cricket', playerIds: [PLAYER_A, PLAYER_A] }));
    expect(duplicates.status).toBe(400);
    await expect(duplicates.json()).resolves.toEqual({ error: 'Players must be unique' });

    const tooFew = await POST(request({ mode: 'cricket', playerIds: [PLAYER_A] }));
    expect(tooFew.status).toBe(400);
    await expect(tooFew.json()).resolves.toEqual({ error: 'This game needs at least 2 players' });
  });

  it('returns 404 when a player does not exist', async () => {
    const supabase = createSupabaseMock(baseTables({ players: [{ id: PLAYER_A }, { id: PLAYER_B }] }));
    getSupabaseServerClientMock.mockReturnValue(supabase);

    const response = await POST(request({ mode: 'cricket', playerIds: PLAYERS }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'One or more players were not found' });
    expect((filterValue(supabase.opsFor('players', 'select')[0]!, 'id') as string[]).slice().sort()).toEqual([...PLAYERS].sort());
    expect(supabase.opsFor('game_sessions', 'insert')).toHaveLength(0);
  });

  it('returns 404 when the Scolia board does not exist', async () => {
    const supabase = createSupabaseMock(baseTables());
    getSupabaseServerClientMock.mockReturnValue(supabase);

    const response = await POST(request({ mode: 'cricket', playerIds: PLAYERS, scoliaBoardId: BOARD_ID }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Scolia board not found' });
    expect(supabase.opsFor('game_sessions', 'insert')).toHaveLength(0);
  });

  it('returns 409 when the Scolia board is busy with a match', async () => {
    const supabase = createSupabaseMock(baseTables({
      scolia_boards: [readyBoard()],
      matches: [{ id: 'match-1', scolia_board_id: BOARD_ID, winner_player_id: null, completed_at: null, ended_early: false, created_at: 'x' }],
    }));
    getSupabaseServerClientMock.mockReturnValue(supabase);

    const response = await POST(request({ mode: 'cricket', playerIds: PLAYERS, scoliaBoardId: BOARD_ID }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'This Scolia board is already assigned to an active match' });
  });

  it('creates a session with a randomized seating order and returns the initial state', async () => {
    const tables = baseTables({ scolia_boards: [readyBoard()] });
    const supabase = createSupabaseMock(tables);
    getSupabaseServerClientMock.mockReturnValue(supabase);

    const response = await POST(request({ mode: 'cricket', playerIds: PLAYERS, config: { variant: 'cut_throat' }, scoliaBoardId: BOARD_ID }));
    const json = await response.json();

    expect(response.status).toBe(201);
    const sessionInsert = supabase.opsFor('game_sessions', 'insert')[0]!;
    expect(sessionInsert.payload).toEqual({
      mode: 'cricket',
      config: { variant: 'cut_throat', maxRounds: 20 },
      scolia_board_id: BOARD_ID,
    });
    const sessionId = tables.game_sessions[0]!.id as string;
    expect(json.gameId).toBe(sessionId);
    expect(json.session).toEqual(expect.objectContaining({ id: sessionId, mode: 'cricket' }));

    // Math.random is pinned to 0, so the Fisher-Yates shuffle of [A, B, C] is [B, C, A].
    const playersInsert = supabase.opsFor('game_session_players', 'insert')[0]!;
    expect(playersInsert.payload).toEqual([
      { session_id: sessionId, player_id: PLAYER_B, play_order: 0 },
      { session_id: sessionId, player_id: PLAYER_C, play_order: 1 },
      { session_id: sessionId, player_id: PLAYER_A, play_order: 2 },
    ]);
    expect(json.players.map((player: { player_id: string }) => player.player_id)).toEqual([PLAYER_B, PLAYER_C, PLAYER_A]);
    expect(json.state).toEqual(expect.objectContaining({
      mode: 'cricket',
      currentPlayerId: PLAYER_B,
      turnIndex: 0,
      round: 1,
      finished: false,
    }));
  });

  it('finalizes Killer config with assigned numbers for the seated order', async () => {
    const supabase = createSupabaseMock(baseTables());
    getSupabaseServerClientMock.mockReturnValue(supabase);

    const response = await POST(request({ mode: 'killer', playerIds: PLAYERS, config: { lives: 2 } }));

    expect(response.status).toBe(201);
    const config = (supabase.opsFor('game_sessions', 'insert')[0]!.payload as { config: MockRow }).config;
    expect(config).toEqual(expect.objectContaining({ lives: 2, assignment: 'random' }));
    const assigned = config.assignedNumbers as Record<string, number>;
    expect(Object.keys(assigned).sort()).toEqual([...PLAYERS].sort());
    expect(new Set(Object.values(assigned)).size).toBe(3);
    for (const value of Object.values(assigned)) {
      expect(Number.isInteger(value) && value >= 1 && value <= 20).toBe(true);
    }
  });

  it('rolls back the session when inserting players fails', async () => {
    const supabase = createSupabaseMock(baseTables({
      game_session_players: () => ({ data: null, error: { message: 'players insert failed' } }),
    }));
    getSupabaseServerClientMock.mockReturnValue(supabase);

    const response = await POST(request({ mode: 'cricket', playerIds: PLAYERS }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error' });
    expect(supabase.opsFor('game_sessions', 'insert')).toHaveLength(1);
    const deletes = supabase.opsFor('game_sessions', 'delete');
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.filters).toEqual([{ kind: 'eq', column: 'id', value: expect.any(String) }]);
  });

  it('maps a unique violation on the board assignment to 409', async () => {
    const gameSessions: TableHandler = (op: MockOp) => op.type === 'insert'
      ? { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } }
      : { data: [], error: null };
    const supabase = createSupabaseMock(baseTables({ scolia_boards: [readyBoard()], game_sessions: gameSessions }));
    getSupabaseServerClientMock.mockReturnValue(supabase);

    const response = await POST(request({ mode: 'cricket', playerIds: PLAYERS, scoliaBoardId: BOARD_ID }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'This Scolia board is already assigned to an active match or game' });
  });
});
