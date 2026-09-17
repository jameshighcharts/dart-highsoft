import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabaseServer';
import { highdartsErrorStatus } from '@/lib/highdarts/server';

export async function PATCH(_: Request, { params }: { params: Promise<{ matchId: string }> }) {
  try {
    const { matchId } = await params;
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase.rpc('end_match_early_atomic', { p_match_id: matchId });
    if (error) return NextResponse.json({ error: error.message }, { status: highdartsErrorStatus(error.code) });
    return NextResponse.json(data);
  } catch (error) {
    console.error('PATCH /api/matches/[matchId]/end error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
