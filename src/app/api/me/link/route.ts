import { NextResponse } from 'next/server';

import { isGuardResponse, requireUser } from '@/lib/auth/requireAdmin';
import { findLinkedPlayer, PLAYER_COLUMNS } from '@/lib/server/myPlayer';
import { getSupabaseServerClient } from '@/lib/supabaseServer';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Claim a player as mine. Body: { playerId } to claim an existing unclaimed
 * player, or { displayName } to create a new one. Fails if I am already linked;
 * an admin can re-link in /admin.
 */
export async function POST(request: Request) {
  const guard = await requireUser();
  if (isGuardResponse(guard)) return guard;
  try {
    let body: { playerId?: unknown; displayName?: unknown };
    try {
      body = (await request.json()) as { playerId?: unknown; displayName?: unknown };
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const supabase = getSupabaseServerClient();
    const teamId = guard.user.slackTeamId;
    const existing = await findLinkedPlayer(supabase, teamId, guard.user.slackUserId);
    if (existing) return NextResponse.json({ error: 'Your account is already linked to a player' }, { status: 409 });

    let playerId: string;
    if (typeof body.playerId === 'string') {
      if (!UUID_PATTERN.test(body.playerId)) return NextResponse.json({ error: 'Invalid player id' }, { status: 400 });
      playerId = body.playerId;
      const taken = await supabase.from('slack_player_links').select('slack_user_id').eq('team_id', teamId).eq('player_id', playerId).maybeSingle();
      if (taken.error) throw new Error(taken.error.message);
      if (taken.data) return NextResponse.json({ error: 'That player already belongs to someone else' }, { status: 409 });
      const player = await supabase.from('players').select('id').eq('id', playerId).maybeSingle();
      if (player.error) throw new Error(player.error.message);
      if (!player.data) return NextResponse.json({ error: 'Player not found' }, { status: 404 });
    } else {
      const displayName = typeof body.displayName === 'string' ? body.displayName.trim().slice(0, 80) : '';
      if (!displayName) return NextResponse.json({ error: 'displayName or playerId is required' }, { status: 400 });
      const created = await supabase.from('players').insert({ display_name: displayName }).select('id').single();
      if (created.error || !created.data) {
        if (created.error?.code === '23505') return NextResponse.json({ error: 'A player with that name already exists' }, { status: 409 });
        throw new Error(created.error?.message ?? 'Failed to create player');
      }
      playerId = created.data.id as string;
    }

    const link = await supabase.from('slack_player_links').insert({ team_id: teamId, slack_user_id: guard.user.slackUserId, player_id: playerId });
    if (link.error) {
      if (link.error.code === '23505') return NextResponse.json({ error: 'That player was just claimed by someone else' }, { status: 409 });
      throw new Error(link.error.message);
    }

    const player = await supabase.from('players').select(PLAYER_COLUMNS).eq('id', playerId).single();
    if (player.error) throw new Error(player.error.message);
    return NextResponse.json({ player: player.data });
  } catch (error) {
    console.error('POST /api/me/link error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
