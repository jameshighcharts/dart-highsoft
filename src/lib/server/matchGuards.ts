import type { SupabaseClient } from '@supabase/supabase-js';

export type MatchRow = {
  id: string;
  winner_player_id: string | null;
  completed_at: string | null;
  ended_early: boolean;
  start_score: string;
  finish: 'single_out' | 'double_out';
  legs_to_win: number;
  fair_ending: boolean;
  paused_at?: string | null;
  tournament_match_id: string | null;
  scolia_board_id?: string | null;
};

export async function loadMatch(supabase: SupabaseClient, matchId: string): Promise<MatchRow | null> {
  const { data, error } = await supabase
    .from('matches')
    .select('id, winner_player_id, completed_at, ended_early, start_score, finish, legs_to_win, fair_ending, paused_at, tournament_match_id, scolia_board_id')
    .eq('id', matchId)
    .single();
  if (error || !data) return null;
  return data as MatchRow;
}

export function isMatchActive(match: MatchRow): boolean {
  return !match.ended_early && !match.winner_player_id && !match.completed_at;
}

export function isMatchPaused(match: Pick<MatchRow, 'paused_at'>): boolean {
  return Boolean(match.paused_at);
}

export function isMatchScoringActive(match: MatchRow): boolean {
  return isMatchActive(match) && !isMatchPaused(match);
}
