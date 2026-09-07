import type { SupabaseClient } from '@supabase/supabase-js';

export type CreateMatchForPlayersInput = {
  startScore: '201' | '301' | '501';
  finish: 'single_out' | 'double_out';
  legsToWin: number;
  fairEnding: boolean;
  playerIds: string[];
  scoliaBoardId: string | null;
  rematchOfMatchId?: string | null;
};

export type CreateMatchForPlayersResult =
  | { ok: true; matchId: string }
  | { ok: false; status: 409; error: string };

export async function createMatchForPlayers(
  supabase: SupabaseClient,
  input: CreateMatchForPlayersInput
): Promise<CreateMatchForPlayersResult> {
  const { data, error } = await supabase
    .rpc('create_x01_match_atomic', {
      p_start_score: input.startScore,
      p_finish: input.finish,
      p_legs_to_win: input.legsToWin,
      p_fair_ending: input.fairEnding,
      p_player_ids: input.playerIds,
      p_scolia_board_id: input.scoliaBoardId,
      p_rematch_of_match_id: input.rematchOfMatchId ?? null,
    })
    .single();

  if (error || !data) {
    if (error?.code === '23505' && input.scoliaBoardId) {
      return {
        ok: false,
        status: 409,
        error: 'This Scolia board is already assigned to another active match or game',
      };
    }
    throw new Error(error?.message ?? 'Failed to create match');
  }

  if (typeof data !== 'object' || typeof (data as { id?: unknown }).id !== 'string') {
    throw new Error('Match creation returned an invalid match');
  }

  return { ok: true, matchId: (data as { id: string }).id };
}
