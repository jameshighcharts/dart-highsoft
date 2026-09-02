import { NextResponse } from 'next/server';

import { connectScoliaBoard, listScoliaBoards, ScoliaApiError } from '@/lib/scolia/client';
import { getSupabaseServerClient } from '@/lib/supabaseServer';

type ActiveMatchRow = {
  id: string;
  scolia_board_id: string;
  start_score: string;
  legs_to_win: number;
  created_at: string;
  match_players: {
    play_order: number;
    players: { display_name: string } | { display_name: string }[] | null;
  }[];
  legs: { winner_player_id: string | null }[];
};

function playerName(row: ActiveMatchRow['match_players'][number]): string | null {
  const player = Array.isArray(row.players) ? row.players[0] : row.players;
  return player?.display_name ?? null;
}

function errorResponse(error: unknown, operation: string) {
  if (error instanceof ScoliaApiError) {
    if (process.env.NODE_ENV !== 'production' && error.diagnostics) {
      console.warn(`${operation} Scolia boards rejected:`, error.diagnostics);
    }
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error(`${operation} Scolia boards error:`, error);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

export async function GET() {
  try {
    const supabase = getSupabaseServerClient();
    const [boards, statusResult, activeMatchesResult] = await Promise.all([
      listScoliaBoards(),
      supabase
        .from('scolia_boards')
        .select('id, serial_number, worker_connection_status, board_status, board_phase, error_type, last_event_at, worker_heartbeat_at')
        .eq('enabled', true),
      supabase
        .from('matches')
        .select(`
          id, scolia_board_id, start_score, legs_to_win, created_at,
          match_players(play_order, players(display_name)),
          legs(winner_player_id)
        `)
        .not('scolia_board_id', 'is', null)
        .is('completed_at', null)
        .is('winner_player_id', null)
        .eq('ended_early', false),
    ]);
    if (statusResult.error && statusResult.error.code !== '42P01') {
      throw new Error(statusResult.error.message);
    }
    if (activeMatchesResult.error && activeMatchesResult.error.code !== '42P01') {
      throw new Error(activeMatchesResult.error.message);
    }
    const statuses = new Map((statusResult.data ?? []).map((row) => [row.serial_number as string, row]));
    const activeMatchesByBoard = new Map(
      ((activeMatchesResult.data ?? []) as unknown as ActiveMatchRow[]).map((match) => {
        const playerNames = match.match_players
          .slice()
          .sort((a, b) => a.play_order - b.play_order)
          .map(playerName)
          .filter((name): name is string => Boolean(name));
        return [match.scolia_board_id, {
          id: match.id,
          startScore: match.start_score,
          legsToWin: match.legs_to_win,
          completedLegs: match.legs.filter((leg) => Boolean(leg.winner_player_id)).length,
          playerNames,
          createdAt: match.created_at,
        }] as const;
      })
    );
    const now = Date.now();
    const enrichedBoards = boards.map((board) => {
      const status = statuses.get(board.serialNumber);
      const heartbeatAt = status?.worker_heartbeat_at as string | null | undefined;
      const heartbeatIsFresh = heartbeatAt ? now - Date.parse(heartbeatAt) < 45_000 : false;
      return {
        ...board,
        id: (status?.id as string | undefined) ?? null,
        workerConnectionStatus: heartbeatIsFresh
          ? status?.worker_connection_status ?? 'disconnected'
          : 'disconnected',
        boardStatus: (status?.board_status as string | null | undefined) ?? null,
        boardPhase: (status?.board_phase as string | null | undefined) ?? null,
        errorType: (status?.error_type as string | null | undefined) ?? null,
        lastEventAt: (status?.last_event_at as string | null | undefined) ?? null,
        workerHeartbeatAt: heartbeatAt ?? null,
        activeMatch: status?.id ? activeMatchesByBoard.get(status.id as string) ?? null : null,
      };
    });
    return NextResponse.json({ boards: enrichedBoards });
  } catch (error) {
    return errorResponse(error, 'GET');
  }
}

export async function PUT(request: Request) {
  try {
    let body: { serialNumber?: unknown };
    try {
      body = (await request.json()) as { serialNumber?: unknown };
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (typeof body.serialNumber !== 'string') {
      return NextResponse.json({ error: 'serialNumber is required' }, { status: 400 });
    }
    const serialNumber = body.serialNumber.trim();
    if (!serialNumber || serialNumber.length > 128) {
      return NextResponse.json({ error: 'serialNumber must be between 1 and 128 characters' }, { status: 400 });
    }

    const board = await connectScoliaBoard(serialNumber);
    return NextResponse.json({ board });
  } catch (error) {
    return errorResponse(error, 'PUT');
  }
}
