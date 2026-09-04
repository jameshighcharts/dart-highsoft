import { NextResponse } from 'next/server';

import { isGuardResponse, requireUser } from '@/lib/auth/requireAdmin';
import { PLAYER_COLUMNS } from '@/lib/server/myPlayer';
import { getSupabaseServerClient } from '@/lib/supabaseServer';
import { claimSlackPlayerAtomic, SlackPlayerLinkError } from '@/lib/slack/playerLinks';

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
    let claimInput:
      | { teamId: string; slackUserId: string; playerId: string }
      | { teamId: string; slackUserId: string; displayName: string };
    if (typeof body.playerId === 'string') {
      if (!UUID_PATTERN.test(body.playerId)) return NextResponse.json({ error: 'Invalid player id' }, { status: 400 });
      claimInput = { teamId, slackUserId: guard.user.slackUserId, playerId: body.playerId };
    } else {
      const displayName = typeof body.displayName === 'string' ? body.displayName.trim().slice(0, 80) : '';
      if (!displayName) return NextResponse.json({ error: 'displayName or playerId is required' }, { status: 400 });
      claimInput = { teamId, slackUserId: guard.user.slackUserId, displayName };
    }

    let playerId: string;
    try {
      playerId = (await claimSlackPlayerAtomic(supabase, claimInput)).playerId;
    } catch (error) {
      if (error instanceof SlackPlayerLinkError) {
        if (error.message === 'slack_user_already_linked') {
          return NextResponse.json({ error: 'Your account is already linked to a player' }, { status: 409 });
        }
        if (error.message === 'claimable_player_not_found') {
          return NextResponse.json({ error: 'Player not found or unavailable' }, { status: 404 });
        }
        if (error.code === '23505') {
          const message = 'displayName' in claimInput
            ? 'A player with that name already exists'
            : 'That player was just claimed by someone else';
          return NextResponse.json({ error: message }, { status: 409 });
        }
      }
      throw error;
    }

    const player = await supabase.from('players').select(PLAYER_COLUMNS).eq('id', playerId).single();
    if (player.error) throw new Error(player.error.message);
    return NextResponse.json({ player: player.data });
  } catch (error) {
    console.error('POST /api/me/link error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
