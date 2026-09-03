import { NextResponse } from 'next/server';

import { getSupabaseServerClient } from '@/lib/supabaseServer';
import { isMatchActive, loadMatch } from '@/lib/server/matchGuards';

export async function PATCH(request: Request, { params }: { params: Promise<{ matchId: string }> }) {
  try {
    const { matchId } = await params;
    let body: { paused?: boolean };
    try {
      body = (await request.json()) as { paused?: boolean };
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    if (typeof body.paused !== 'boolean') {
      return NextResponse.json({ error: 'paused must be a boolean' }, { status: 400 });
    }

    const supabase = getSupabaseServerClient();
    const match = await loadMatch(supabase, matchId);
    if (!match) return NextResponse.json({ error: 'Match not found' }, { status: 404 });
    if (!isMatchActive(match)) return NextResponse.json({ error: 'Match is already completed' }, { status: 409 });

    const pausedAt = body.paused ? new Date().toISOString() : null;
    const { error } = await supabase.from('matches').update({ paused_at: pausedAt }).eq('id', matchId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, pausedAt });
  } catch (error) {
    console.error('PATCH /api/matches/[matchId]/pause error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
