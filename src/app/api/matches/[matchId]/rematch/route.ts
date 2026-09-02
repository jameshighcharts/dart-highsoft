import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabaseServer';
import { isScoliaBoardReady } from '@/lib/scolia/availability';

export async function POST(_: Request, { params }: { params: Promise<{ matchId: string }> }) {
  try {
    const { matchId } = await params;
    const supabase = getSupabaseServerClient();

    const { data: match } = await supabase
      .from('matches')
      .select('id, start_score, finish, legs_to_win, fair_ending, winner_player_id, completed_at, ended_early, scolia_board_id')
      .eq('id', matchId)
      .single();
    if (!match) return NextResponse.json({ error: 'Match not found' }, { status: 404 });
    if (!match.winner_player_id && !match.completed_at && !match.ended_early) {
      return NextResponse.json({ error: 'Finish the current match before starting a rematch' }, { status: 409 });
    }

    const [playersResult, boardResult] = await Promise.all([
      supabase
        .from('match_players')
        .select('player_id, play_order')
        .eq('match_id', matchId)
        .order('play_order'),
      match.scolia_board_id
        ? supabase
            .from('scolia_boards')
            .select('id, worker_connection_status, board_status, worker_heartbeat_at')
            .eq('id', match.scolia_board_id)
            .eq('enabled', true)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    const { data: mpData, error: mpErr } = playersResult;
    if (mpErr || !mpData) return NextResponse.json({ error: mpErr?.message ?? 'Failed to load players' }, { status: 500 });
    if (boardResult.error) {
      return NextResponse.json({ error: boardResult.error.message }, { status: 500 });
    }
    if (match.scolia_board_id) {
      if (!boardResult.data) {
        return NextResponse.json({ error: 'The Scolia board from this match is no longer available' }, { status: 409 });
      }
      if (!isScoliaBoardReady({
        workerConnectionStatus: boardResult.data.worker_connection_status as string,
        boardStatus: boardResult.data.board_status as string | null,
        workerHeartbeatAt: boardResult.data.worker_heartbeat_at as string | null,
      })) {
        return NextResponse.json({ error: 'The Scolia board is not ready for a rematch' }, { status: 409 });
      }
    }
    const playerIds = (mpData as { player_id: string; play_order: number }[]).map((r) => r.player_id);
    if (playerIds.length < 2) {
      return NextResponse.json({ error: 'Need at least 2 players to start a rematch' }, { status: 400 });
    }

    const winnerId = match.winner_player_id ?? null;
    const eligibleStarters = winnerId ? playerIds.filter((id) => id !== winnerId) : [...playerIds];
    const starter =
      eligibleStarters.length > 0
        ? eligibleStarters[Math.floor(Math.random() * eligibleStarters.length)]
        : playerIds[0];
    const remaining = playerIds.filter((id) => id !== starter);
    const order = [starter, ...remaining.sort(() => Math.random() - 0.5)];

    const { data: newMatch, error: mErr } = await supabase
      .from('matches')
      .insert({
        mode: 'x01',
        start_score: match.start_score,
        finish: match.finish,
        legs_to_win: match.legs_to_win,
        fair_ending: match.fair_ending ?? false,
        scolia_board_id: match.scolia_board_id ?? null,
        rematch_of_match_id: match.id,
      })
      .select('*')
      .single();
    if (mErr || !newMatch) {
      if (mErr?.code === '23505' && match.scolia_board_id) {
        return NextResponse.json(
          { error: 'The Scolia board is already assigned to another active match' },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: mErr?.message ?? 'Failed to create rematch' }, { status: 500 });
    }

    const mp = order.map((id, idx) => ({ match_id: (newMatch as { id: string }).id, player_id: id, play_order: idx }));
    const { error: mpInsertErr } = await supabase.from('match_players').insert(mp);
    if (mpInsertErr) return NextResponse.json({ error: mpInsertErr.message }, { status: 500 });

    const { error: legErr } = await supabase
      .from('legs')
      .insert({ match_id: (newMatch as { id: string }).id, leg_number: 1, starting_player_id: order[0] });
    if (legErr) return NextResponse.json({ error: legErr.message }, { status: 500 });

    return NextResponse.json({ newMatchId: (newMatch as { id: string }).id });
  } catch (error) {
    console.error('POST /api/matches/[matchId]/rematch error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
