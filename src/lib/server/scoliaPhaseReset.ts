import type { SupabaseClient } from '@supabase/supabase-js';
import { isMatchActive, loadMatch } from './matchGuards.ts';
import { isScoliaBoardReady, isScoliaTakeoutStuck } from '../scolia/availability.ts';

/**
 * A reset is only offered at the start of a match, before its first dart, while the
 * board is stuck in Takeout. Mid-match takeouts are left to the board itself.
 */
export async function checkScoliaPhaseReset(db: SupabaseClient, matchId: string) {
  const match = await loadMatch(db, matchId);
  if (!match || !isMatchActive(match) || !match.scolia_board_id) {
    return { error: 'This match no longer has an active Scolia board.' } as const;
  }
  const [darts, board] = await Promise.all([
    db.from('throws').select('id').eq('match_id', matchId).limit(1),
    db.from('scolia_boards')
      .select('id, board_status, board_phase, board_phase_changed_at, worker_connection_status, worker_heartbeat_at')
      .eq('id', match.scolia_board_id).eq('enabled', true).maybeSingle(),
  ]);
  if (darts.error || board.error) throw new Error(darts.error?.message ?? board.error!.message);
  if (darts.data?.length) return { error: 'The match has already started. Reset is only available before the first dart.' } as const;
  const b = board.data;
  if (!b || !isScoliaBoardReady({ workerConnectionStatus: b.worker_connection_status,
    boardStatus: b.board_status, workerHeartbeatAt: b.worker_heartbeat_at })) {
    return { error: 'The board is offline or not ready. Reconnect it before resetting.' } as const;
  }
  if (b.board_phase !== 'Takeout') return { error: 'The board is no longer waiting for dart removal.' } as const;
  if (!isScoliaTakeoutStuck({ boardPhase: b.board_phase, boardPhaseChangedAt: b.board_phase_changed_at }, Date.now(), match.created_at)) {
    return { error: 'The board is still removing darts. Give it a few seconds.' } as const;
  }
  return { boardId: b.id as string } as const;
}
