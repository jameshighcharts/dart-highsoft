import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabaseServer';
import { assertScoliaBoardAvailable } from '@/lib/server/scoliaBoardTarget';
import { isUuid } from '@/lib/commentary/realtimeTypes';

/** Attach the tournament board only to the bracket match being opened. */
export async function POST(_: Request, { params }: { params: Promise<{ id: string; matchId: string }> }) {
  const { id, matchId } = await params;
  if (!isUuid(id) || !isUuid(matchId)) return NextResponse.json({ error: 'Invalid tournament or match' }, { status: 400 });
  try {
    const supabase = getSupabaseServerClient();
    const { data: slot, error: slotError } = await supabase.from('tournament_matches')
      .select('id').eq('tournament_id', id).eq('match_id', matchId).maybeSingle();
    if (slotError) throw new Error(slotError.message);
    if (!slot) return NextResponse.json({ error: 'Tournament match not found' }, { status: 404 });
    const [tournamentResult, matchResult] = await Promise.all([
      supabase.from('tournaments').select('scolia_board_id, commentary_enabled').eq('id', id).single(),
      supabase.from('matches').select('scolia_board_id, completed_at, winner_player_id, ended_early, paused_at')
        .eq('id', matchId).eq('tournament_match_id', slot.id).single(),
    ]);
    if (tournamentResult.error) throw new Error(tournamentResult.error.message);
    if (matchResult.error) throw new Error(matchResult.error.message);
    const tournament = tournamentResult.data;
    const match = matchResult.data;
    const active = !match.completed_at && !match.winner_player_id && !match.ended_early;
    const boardId = tournament.scolia_board_id;
    if (active && boardId && match.scolia_board_id !== boardId) {
      if (match.scolia_board_id || match.paused_at) {
        return NextResponse.json({ error: 'This match is paused or already assigned to another board' }, { status: 409 });
      }
      const availability = await assertScoliaBoardAvailable(supabase, boardId);
      if (!availability.ok) return NextResponse.json({ error: availability.error }, { status: availability.status });
      // The database board-occupancy trigger serializes concurrent claims,
      // including standalone X01 and party-game creation.
      const { data: assigned, error } = await supabase.from('matches')
        .update({ scolia_board_id: boardId }).eq('id', matchId)
        .is('scolia_board_id', null).is('completed_at', null).is('winner_player_id', null)
        .is('paused_at', null).eq('ended_early', false).select('id').maybeSingle();
      if (error?.code === '23505') return NextResponse.json({ error: 'This board was just claimed by another match or game' }, { status: 409 });
      if (error) throw new Error(error.message);
      if (!assigned) return NextResponse.json({ error: 'Match changed while opening it. Please try again.' }, { status: 409 });
    }
    return NextResponse.json({ commentaryEnabled: active && tournament.commentary_enabled === true });
  } catch (error) {
    console.error('Failed to open tournament match:', error);
    return NextResponse.json({ error: 'Failed to open tournament match' }, { status: 500 });
  }
}
