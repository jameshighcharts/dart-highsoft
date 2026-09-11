import { NextResponse } from 'next/server';

import { hasFreshScoliaHeartbeat, isScoliaBoardReady } from '@/lib/scolia/availability';
import type { ScoliaBoardOccupant } from '@/lib/scolia/types';
import { summarizeActiveGameSessions, summarizeActiveMatches } from '@/lib/server/scoliaActiveGameSummary';
import { getSupabaseServerClient } from '@/lib/supabaseServer';

type BoardRow = {
  id: string;
  name: string;
  is_home_sbc: boolean;
  worker_connection_status: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
  board_status: string | null;
  worker_heartbeat_at: string | null;
};

type ActiveMatchRow = {
  id: string;
  scolia_board_id: string | null;
};

export async function GET() {
  try {
    const supabase = getSupabaseServerClient();
    const [boardsResult, activeMatchesResult, activeGamesResult] = await Promise.all([
      supabase
        .from('scolia_boards')
        .select('id, name, is_home_sbc, worker_connection_status, board_status, worker_heartbeat_at')
        .eq('enabled', true)
        .order('name'),
      supabase
        .from('matches')
        .select('id, scolia_board_id')
        .is('completed_at', null)
        .is('winner_player_id', null)
        .eq('ended_early', false),
      supabase
        .from('game_sessions')
        .select('id, scolia_board_id')
        .eq('status', 'active')
        .not('scolia_board_id', 'is', null),
    ]);

    if (boardsResult.error) throw new Error(boardsResult.error.message);
    if (activeMatchesResult.error) throw new Error(activeMatchesResult.error.message);
    if (activeGamesResult.error && activeGamesResult.error.code !== '42P01') {
      throw new Error(activeGamesResult.error.message);
    }
    const activeGamesByBoard = new Map(
      ((activeGamesResult.data ?? []) as ActiveMatchRow[])
        .filter((game): game is ActiveMatchRow & { scolia_board_id: string } => Boolean(game.scolia_board_id))
        .map((game) => [game.scolia_board_id, game.id])
    );

    const activeMatchesByBoard = new Map(
      ((activeMatchesResult.data ?? []) as ActiveMatchRow[])
        .filter((match): match is ActiveMatchRow & { scolia_board_id: string } => Boolean(match.scolia_board_id))
        .map((match) => [match.scolia_board_id, match.id])
    );
    // Summaries are informational, so a failure here must not hide the boards.
    const [matchSummaries, gameSummaries] = await Promise.all([
      summarizeActiveMatches(supabase, [...activeMatchesByBoard.values()]).catch((error: unknown) => {
        console.error('Failed to summarize active matches:', error);
        return new Map<string, ScoliaBoardOccupant>();
      }),
      summarizeActiveGameSessions(supabase, [...activeGamesByBoard.values()]).catch((error: unknown) => {
        console.error('Failed to summarize active game sessions:', error);
        return new Map<string, ScoliaBoardOccupant>();
      }),
    ]);
    const now = Date.now();
    const boards = ((boardsResult.data ?? []) as BoardRow[]).map((board) => {
      const activeMatchId = activeMatchesByBoard.get(board.id) ?? null;
      const activeGameSessionId = activeGamesByBoard.get(board.id) ?? null;
      const workerConnectionStatus = hasFreshScoliaHeartbeat(
        { workerHeartbeatAt: board.worker_heartbeat_at },
        now
      )
        ? board.worker_connection_status
        : 'disconnected';
      const ready = isScoliaBoardReady(
        {
          workerConnectionStatus,
          boardStatus: board.board_status,
          workerHeartbeatAt: board.worker_heartbeat_at,
        },
        now
      );
      return {
        id: board.id,
        name: board.name,
        isHomeSbc: board.is_home_sbc,
        workerConnectionStatus,
        boardStatus: board.board_status,
        workerHeartbeatAt: board.worker_heartbeat_at,
        activeMatchId,
        activeGameSessionId,
        activeGame:
          (activeMatchId ? matchSummaries.get(activeMatchId) : null) ??
          (activeGameSessionId ? gameSummaries.get(activeGameSessionId) : null) ??
          null,
        selectable: ready && !activeMatchId && !activeGameSessionId,
      };
    });

    return NextResponse.json({ boards });
  } catch (error) {
    console.error('GET selectable Scolia boards error:', error);
    return NextResponse.json({ error: 'Failed to load Scolia boards' }, { status: 500 });
  }
}
