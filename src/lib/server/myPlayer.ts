import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

export const PLAYER_COLUMNS = 'id, display_name, location, is_active, is_test, created_at, avatar_url, nicknames';

export type MyPlayer = {
  id: string;
  display_name: string;
  location: string | null;
  is_active: boolean;
  is_test: boolean;
  created_at: string;
  avatar_url: string | null;
  nicknames: string[];
};

/** The player linked to this Slack identity in slack_player_links, or null. */
export async function findLinkedPlayer(
  supabase: SupabaseClient,
  teamId: string,
  slackUserId: string,
): Promise<MyPlayer | null> {
  const link = await supabase
    .from('slack_player_links')
    .select('player_id')
    .eq('team_id', teamId)
    .eq('slack_user_id', slackUserId)
    .maybeSingle();
  if (link.error) throw new Error(link.error.message);
  if (!link.data) return null;

  const player = await supabase.from('players').select(PLAYER_COLUMNS).eq('id', link.data.player_id as string).maybeSingle();
  if (player.error) throw new Error(player.error.message);
  return (player.data as MyPlayer | null) ?? null;
}

/** Players nobody in this workspace has claimed yet (for the "this is me" picker). */
export async function listUnclaimedPlayers(supabase: SupabaseClient, teamId: string): Promise<Pick<MyPlayer, 'id' | 'display_name' | 'avatar_url'>[]> {
  const [players, links] = await Promise.all([
    supabase.from('players').select('id, display_name, avatar_url').eq('is_active', true).eq('is_test', false).order('display_name'),
    supabase.from('slack_player_links').select('player_id').eq('team_id', teamId),
  ]);
  if (players.error) throw new Error(players.error.message);
  if (links.error) throw new Error(links.error.message);
  const taken = new Set((links.data ?? []).map((row) => row.player_id as string));
  return ((players.data ?? []) as Pick<MyPlayer, 'id' | 'display_name' | 'avatar_url'>[]).filter((player) => !taken.has(player.id));
}
