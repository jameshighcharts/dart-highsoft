import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';
import { createSupabaseMock, type MockRow } from '@/test-utils/gameSupabaseMock';
import { cricketSession, PLAYER_A, PLAYER_B, scriptCricketRows, SESSION_ID, sessionPlayerRows } from '@/test-utils/gameFixtures';

vi.mock('server-only', () => ({}));

const getSupabaseServerClientMock = vi.fn();

vi.mock('@/lib/supabaseServer', () => ({
  getSupabaseServerClient: () => getSupabaseServerClientMock(),
}));

const ORDER = [PLAYER_A, PLAYER_B];
const request = new Request(`http://localhost/api/games/${SESSION_ID}`);
const params = Promise.resolve({ id: SESSION_ID });

describe('GET /api/games/[id]', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('returns 404 for a missing game', async () => {
    getSupabaseServerClientMock.mockReturnValue(createSupabaseMock({
      game_sessions: [],
      game_session_players: [],
      game_throws: [],
    }));
    const response = await GET(request, { params });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Game not found' });
  });

  it('returns the session, players, throws and derived state', async () => {
    const rows = scriptCricketRows(ORDER, [[PLAYER_A, 'T20'], [PLAYER_A, 'T20'], [PLAYER_A, 'T20']]);
    getSupabaseServerClientMock.mockReturnValue(createSupabaseMock({
      game_sessions: [cricketSession() as unknown as MockRow],
      game_session_players: sessionPlayerRows(ORDER),
      game_throws: rows,
    }));

    const response = await GET(request, { params });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.session.id).toBe(SESSION_ID);
    expect(json.players).toEqual([
      { player_id: PLAYER_A, play_order: 0, display_name: 'Player 1' },
      { player_id: PLAYER_B, play_order: 1, display_name: 'Player 2' },
    ]);
    expect(json.throws).toHaveLength(3);
    expect(json.state).toEqual(expect.objectContaining({ currentPlayerId: PLAYER_B, turnIndex: 1, round: 1 }));
    expect(json.state.perPlayer[PLAYER_A]).toEqual(expect.objectContaining({ points: 120 }));
  });

  it('returns 500 when loading fails', async () => {
    getSupabaseServerClientMock.mockReturnValue(createSupabaseMock({
      game_sessions: () => ({ data: null, error: { message: 'down' } }),
      game_session_players: [],
      game_throws: [],
    }));
    const response = await GET(request, { params });
    expect(response.status).toBe(500);
  });
});
