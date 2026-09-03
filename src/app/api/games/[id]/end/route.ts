import { NextResponse } from 'next/server';

import { loadGameSession } from '@/lib/server/gameGuards';
import { getSupabaseServerClient } from '@/lib/supabaseServer';

export async function PATCH(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = getSupabaseServerClient();
    const session = await loadGameSession(supabase, id);
    if (!session) return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    if (session.status !== 'active') {
      return NextResponse.json({ error: 'Game is already finished' }, { status: 409 });
    }
    const { error, count } = await supabase
      .from('game_sessions')
      .update({ status: 'ended_early', completed_at: new Date().toISOString() }, { count: 'exact' })
      .eq('id', id)
      .eq('status', 'active');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (count === 0) return NextResponse.json({ error: 'Game is already finished' }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('PATCH /api/games/[id]/end error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
