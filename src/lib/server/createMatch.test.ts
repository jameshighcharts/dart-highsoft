import { describe, expect, it } from 'vitest';

import { createMatchForPlayers } from './createMatch';
import { createSupabaseMock } from '@/test-utils/gameSupabaseMock';

const PLAYER_A = '00000000-0000-4000-8000-00000000000a';
const PLAYER_B = '00000000-0000-4000-8000-00000000000b';

describe('createMatchForPlayers', () => {
  it('creates the match, seats, and first leg through one RPC', async () => {
    const supabase = createSupabaseMock({}, {
      create_x01_match_atomic: () => ({ data: [{ id: 'match-1' }], error: null }),
    });

    const result = await createMatchForPlayers(supabase as never, {
      startScore: '501',
      finish: 'double_out',
      legsToWin: 3,
      fairEnding: false,
      playerIds: [PLAYER_B, PLAYER_A],
      scoliaBoardId: '00000000-0000-4000-8000-0000000000b0',
    });

    expect(result).toEqual({ ok: true, matchId: 'match-1' });
    expect(supabase.rpcFor('create_x01_match_atomic')[0]!.args).toEqual({
      p_start_score: '501',
      p_finish: 'double_out',
      p_legs_to_win: 3,
      p_fair_ending: false,
      p_player_ids: [PLAYER_B, PLAYER_A],
      p_scolia_board_id: '00000000-0000-4000-8000-0000000000b0',
      p_rematch_of_match_id: null,
    });
  });

  it('maps a competing board claim to a conflict', async () => {
    const supabase = createSupabaseMock({}, {
      create_x01_match_atomic: () => ({
        data: null,
        error: {
          code: '23505',
          message: 'Scolia board already has an active match or game session',
        },
      }),
    });

    const result = await createMatchForPlayers(supabase as never, {
      startScore: '501',
      finish: 'double_out',
      legsToWin: 1,
      fairEnding: false,
      playerIds: [PLAYER_A, PLAYER_B],
      scoliaBoardId: '00000000-0000-4000-8000-0000000000b0',
    });

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'This Scolia board is already assigned to another active match or game',
    });
  });
});
