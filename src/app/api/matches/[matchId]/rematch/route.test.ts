import { afterEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

vi.mock('server-only', () => ({}));

const getSupabaseServerClientMock = vi.fn();

vi.mock('@/lib/supabaseServer', () => ({
  getSupabaseServerClient: () => getSupabaseServerClientMock(),
}));

function createSupabase(options?: { matchInsertError?: { code: string; message: string } }) {
  let matchCreation: Record<string, unknown> | null = null;
  const sourceMatch = {
    id: 'match-1',
    start_score: '501',
    finish: 'double_out',
    legs_to_win: 3,
    fair_ending: false,
    winner_player_id: 'player-1',
    completed_at: '2026-09-01T12:00:00.000Z',
    ended_early: false,
    scolia_board_id: 'board-1',
  };

  const supabase = {
    from(table: string) {
      if (table === 'matches') {
        return {
          select() {
            return {
              eq() {
                return {
                  async single() {
                    return { data: sourceMatch, error: null };
                  },
                };
              },
            };
          },
        };
      }
      if (table === 'match_players') {
        return {
          select() { return this; },
          eq() { return this; },
          order() {
            return Promise.resolve({
              data: [
                { player_id: 'player-1', play_order: 0 },
                { player_id: 'player-2', play_order: 1 },
              ],
              error: null,
            });
          },
        };
      }
      if (table === 'scolia_boards') {
        return {
          select() { return this; },
          eq() { return this; },
          maybeSingle() {
            return Promise.resolve({
              data: {
                id: 'board-1',
                worker_connection_status: 'connected',
                board_status: 'Ready',
                worker_heartbeat_at: '2026-09-01T11:59:50.000Z',
              },
              error: null,
            });
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
    rpc(name: string, args: Record<string, unknown>) {
      if (name !== 'create_x01_match_atomic') throw new Error(`Unexpected RPC: ${name}`);
      matchCreation = args;
      return {
        async single() {
          return options?.matchInsertError
            ? { data: null, error: options.matchInsertError }
            : { data: { id: 'match-2' }, error: null };
        },
      };
    },
  };

  return { supabase, getMatchCreation: () => matchCreation };
}

describe('POST /api/matches/[matchId]/rematch', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('carries a ready Scolia board into the rematch', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-01T12:00:00.000Z'));
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const test = createSupabase();
    getSupabaseServerClientMock.mockReturnValue(test.supabase);

    const response = await POST(new Request('http://localhost'), {
      params: Promise.resolve({ matchId: 'match-1' }),
    });

    expect(response.status).toBe(200);
    expect(test.getMatchCreation()).toEqual(expect.objectContaining({
      p_scolia_board_id: 'board-1',
      p_start_score: '501',
      p_player_ids: ['player-2', 'player-1'],
    }));
    await expect(response.json()).resolves.toEqual({ newMatchId: 'match-2' });
  });

  it('reports a board conflict when another match claims it first', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-01T12:00:00.000Z'));
    const test = createSupabase({
      matchInsertError: { code: '23505', message: 'duplicate key' },
    });
    getSupabaseServerClientMock.mockReturnValue(test.supabase);

    const response = await POST(new Request('http://localhost'), {
      params: Promise.resolve({ matchId: 'match-1' }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'This Scolia board is already assigned to another active match or game',
    });
  });
});
