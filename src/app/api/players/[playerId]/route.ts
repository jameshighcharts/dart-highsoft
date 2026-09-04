import { NextResponse } from 'next/server';

import { getSupabaseServerClient } from '@/lib/supabaseServer';
import { LOCATIONS } from '@/utils/locations';

const locationValues = new Set<string>(LOCATIONS.map((location) => location.value));

export async function PATCH(request: Request, { params }: { params: Promise<{ playerId: string }> }) {
  try {
    const { playerId } = await params;
    let body: { location?: string | null };
    try {
      body = (await request.json()) as { location?: string | null };
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    if (body.location !== null && (typeof body.location !== 'string' || !locationValues.has(body.location))) {
      return NextResponse.json({ error: 'Invalid location' }, { status: 400 });
    }

    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from('players')
      .update({ location: body.location ?? null })
      .eq('id', playerId)
      .select('*')
      .single();
    if (error || !data) {
      if (error?.code === 'PGRST116') return NextResponse.json({ error: 'Player not found' }, { status: 404 });
      return NextResponse.json({ error: error?.message ?? 'Failed to update player' }, { status: 500 });
    }

    return NextResponse.json({ player: data });
  } catch (error) {
    console.error('PATCH /api/players/[playerId] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
