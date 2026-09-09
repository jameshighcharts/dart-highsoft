import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabaseServer';
import { isMatchScoringActive, loadMatch } from '@/lib/server/matchGuards';
import { updateBullOff } from '@/lib/server/bullOff';

export async function POST(request: Request, { params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;
  const supabase = getSupabaseServerClient();
  const match = await loadMatch(supabase, matchId);
  if (!match) return NextResponse.json({ error: 'Match not found' }, { status: 404 });
  if (!isMatchScoringActive(match) || !match.bull_off || match.bull_off.phase === 'complete') return NextResponse.json({ error: 'No active bull-off' }, { status: 409 });
  if (match.scolia_board_id) return NextResponse.json({ error: 'Use the Scolia board for this bull-off' }, { status: 409 });
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!body || body.revision !== match.bull_off.revision) return NextResponse.json({ error: 'Bull-off changed; refresh and try again' }, { status: 409 });
  if (body.action !== 'takeout' && (body.action !== 'throw' || typeof body.playerId !== 'string' || (body.distanceMm !== null && (typeof body.distanceMm !== 'number' || !Number.isFinite(body.distanceMm) || body.distanceMm < 0 || body.distanceMm > 1000)))) {
    return NextResponse.json({ error: 'Supply a distance from 0 to 1000 mm, or a miss' }, { status: 400 });
  }
  try {
    const state = await updateBullOff(supabase, matchId, match.bull_off, body.action === 'takeout' ? 'takeout' : { playerId: body.playerId, distanceMm: body.distanceMm });
    return NextResponse.json({ state });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not save bull-off' }, { status: 409 });
  }
}
