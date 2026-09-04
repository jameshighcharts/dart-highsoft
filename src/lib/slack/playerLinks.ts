import type { SupabaseClient } from '@supabase/supabase-js';

type ClaimSlackPlayerInput =
  | {
      teamId: string;
      slackUserId: string;
      playerId: string;
      displayName?: never;
    }
  | {
      teamId: string;
      slackUserId: string;
      playerId?: never;
      displayName: string;
    };

export class SlackPlayerLinkError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
  ) {
    super(message);
    this.name = 'SlackPlayerLinkError';
  }
}

function isClaimResult(value: unknown): value is { player_id: string; created: boolean } {
  return (
    typeof value === 'object'
    && value !== null
    && 'player_id' in value
    && typeof value.player_id === 'string'
    && 'created' in value
    && typeof value.created === 'boolean'
  );
}

export function isSlackPlayerLinkConflict(error: unknown): boolean {
  return error instanceof SlackPlayerLinkError && error.code === '23505';
}

export async function claimSlackPlayerAtomic(
  supabase: SupabaseClient,
  input: ClaimSlackPlayerInput,
): Promise<{ playerId: string; created: boolean }> {
  const { data, error } = await supabase
    .rpc('claim_slack_player_atomic', {
      p_team_id: input.teamId,
      p_slack_user_id: input.slackUserId,
      p_player_id: input.playerId ?? null,
      p_display_name: input.displayName ?? null,
    })
    .single();

  if (error) throw new SlackPlayerLinkError(error.message, error.code);
  if (!isClaimResult(data)) throw new Error('Invalid claim_slack_player_atomic response');
  return { playerId: data.player_id, created: data.created };
}

export async function setSlackPlayerLinkAtomic(
  supabase: SupabaseClient,
  input: { teamId: string; playerId: string; slackUserId: string | null },
): Promise<void> {
  const { error } = await supabase.rpc('set_slack_player_link_atomic', {
    p_team_id: input.teamId,
    p_player_id: input.playerId,
    p_slack_user_id: input.slackUserId,
  });
  if (error) throw new SlackPlayerLinkError(error.message, error.code);
}
