import { NextResponse } from 'next/server';

import { isGuardResponse, requireAdmin } from '@/lib/auth/requireAdmin';
import { getSupabaseServerClient } from '@/lib/supabaseServer';
import { setSlackPlayerLinkAtomic, SlackPlayerLinkError } from '@/lib/slack/playerLinks';

const SLACK_USER_ID_PATTERN = /^[UW][A-Z0-9]{2,20}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Link a player to a Slack user. Replaces any existing link on either side. */
export async function PUT(request: Request, { params }: { params: Promise<{ playerId: string }> }) {
  const guard = await requireAdmin();
  if (isGuardResponse(guard)) return guard;

  try {
    const { playerId } = await params;
    if (!UUID_PATTERN.test(playerId)) return NextResponse.json({ error: 'Invalid player id' }, { status: 400 });
    let body: { slackUserId?: unknown };
    try {
      body = (await request.json()) as { slackUserId?: unknown };
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const slackUserId = typeof body.slackUserId === 'string' ? body.slackUserId.trim() : '';
    if (!SLACK_USER_ID_PATTERN.test(slackUserId)) {
      return NextResponse.json({ error: 'Invalid Slack user id' }, { status: 400 });
    }

    const teamId = guard.user.slackTeamId;
    const supabase = getSupabaseServerClient();

    try {
      await setSlackPlayerLinkAtomic(supabase, { teamId, playerId, slackUserId });
    } catch (error) {
      if (error instanceof SlackPlayerLinkError && error.message === 'player_not_found') {
        return NextResponse.json({ error: 'Player not found' }, { status: 404 });
      }
      throw error;
    }

    return NextResponse.json({ playerId, slackUserId });
  } catch (error) {
    console.error('PUT /api/admin/players/[playerId]/slack-link error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ playerId: string }> }) {
  const guard = await requireAdmin();
  if (isGuardResponse(guard)) return guard;

  try {
    const { playerId } = await params;
    if (!UUID_PATTERN.test(playerId)) return NextResponse.json({ error: 'Invalid player id' }, { status: 400 });
    await setSlackPlayerLinkAtomic(getSupabaseServerClient(), {
      teamId: guard.user.slackTeamId,
      playerId,
      slackUserId: null,
    });
    return NextResponse.json({ playerId, slackUserId: null });
  } catch (error) {
    console.error('DELETE /api/admin/players/[playerId]/slack-link error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
