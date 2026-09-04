import { NextResponse } from 'next/server';

import { isGuardResponse, requireAdmin } from '@/lib/auth/requireAdmin';
import { getSupabaseServerClient } from '@/lib/supabaseServer';

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

    const player = await supabase.from('players').select('id').eq('id', playerId).maybeSingle();
    if (player.error) throw new Error(player.error.message);
    if (!player.data) return NextResponse.json({ error: 'Player not found' }, { status: 404 });

    const clearedPlayer = await supabase
      .from('slack_player_links')
      .delete()
      .eq('team_id', teamId)
      .eq('player_id', playerId);
    if (clearedPlayer.error) throw new Error(clearedPlayer.error.message);
    const clearedSlackUser = await supabase
      .from('slack_player_links')
      .delete()
      .eq('team_id', teamId)
      .eq('slack_user_id', slackUserId);
    if (clearedSlackUser.error) throw new Error(clearedSlackUser.error.message);

    const inserted = await supabase
      .from('slack_player_links')
      .insert({ team_id: teamId, slack_user_id: slackUserId, player_id: playerId });
    if (inserted.error) throw new Error(inserted.error.message);

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
    const supabase = getSupabaseServerClient();
    const { error } = await supabase
      .from('slack_player_links')
      .delete()
      .eq('team_id', guard.user.slackTeamId)
      .eq('player_id', playerId);
    if (error) throw new Error(error.message);
    return NextResponse.json({ playerId, slackUserId: null });
  } catch (error) {
    console.error('DELETE /api/admin/players/[playerId]/slack-link error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
