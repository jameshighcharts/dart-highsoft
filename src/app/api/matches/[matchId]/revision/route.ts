import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabaseServer';

// The app's authenticated proxy protects this route, as with the match read APIs.
// Read the revision BEFORE any recovery snapshot, so concurrent changes cannot
// be accidentally acknowledged without having been downloaded.
export async function GET(_: Request, { params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;
  const db = getSupabaseServerClient();
  const [source, match, players] = await Promise.all([
    db.from('dartiq_source_revisions').select('revision').eq('match_id', matchId).maybeSingle(),
    db.from('matches').select('id').eq('id', matchId).maybeSingle(),
    // Player profile edits are not covered by the match source revision.
    db.from('match_players').select('player_id, players:player_id(id, display_name, avatar_url, location, nicknames)').eq('match_id', matchId).order('player_id'),
  ]);
  if (source.error || match.error || players.error) {
    return NextResponse.json({ error: 'Could not check match revision' }, { status: 503 });
  }
  if (!match.data) return NextResponse.json({ error: 'Match not found' }, { status: 404 });
  return NextResponse.json({ revision: JSON.stringify([source.data?.revision ?? 0, players.data]) }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
