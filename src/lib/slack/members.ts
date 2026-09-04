// Workspace directory access for the admin panel and the player import.
// Uses the same SLACK_BOT_TOKEN (scope users:read) as the dart poll bot.
// No 'server-only' import so the CLI script can reuse it.

export type SlackMember = {
  id: string;
  realName: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  email: string | null;
};

type SlackUsersListResponse = {
  ok: boolean;
  error?: string;
  members?: Array<{
    id: string;
    name?: string;
    deleted?: boolean;
    is_bot?: boolean;
    is_app_user?: boolean;
    is_restricted?: boolean;
    is_ultra_restricted?: boolean;
    real_name?: string;
    profile?: {
      real_name?: string;
      first_name?: string;
      last_name?: string;
      display_name?: string;
      email?: string;
    };
  }>;
  response_metadata?: { next_cursor?: string };
};

export function isSlackMemberListingConfigured(): boolean {
  return Boolean(process.env.SLACK_BOT_TOKEN);
}

function clean(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Full (non-guest, non-bot, active) human members of the workspace, sorted by
 * name. Guests are excluded because polls and the admin panel are for staff.
 */
export async function listSlackMembers(): Promise<SlackMember[]> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error('SLACK_BOT_TOKEN is not configured');

  const members: SlackMember[] = [];
  let cursor: string | undefined;
  do {
    const params = new URLSearchParams({ limit: '200' });
    if (cursor) params.set('cursor', cursor);
    const response = await fetch('https://slack.com/api/users.list', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    const result = (await response.json()) as SlackUsersListResponse;
    if (!response.ok || !result.ok) {
      throw new Error(`Slack users.list failed: ${result.error ?? response.status}`);
    }
    for (const member of result.members ?? []) {
      if (
        member.deleted ||
        member.is_bot ||
        member.is_app_user ||
        member.is_restricted ||
        member.is_ultra_restricted ||
        member.id === 'USLACKBOT'
      ) {
        continue;
      }
      const realName = clean(member.profile?.real_name) ?? clean(member.real_name) ?? clean(member.name);
      if (!realName) continue;
      members.push({
        id: member.id,
        realName,
        firstName: clean(member.profile?.first_name),
        lastName: clean(member.profile?.last_name),
        displayName: clean(member.profile?.display_name),
        email: clean(member.profile?.email)?.toLowerCase() ?? null,
      });
    }
    cursor = clean(result.response_metadata?.next_cursor) ?? undefined;
  } while (cursor);

  return members.sort((a, b) => a.realName.localeCompare(b.realName));
}
