import { NextResponse } from 'next/server';

import { loadGameSnapshot } from '@/lib/server/gameThrowLifecycle';
import { getSupabaseServerClient } from '@/lib/supabaseServer';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = getSupabaseServerClient();
    const snapshot = await loadGameSnapshot(supabase, id);
    if (!snapshot) return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    return NextResponse.json({
      session: snapshot.session,
      players: snapshot.players,
      throws: snapshot.throws,
      state: snapshot.state,
    });
  } catch (error) {
    console.error('GET /api/games/[id] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
