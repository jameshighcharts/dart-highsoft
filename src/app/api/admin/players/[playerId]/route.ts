import { NextResponse } from 'next/server';

import { isGuardResponse, requireAdmin } from '@/lib/auth/requireAdmin';
import { getSupabaseServerClient } from '@/lib/supabaseServer';
import { LOCATIONS } from '@/utils/locations';
import { parseNicknames } from '@/utils/nicknames';

const locationValues = new Set<string>(LOCATIONS.map((location) => location.value));

type PatchBody = { displayName?: unknown; location?: unknown; isActive?: unknown; nicknames?: unknown };

export async function PATCH(request: Request, { params }: { params: Promise<{ playerId: string }> }) {
  const guard = await requireAdmin();
  if (isGuardResponse(guard)) return guard;

  try {
    const { playerId } = await params;
    let body: PatchBody;
    try {
      body = (await request.json()) as PatchBody;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const update: { display_name?: string; location?: string | null; is_active?: boolean; nicknames?: string[] } = {};
    if (body.displayName !== undefined) {
      const displayName = typeof body.displayName === 'string' ? body.displayName.trim().slice(0, 80) : '';
      if (!displayName) return NextResponse.json({ error: 'displayName cannot be empty' }, { status: 400 });
      update.display_name = displayName;
    }
    if (body.location !== undefined) {
      const location = body.location === null || body.location === '' ? null : body.location;
      if (location !== null && (typeof location !== 'string' || !locationValues.has(location))) {
        return NextResponse.json({ error: 'Invalid location' }, { status: 400 });
      }
      update.location = location;
    }
    if (body.isActive !== undefined) {
      if (typeof body.isActive !== 'boolean') return NextResponse.json({ error: 'isActive must be a boolean' }, { status: 400 });
      update.is_active = body.isActive;
    }
    if (body.nicknames !== undefined) {
      if (typeof body.nicknames !== 'string') return NextResponse.json({ error: 'nicknames must be a comma-separated string' }, { status: 400 });
      update.nicknames = parseNicknames(body.nicknames);
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from('players')
      .update(update)
      .eq('id', playerId)
      .select('id, display_name, location, is_active, is_test, created_at, avatar_url, nicknames')
      .single();
    if (error || !data) {
      if (error?.code === 'PGRST116') return NextResponse.json({ error: 'Player not found' }, { status: 404 });
      if (error?.code === '23505') return NextResponse.json({ error: 'A player with that name already exists' }, { status: 409 });
      return NextResponse.json({ error: error?.message ?? 'Failed to update player' }, { status: 500 });
    }
    return NextResponse.json({ player: data });
  } catch (error) {
    console.error('PATCH /api/admin/players/[playerId] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
