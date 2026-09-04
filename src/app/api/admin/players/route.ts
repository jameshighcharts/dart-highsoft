import { NextResponse } from 'next/server';

import { isGuardResponse, requireAdmin } from '@/lib/auth/requireAdmin';
import { getSupabaseServerClient } from '@/lib/supabaseServer';
import { isSlackMemberListingConfigured, listSlackMembers, type SlackMember } from '@/lib/slack/members';
import { LOCATIONS } from '@/utils/locations';
import { parseNicknames } from '@/utils/nicknames';

const locationValues = new Set<string>(LOCATIONS.map((location) => location.value));

export type AdminPlayer = {
  id: string;
  display_name: string;
  location: string | null;
  is_active: boolean;
  is_test: boolean;
  created_at: string;
  avatar_url: string | null;
  nicknames: string[];
  slack_user_id: string | null;
};

export type AdminPlayersResponse = {
  players: AdminPlayer[];
  slackMembers: SlackMember[];
  slackMembersError: string | null;
};

export async function GET() {
  const guard = await requireAdmin();
  if (isGuardResponse(guard)) return guard;

  try {
    const supabase = getSupabaseServerClient();
    const [playersResult, linksResult, slackMembers] = await Promise.all([
      supabase
        .from('players')
        .select('id, display_name, location, is_active, is_test, created_at, avatar_url, nicknames')
        .order('display_name'),
      supabase
        .from('slack_player_links')
        .select('slack_user_id, player_id')
        .eq('team_id', guard.user.slackTeamId),
      isSlackMemberListingConfigured()
        ? listSlackMembers().then(
            (members) => ({ members, error: null as string | null }),
            (error: unknown) => ({
              members: [] as SlackMember[],
              error: error instanceof Error ? error.message : 'Failed to load Slack members',
            }),
          )
        : Promise.resolve({ members: [] as SlackMember[], error: 'SLACK_BOT_TOKEN is not configured' }),
    ]);
    if (playersResult.error) throw new Error(playersResult.error.message);
    if (linksResult.error) throw new Error(linksResult.error.message);

    const slackUserByPlayer = new Map<string, string>();
    for (const link of linksResult.data ?? []) {
      slackUserByPlayer.set(link.player_id as string, link.slack_user_id as string);
    }

    const players: AdminPlayer[] = (playersResult.data ?? []).map((player) => ({
      id: player.id as string,
      display_name: player.display_name as string,
      location: (player.location as string | null) ?? null,
      is_active: Boolean(player.is_active),
      is_test: Boolean(player.is_test),
      created_at: player.created_at as string,
      avatar_url: (player.avatar_url as string | null) ?? null,
      nicknames: Array.isArray(player.nicknames) ? (player.nicknames as string[]) : [],
      slack_user_id: slackUserByPlayer.get(player.id as string) ?? null,
    }));

    const body: AdminPlayersResponse = {
      players,
      slackMembers: slackMembers.members,
      slackMembersError: slackMembers.error,
    };
    return NextResponse.json(body);
  } catch (error) {
    console.error('GET /api/admin/players error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (isGuardResponse(guard)) return guard;

  try {
    let body: { displayName?: unknown; location?: unknown; nicknames?: unknown };
    try {
      body = (await request.json()) as { displayName?: unknown; location?: unknown; nicknames?: unknown };
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim().slice(0, 80) : '';
    if (!displayName) return NextResponse.json({ error: 'displayName is required' }, { status: 400 });
    const location = body.location === undefined || body.location === null || body.location === '' ? null : body.location;
    if (location !== null && (typeof location !== 'string' || !locationValues.has(location))) {
      return NextResponse.json({ error: 'Invalid location' }, { status: 400 });
    }

    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from('players')
      .insert({ display_name: displayName, location, nicknames: typeof body.nicknames === 'string' ? parseNicknames(body.nicknames) : [] })
      .select('id, display_name, location, is_active, is_test, created_at, avatar_url, nicknames')
      .single();
    if (error || !data) {
      if (error?.code === '23505') {
        return NextResponse.json({ error: 'A player with that name already exists' }, { status: 409 });
      }
      return NextResponse.json({ error: error?.message ?? 'Failed to create player' }, { status: 500 });
    }
    return NextResponse.json({ player: { ...data, slack_user_id: null } });
  } catch (error) {
    console.error('POST /api/admin/players error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
