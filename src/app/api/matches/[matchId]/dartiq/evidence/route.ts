import { NextResponse } from 'next/server';

import { getSupabaseServerClient } from '@/lib/supabaseServer';
import { loadFrozenDartIQEvidence } from '@/lib/server/dartiqEvidence';

export async function GET(
  _: Request,
  { params }: { params: Promise<{ matchId: string }> }
) {
  try {
    const { matchId } = await params;
    const supabase = getSupabaseServerClient();
    const evidence = await loadFrozenDartIQEvidence(supabase, matchId);
    if (!evidence) {
      return NextResponse.json(
        { error: 'DartIQ evidence is unavailable for this match' },
        { status: 404 }
      );
    }
    return NextResponse.json(evidence);
  } catch (error) {
    console.error('GET /api/matches/[matchId]/dartiq/evidence error:', error);
    return NextResponse.json({ error: 'Could not load DartIQ evidence' }, { status: 500 });
  }
}
