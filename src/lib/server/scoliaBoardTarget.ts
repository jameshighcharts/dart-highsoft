import type { SupabaseClient } from '@supabase/supabase-js';

import { isScoliaBoardReady } from '../scolia/availability.ts';

export type ScoliaBoardTarget =
  | { kind: 'match'; id: string }
  | { kind: 'game'; id: string };

export async function findActiveScoliaBoardTarget(
  supabase: SupabaseClient,
  boardId: string
): Promise<ScoliaBoardTarget | null> {
  const [matchResult, gameResult] = await Promise.all([
    supabase
      .from('matches')
      .select('id, created_at')
      .eq('scolia_board_id', boardId)
      .is('winner_player_id', null)
      .is('completed_at', null)
      .eq('ended_early', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('game_sessions')
      .select('id, created_at')
      .eq('scolia_board_id', boardId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (matchResult.error) throw new Error(matchResult.error.message);
  if (gameResult.error && gameResult.error.code !== '42P01') throw new Error(gameResult.error.message);

  const match = matchResult.data as { id: string; created_at: string } | null;
  const game = (gameResult.data ?? null) as { id: string; created_at: string } | null;
  if (match && game) {
    console.warn(`[scolia] board ${boardId} has both an active match and game session; using the newest`);
    return Date.parse(game.created_at) > Date.parse(match.created_at)
      ? { kind: 'game', id: game.id }
      : { kind: 'match', id: match.id };
  }
  if (match) return { kind: 'match', id: match.id };
  if (game) return { kind: 'game', id: game.id };
  return null;
}

export type ScoliaBoardAvailability =
  | { ok: true }
  | { ok: false; status: 404 | 409; error: string };

/** Board exists, is enabled, is ready, and is not driving anything else. */
export async function assertScoliaBoardAvailable(
  supabase: SupabaseClient,
  boardId: string
): Promise<ScoliaBoardAvailability> {
  const [boardResult, target] = await Promise.all([
    supabase
      .from('scolia_boards')
      .select('worker_connection_status, board_status, worker_heartbeat_at')
      .eq('id', boardId)
      .eq('enabled', true)
      .maybeSingle(),
    findActiveScoliaBoardTarget(supabase, boardId),
  ]);
  if (boardResult.error) throw new Error(boardResult.error.message);
  if (!boardResult.data) return { ok: false, status: 404, error: 'Scolia board not found' };
  if (target) {
    return {
      ok: false,
      status: 409,
      error: target.kind === 'match'
        ? 'This Scolia board is already assigned to an active match'
        : 'This Scolia board is already assigned to an active game',
    };
  }
  const board = boardResult.data as {
    worker_connection_status: string;
    board_status: string | null;
    worker_heartbeat_at: string | null;
  };
  if (!isScoliaBoardReady({
    workerConnectionStatus: board.worker_connection_status,
    boardStatus: board.board_status,
    workerHeartbeatAt: board.worker_heartbeat_at,
  })) {
    return { ok: false, status: 409, error: 'This Scolia board is not ready' };
  }
  return { ok: true };
}
