import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabaseServer';
import { loadMatch } from '@/lib/server/matchGuards';

function hasValidPasscode(request: Request): boolean {
  const configuredPasscode = process.env.GAME_DELETE_PASSCODE;
  const suppliedPasscode = request.headers.get('x-admin-passcode');
  if (!configuredPasscode || !suppliedPasscode) return false;

  const configured = Buffer.from(configuredPasscode);
  const supplied = Buffer.from(suppliedPasscode);
  return configured.length === supplied.length && timingSafeEqual(configured, supplied);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ matchId: string }> }) {
  try {
    if (!process.env.GAME_DELETE_PASSCODE) {
      return NextResponse.json({ error: 'Game deletion is not configured' }, { status: 503 });
    }
    if (!hasValidPasscode(request)) {
      return NextResponse.json({ error: 'Incorrect admin passcode' }, { status: 401 });
    }

    const { matchId } = await params;
    const supabase = getSupabaseServerClient();
    const match = await loadMatch(supabase, matchId);
    if (!match) {
      return NextResponse.json({ error: 'Match not found' }, { status: 404 });
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
