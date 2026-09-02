import { afterEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

vi.mock('server-only', () => ({}));

const getSupabaseServerClientMock = vi.fn();

vi.mock('@/lib/supabaseServer', () => ({
  getSupabaseServerClient: () => getSupabaseServerClientMock(),
}));

function createSupabase(options?: { matchInsertError?: { code: string; message: string } }) {
  let matchInsert: Record<string, unknown> | null = null;
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
          insert(payload: Record<string, unknown>) {
            matchInsert = payload;
            return {
              select() { return this; },
              async single() {
                return options?.matchInsertError
                  ? { data: null, error: options.matchInsertError }
                  : { data: { id: 'match-2', ...payload }, error: null };
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
          insert() { return Promise.resolve({ error: null }); },
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
      if (table === 'legs') {
        return { insert: () => Promise.resolve({ error: null }) };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };

  return { supabase, getMatchInsert: () => matchInsert };
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
    expect(test.getMatchInsert()).toEqual(expect.objectContaining({
      scolia_board_id: 'board-1',
      start_score: '501',
      rematch_of_match_id: 'match-1',
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
      error: 'The Scolia board is already assigned to another active match',
    });
  });
});
