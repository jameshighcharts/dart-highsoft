import { NextResponse } from 'next/server';

import { createGameSession, shuffle } from '@/lib/server/createGameSession';
import { loadGameSession } from '@/lib/server/gameGuards';
import { getSupabaseServerClient } from '@/lib/supabaseServer';

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = getSupabaseServerClient();
    const session = await loadGameSession(supabase, id);
    if (!session) return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    if (session.status === 'active') {
      return NextResponse.json({ error: 'Finish the current game before starting a rematch' }, { status: 409 });
    }

    const { data: rows, error } = await supabase
      .from('game_session_players')
      .select('player_id, play_order')
      .eq('session_id', id)
      .order('play_order');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const playerIds = ((rows ?? []) as { player_id: string }[]).map((row) => row.player_id);

    // Someone other than the winner starts; the rest are shuffled.
    const winnerId = session.winner_player_id;
    const eligibleStarters = winnerId ? playerIds.filter((pid) => pid !== winnerId) : playerIds;
    const starter = eligibleStarters.length > 0
      ? eligibleStarters[Math.floor(Math.random() * eligibleStarters.length)]
      : playerIds[0];
    const order = starter ? [starter, ...shuffle(playerIds.filter((pid) => pid !== starter))] : [];

    const result = await createGameSession(supabase, {
      mode: session.mode,
      config: session.config,
      orderedPlayerIds: order,
      scoliaBoardId: session.scolia_board_id,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ newGameId: result.session.id }, { status: 201 });
  } catch (error) {
    console.error('POST /api/games/[id]/rematch error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
