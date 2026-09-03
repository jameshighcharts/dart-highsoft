import type { SupabaseClient } from '@supabase/supabase-js';

import type { GameMode, GameSessionStatus } from '../games/types.ts';

export type GameSessionRow = {
  id: string;
  mode: GameMode;
  config: Record<string, unknown>;
  status: GameSessionStatus;
  winner_player_id: string | null;
  scolia_board_id: string | null;
  created_at: string;
  completed_at: string | null;
};

export const GAME_SESSION_COLUMNS = 'id, mode, config, status, winner_player_id, scolia_board_id, created_at, completed_at';

export async function loadGameSession(supabase: SupabaseClient, sessionId: string): Promise<GameSessionRow | null> {
  const { data, error } = await supabase
    .from('game_sessions')
    .select(GAME_SESSION_COLUMNS)
    .eq('id', sessionId)
    .maybeSingle();
  if (error || !data) return null;
  return data as GameSessionRow;
}

export function isGameSessionActive(session: GameSessionRow): boolean {
  return session.status === 'active';
}
