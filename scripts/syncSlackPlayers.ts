// One-off / repeatable CLI: import every full Highsoft Slack member as a
// player and link them for the /dart poll scheduler. Same logic as the
// "Import Slack members" button in /admin.
//
//   npm run slack:sync-players            # apply
//   npm run slack:sync-players -- --dry   # print the plan only
//
// Needs SLACK_BOT_TOKEN (scope users:read), AUTH_SLACK_TEAM_ID,
// NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.

import { createClient } from '@supabase/supabase-js';

import { listSlackMembers } from '../src/lib/slack/members.ts';
import {
  importSlackMembersAsPlayers,
  planSlackPlayerImport,
  type ExistingLink,
  type ExistingPlayer,
} from '../src/lib/slack/playerImport.ts';

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing ${name}`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const dryRun = process.argv.includes('--dry');
  const teamId = requireEnv('AUTH_SLACK_TEAM_ID');
  requireEnv('SLACK_BOT_TOKEN');
  const supabase = createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  });

  const members = await listSlackMembers();
  console.log(`Slack members (full, active, human): ${members.length}`);

  if (dryRun) {
    const [{ data: players, error: playersError }, { data: links, error: linksError }] = await Promise.all([
      supabase.from('players').select('id, display_name'),
      supabase.from('slack_player_links').select('slack_user_id, player_id').eq('team_id', teamId),
    ]);
    if (playersError) throw new Error(playersError.message);
    if (linksError) throw new Error(linksError.message);
    const plan = planSlackPlayerImport(members, (players ?? []) as ExistingPlayer[], (links ?? []) as ExistingLink[]);
    const nameById = new Map(members.map((member) => [member.id, member.realName]));
    console.log(`\nWould create ${plan.create.length} players:`);
    for (const entry of plan.create) console.log(`  + ${entry.displayName}  (${nameById.get(entry.slackUserId)})`);
    console.log(`\nWould link ${plan.link.length} existing players:`);
    for (const entry of plan.link) console.log(`  ~ ${entry.displayName}  <- ${nameById.get(entry.slackUserId)}`);
    console.log(`\nAlready linked: ${plan.alreadyLinked.length}`);
    return;
  }

  const result = await importSlackMembersAsPlayers(supabase, teamId, members);
  console.log(`Created ${result.created} players, added ${result.linked} links, ${result.alreadyLinked.length} already linked.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
