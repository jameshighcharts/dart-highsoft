import { NextResponse } from 'next/server';

import { isGuardResponse, requireAdmin } from '@/lib/auth/requireAdmin';
import { getSupabaseServerClient } from '@/lib/supabaseServer';
import { isSlackMemberListingConfigured, listSlackMembers } from '@/lib/slack/members';
import { importSlackMembersAsPlayers } from '@/lib/slack/playerImport';

/**
 * Imports every full workspace member as a player (first name, or
 * "First L" for duplicate first names) and links them for the dart poll
 * scheduler. Idempotent.
 */
export async function POST() {
  const guard = await requireAdmin();
  if (isGuardResponse(guard)) return guard;
  if (!isSlackMemberListingConfigured()) {
    return NextResponse.json({ error: 'SLACK_BOT_TOKEN is not configured' }, { status: 503 });
  }

  try {
    const members = await listSlackMembers();
    const result = await importSlackMembersAsPlayers(getSupabaseServerClient(), guard.user.slackTeamId, members);
    return NextResponse.json({
      members: members.length,
      created: result.created,
      linked: result.linked,
      alreadyLinked: result.alreadyLinked.length,
    });
  } catch (error) {
    console.error('POST /api/admin/slack/sync error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to sync Slack members' },
      { status: 500 },
    );
  }
}
