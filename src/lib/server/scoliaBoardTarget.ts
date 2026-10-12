import type { SupabaseClient } from '@supabase/supabase-js';

import { isScoliaBoardReady } from '../scolia/availability.ts';

export type ScoliaBoardTarget =
  | { kind: 'match'; id: string }
  | { kind: 'game'; id: string };

export async function findActiveScoliaBoardTarget(
  supabase: SupabaseClient,
  boardId: string
): Promise<ScoliaBoardTarget | null> {
  const occupant = await findActiveScoliaBoardOccupant(supabase, boardId);
  return occupant && { kind: occupant.kind, id: occupant.id } as ScoliaBoardTarget;
}

export type ScoliaBoardOccupant = ScoliaBoardTarget & {
  createdAt: string;
  /** Only a match mid bull-off needs its full row loaded when the board reports a takeout. */
  bullOffThrowing: boolean;
};

/** The active target plus when it started, so older board events can be kept out of it. */
export async function findActiveScoliaBoardOccupant(
  supabase: SupabaseClient,
  boardId: string
): Promise<ScoliaBoardOccupant | null> {
  const [matchResult, gameResult] = await Promise.all([
    supabase
      .from('matches')
      .select('id, created_at, bull_off_phase:bull_off->>phase')
      .eq('scolia_board_id', boardId)
      .is('winner_player_id', null)
      .is('completed_at', null)
      .eq('ended_early', false)
      .is('paused_at', null)
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

  const match = matchResult.data as { id: string; created_at: string; bull_off_phase: string | null } | null;
  const game = (gameResult.data ?? null) as { id: string; created_at: string } | null;
  const matchOccupant = match && {
    kind: 'match' as const, id: match.id, createdAt: match.created_at, bullOffThrowing: match.bull_off_phase === 'throwing',
  };
  const gameOccupant = game && { kind: 'game' as const, id: game.id, createdAt: game.created_at, bullOffThrowing: false };
  if (matchOccupant && gameOccupant) {
    console.warn(`[scolia] board ${boardId} has both an active match and game session; using the newest`);
    return Date.parse(gameOccupant.createdAt) > Date.parse(matchOccupant.createdAt) ? gameOccupant : matchOccupant;
  }
  return matchOccupant ?? gameOccupant ?? null;
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
