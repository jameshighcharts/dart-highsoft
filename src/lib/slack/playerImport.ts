// Turns Slack workspace members into app players and stable Slack-to-player
// links (the same slack_player_links rows the /dart poll scheduler resolves).
//
// Naming rule: first name only. When two members share a first name, each of
// them becomes "First L" (first name + last-name initial). If that still
// collides, the full real name is used.

import type { SupabaseClient } from '@supabase/supabase-js';

import type { SlackMember } from './members.ts';

export type ExistingPlayer = { id: string; display_name: string };
export type ExistingLink = { slack_user_id: string; player_id: string };

export type ImportPlan = {
  create: Array<{ slackUserId: string; displayName: string }>;
  link: Array<{ slackUserId: string; playerId: string; displayName: string }>;
  alreadyLinked: string[];
};

function splitName(member: SlackMember): { first: string; last: string | null } {
  const parts = member.realName.split(/\s+/).filter(Boolean);
  const first = member.firstName ?? parts[0] ?? member.realName;
  const last = member.lastName ?? (parts.length > 1 ? parts[parts.length - 1] : null);
  return { first, last };
}

/** Preferred player name per Slack user id, following the naming rule. */
export function preferredPlayerNames(members: SlackMember[]): Map<string, string> {
  const byFirst = new Map<string, SlackMember[]>();
  for (const member of members) {
    const key = splitName(member).first.toLowerCase();
    byFirst.set(key, [...(byFirst.get(key) ?? []), member]);
  }

  const names = new Map<string, string>();
  for (const group of byFirst.values()) {
    if (group.length === 1) {
      names.set(group[0].id, splitName(group[0]).first);
      continue;
    }
    const withInitial = group.map((member) => {
      const { first, last } = splitName(member);
      return { member, name: last ? `${first} ${last[0].toUpperCase()}` : member.realName };
    });
    const initialCounts = new Map<string, number>();
    for (const entry of withInitial) {
      const key = entry.name.toLowerCase();
      initialCounts.set(key, (initialCounts.get(key) ?? 0) + 1);
    }
    for (const entry of withInitial) {
      const unique = (initialCounts.get(entry.name.toLowerCase()) ?? 0) === 1;
      names.set(entry.member.id, unique ? entry.name : entry.member.realName);
    }
  }
  return names;
}

export function planSlackPlayerImport(
  members: SlackMember[],
  players: ExistingPlayer[],
  links: ExistingLink[],
): ImportPlan {
  const preferred = preferredPlayerNames(members);
  const linkedSlackUsers = new Set(links.map((link) => link.slack_user_id));
  const linkedPlayers = new Set(links.map((link) => link.player_id));
  const playersByName = new Map(players.map((player) => [player.display_name.toLowerCase(), player]));
  const takenNames = new Set(players.map((player) => player.display_name.toLowerCase()));

  const plan: ImportPlan = { create: [], link: [], alreadyLinked: [] };

  for (const member of members) {
    if (linkedSlackUsers.has(member.id)) {
      plan.alreadyLinked.push(member.id);
      continue;
    }
    const wanted = preferred.get(member.id) ?? member.realName;
    const existing = playersByName.get(wanted.toLowerCase());

    if (existing && !linkedPlayers.has(existing.id)) {
      // "Magic" link: an existing player with exactly this name and no Slack
      // identity yet is the same person.
      plan.link.push({ slackUserId: member.id, playerId: existing.id, displayName: existing.display_name });
      linkedPlayers.add(existing.id);
      continue;
    }

    let displayName = wanted;
    if (takenNames.has(displayName.toLowerCase())) displayName = member.realName;
    if (takenNames.has(displayName.toLowerCase())) displayName = `${member.realName} (${member.id.slice(-4)})`;
    takenNames.add(displayName.toLowerCase());
    plan.create.push({ slackUserId: member.id, displayName });
  }

  return plan;
}

export type ImportResult = ImportPlan & { created: number; linked: number };

/**
 * Executes the plan against the database. Safe to re-run: members that are
 * already linked are skipped, and unique-violation races fall back to the
 * winning row.
 */
export async function importSlackMembersAsPlayers(
  supabase: SupabaseClient,
  teamId: string,
  members: SlackMember[],
): Promise<ImportResult> {
  const [{ data: players, error: playersError }, { data: links, error: linksError }] = await Promise.all([
    supabase.from('players').select('id, display_name'),
    supabase.from('slack_player_links').select('slack_user_id, player_id').eq('team_id', teamId),
  ]);
  if (playersError) throw new Error(playersError.message);
  if (linksError) throw new Error(linksError.message);

  const plan = planSlackPlayerImport(
    members,
    (players ?? []) as ExistingPlayer[],
    (links ?? []) as ExistingLink[],
  );

  let created = 0;
  let linked = 0;

  for (const entry of plan.link) {
    const { error } = await supabase
      .from('slack_player_links')
      .insert({ team_id: teamId, slack_user_id: entry.slackUserId, player_id: entry.playerId });
    if (error && error.code !== '23505') throw new Error(error.message);
    if (!error) linked += 1;
  }

  for (const entry of plan.create) {
    const inserted = await supabase
      .from('players')
      .insert({ display_name: entry.displayName })
      .select('id')
      .single();
    if (inserted.error || !inserted.data) {
      if (inserted.error?.code === '23505') continue; // name appeared concurrently; next run links it
      throw new Error(inserted.error?.message ?? 'Failed to create player');
    }
    const link = await supabase
      .from('slack_player_links')
      .insert({ team_id: teamId, slack_user_id: entry.slackUserId, player_id: inserted.data.id });
    if (link.error) {
      await supabase.from('players').delete().eq('id', inserted.data.id);
      if (link.error.code === '23505') continue;
      throw new Error(link.error.message);
    }
    created += 1;
    linked += 1;
  }

  return { ...plan, created, linked };
}
