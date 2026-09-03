import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';
import { createSupabaseMock, type MockRow, type RpcHandler } from '@/test-utils/gameSupabaseMock';
import { BOARD_ID, cricketSession, PLAYER_A, PLAYER_B, PLAYER_C, SESSION_ID, sessionPlayerRows } from '@/test-utils/gameFixtures';

vi.mock('server-only', () => ({}));

const getSupabaseServerClientMock = vi.fn();

vi.mock('@/lib/supabaseServer', () => ({
  getSupabaseServerClient: () => getSupabaseServerClientMock(),
}));

const ORDER = [PLAYER_A, PLAYER_B, PLAYER_C];
const request = new Request(`http://localhost/api/games/${SESSION_ID}/rematch`, { method: 'POST' });
const params = Promise.resolve({ id: SESSION_ID });

function tables(session: MockRow) {
  return {
    game_sessions: [session],
    game_session_players: sessionPlayerRows(ORDER),
    game_throws: [] as MockRow[],
    players: ORDER.map((id) => ({ id })),
    scolia_boards: [] as MockRow[],
    matches: [] as MockRow[],
  };
}

function createSessionRpc(gameSessions: MockRow[]): RpcHandler {
  return (args) => {
    const session = {
      id: `session-${gameSessions.length + 1}`,
      mode: args.p_mode,
      config: args.p_config,
      status: 'active',
      winner_player_id: null,
      scolia_board_id: args.p_scolia_board_id,
      created_at: '2026-09-02T12:00:00.000Z',
      completed_at: null,
    };
    gameSessions.push(session);
    return { data: [session], error: null };
  };
}

describe('POST /api/games/[id]/rematch', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('returns 404 for a missing game', async () => {
    getSupabaseServerClientMock.mockReturnValue(createSupabaseMock(tables(cricketSession({ id: 'other' }) as unknown as MockRow)));
    const response = await POST(request, { params });
    expect(response.status).toBe(404);
  });

  it('returns 409 while the game is still active', async () => {
    const supabase = createSupabaseMock(tables(cricketSession() as unknown as MockRow));
    getSupabaseServerClientMock.mockReturnValue(supabase);

    const response = await POST(request, { params });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'Finish the current game before starting a rematch' });
    expect(supabase.opsFor('game_sessions', 'insert')).toHaveLength(0);
  });

  it.each([0, 0.4, 0.999])('creates a new session where the winner does not start (random=%s)', async (random) => {
    vi.spyOn(Math, 'random').mockReturnValue(random);
    const finished = cricketSession({ status: 'completed', winner_player_id: PLAYER_A, completed_at: '2026-09-01T11:00:00.000Z' });
    const t = tables(finished as unknown as MockRow);
    const supabase = createSupabaseMock(t, {
      create_game_session_atomic: createSessionRpc(t.game_sessions),
    });
    getSupabaseServerClientMock.mockReturnValue(supabase);

    const response = await POST(request, { params });
    const json = await response.json();

    expect(response.status).toBe(201);
    const newSession = t.game_sessions.find((row) => row.id !== SESSION_ID)!;
    expect(json).toEqual({ newGameId: newSession.id });
    expect(supabase.rpcFor('create_game_session_atomic')[0]!.args).toEqual({
      p_mode: 'cricket',
      p_config: finished.config,
      p_player_ids: expect.any(Array),
      p_scolia_board_id: null,
    });

    const seated = supabase.rpcFor('create_game_session_atomic')[0]!.args.p_player_ids as string[];
    expect(seated).toHaveLength(3);
    expect(seated[0]).not.toBe(PLAYER_A);
    expect(seated.slice().sort()).toEqual([...ORDER].sort());
  });

  it('keeps everyone eligible to start when the game had no winner', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const ended = cricketSession({ status: 'ended_early', completed_at: '2026-09-01T11:00:00.000Z' });
    const t = tables(ended as unknown as MockRow);
    const supabase = createSupabaseMock(t, {
      create_game_session_atomic: createSessionRpc(t.game_sessions),
    });
    getSupabaseServerClientMock.mockReturnValue(supabase);

    const response = await POST(request, { params });

    expect(response.status).toBe(201);
    const seated = supabase.rpcFor('create_game_session_atomic')[0]!.args.p_player_ids as string[];
    expect(seated[0]).toBe(PLAYER_A);
  });

  it('carries the Scolia board over and fails when the board is no longer available', async () => {
    const finished = cricketSession({ status: 'completed', winner_player_id: PLAYER_A, scolia_board_id: BOARD_ID });
    const supabase = createSupabaseMock(tables(finished as unknown as MockRow));
    getSupabaseServerClientMock.mockReturnValue(supabase);

    const response = await POST(request, { params });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Scolia board not found' });
    expect(supabase.opsFor('game_sessions', 'insert')).toHaveLength(0);
  });
});
