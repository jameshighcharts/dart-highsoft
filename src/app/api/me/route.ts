import { NextResponse } from 'next/server';

import { isGuardResponse, requireUser } from '@/lib/auth/requireAdmin';
import { findLinkedPlayer, listUnclaimedPlayers, PLAYER_COLUMNS, type MyPlayer } from '@/lib/server/myPlayer';
import { getSupabaseServerClient } from '@/lib/supabaseServer';
import { LOCATIONS } from '@/utils/locations';
import { parseNicknames } from '@/utils/nicknames';

const locationValues = new Set<string>(LOCATIONS.map((location) => location.value));

export type MeResponse = {
  user: { name: string | null; email: string | null; image: string | null; slackUserId: string; isAdmin: boolean };
  player: MyPlayer | null;
  unclaimedPlayers: Pick<MyPlayer, 'id' | 'display_name' | 'avatar_url'>[];
};

export async function GET() {
  const guard = await requireUser();
  if (isGuardResponse(guard)) return guard;
  try {
    const supabase = getSupabaseServerClient();
    const player = await findLinkedPlayer(supabase, guard.user.slackTeamId, guard.user.slackUserId);
    const unclaimedPlayers = player ? [] : await listUnclaimedPlayers(supabase, guard.user.slackTeamId);
    const body: MeResponse = {
      user: {
        name: guard.user.name ?? null,
        email: guard.user.email ?? null,
        image: guard.user.image ?? null,
        slackUserId: guard.user.slackUserId,
        isAdmin: guard.user.isAdmin,
      },
      player,
      unclaimedPlayers,
    };
    return NextResponse.json(body);
  } catch (error) {
    console.error('GET /api/me error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** Edit my own player: nicknames and location. Name changes go through an admin. */
export async function PATCH(request: Request) {
  const guard = await requireUser();
  if (isGuardResponse(guard)) return guard;
  try {
    let body: { nicknames?: unknown; location?: unknown };
    try {
      body = (await request.json()) as { nicknames?: unknown; location?: unknown };
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const update: { nicknames?: string[]; location?: string | null } = {};
    if (body.nicknames !== undefined) {
      if (typeof body.nicknames !== 'string') return NextResponse.json({ error: 'nicknames must be a comma-separated string' }, { status: 400 });
      update.nicknames = parseNicknames(body.nicknames);
    }
    if (body.location !== undefined) {
      const location = body.location === null || body.location === '' ? null : body.location;
      if (location !== null && (typeof location !== 'string' || !locationValues.has(location))) {
        return NextResponse.json({ error: 'Invalid location' }, { status: 400 });
      }
      update.location = location;
    }
    if (Object.keys(update).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

    const supabase = getSupabaseServerClient();
    const player = await findLinkedPlayer(supabase, guard.user.slackTeamId, guard.user.slackUserId);
    if (!player) return NextResponse.json({ error: 'No player linked to your account' }, { status: 404 });

    const { data, error } = await supabase.from('players').update(update).eq('id', player.id).select(PLAYER_COLUMNS).single();
    if (error || !data) return NextResponse.json({ error: error?.message ?? 'Failed to update' }, { status: 500 });
    return NextResponse.json({ player: data });
  } catch (error) {
    console.error('PATCH /api/me error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
