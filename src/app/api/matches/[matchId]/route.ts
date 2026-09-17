import { getAuthenticatedSession } from '@/auth';
import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabaseServer';
import { loadMatch } from '@/lib/server/matchGuards';

export async function DELETE(_: Request, { params }: { params: Promise<{ matchId: string }> }) {
  try {
    const session = await getAuthenticatedSession();
    if (!session?.user.email || !session.user.slackTeamId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { matchId } = await params;
    const supabase = getSupabaseServerClient();
    const match = await loadMatch(supabase, matchId);
    if (!match) {
      return NextResponse.json({ error: 'Match not found' }, { status: 404 });
    }
    if (match.highdarts_fixture_id) {
      return NextResponse.json({ error: 'Highdarts results belong to the fixture history. Ask an organiser to correct the fixture.' }, { status: 403 });
    }
    if (match.tournament_match_id) {
      return NextResponse.json(
        { error: 'Delete the tournament instead of an individual tournament match' },
        { status: 403 }
      );
    }

    const { error } = await supabase.from('matches').delete().eq('id', matchId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('DELETE /api/matches/[matchId] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
