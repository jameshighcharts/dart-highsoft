import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  getSlackDisplayName,
  postSlackMessage,
  respondToSlack,
  updateSlackMessage,
} from './client';
import { buildSlackDartPollMessage } from './messages';

type SlackDartPollRow = {
  id: string;
  team_id: string;
  channel_id: string;
  message_ts: string | null;
  created_by_slack_user_id: string;
  scheduled_for: string;
  time_zone: string;
  status: 'open' | 'finalizing' | 'completed' | 'cancelled';
  match_id: string | null;
};

type SlackDartVoteRow = {
  slack_user_id: string;
  display_name: string;
  choice: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pollView(poll: SlackDartPollRow, votes: SlackDartVoteRow[], matchUrl?: string) {
  return {
    id: poll.id,
    scheduledFor: poll.scheduled_for,
    createdBySlackUserId: poll.created_by_slack_user_id,
    yesUserIds: votes.filter((vote) => vote.choice).map((vote) => vote.slack_user_id),
    noUserIds: votes.filter((vote) => !vote.choice).map((vote) => vote.slack_user_id),
    status: poll.status,
    matchUrl,
  };
}

async function loadVotes(supabase: SupabaseClient, pollId: string): Promise<SlackDartVoteRow[]> {
  const { data, error } = await supabase
    .from('slack_dart_votes')
    .select('slack_user_id, display_name, choice')
    .eq('poll_id', pollId)
    .order('updated_at');
  if (error) throw new Error(error.message);
  return (data ?? []) as SlackDartVoteRow[];
}

async function refreshPollMessage(supabase: SupabaseClient, poll: SlackDartPollRow): Promise<void> {
  if (!poll.message_ts) return;
  const votes = await loadVotes(supabase, poll.id);
  await updateSlackMessage(
    poll.channel_id,
    poll.message_ts,
    buildSlackDartPollMessage(pollView(poll, votes)),
  );
}

export async function createSlackDartPoll(options: {
  supabase: SupabaseClient;
  teamId: string;
  channelId: string;
  createdBySlackUserId: string;
  scheduledFor: Date;
  timeZone: string;
  responseUrl: string;
}): Promise<void> {
  const { supabase } = options;
  const { data, error } = await supabase
    .from('slack_dart_polls')
    .insert({
      team_id: options.teamId,
      channel_id: options.channelId,
      created_by_slack_user_id: options.createdBySlackUserId,
      scheduled_for: options.scheduledFor.toISOString(),
      time_zone: options.timeZone,
    })
    .select('*')
    .single();

  if (error || !data) {
    const message = error?.code === '23505'
      ? 'That dart poll already exists.'
      : 'I could not create the dart poll. Please try again.';
    await respondToSlack(options.responseUrl, message);
    return;
  }

  const poll = data as SlackDartPollRow;
  try {
    const messageTs = await postSlackMessage(
      poll.channel_id,
      buildSlackDartPollMessage(pollView(poll, [])),
    );
    const { error: updateError } = await supabase
      .from('slack_dart_polls')
      .update({ message_ts: messageTs, updated_at: new Date().toISOString() })
      .eq('id', poll.id);
    if (updateError) throw new Error(updateError.message);
  } catch (postError) {
    await supabase.from('slack_dart_polls').delete().eq('id', poll.id);
    console.error('Failed to publish Slack dart poll:', postError);
    await respondToSlack(options.responseUrl, 'I could not publish the dart poll. Please try again.');
  }
}

export async function recordSlackDartVote(options: {
  supabase: SupabaseClient;
  pollId: string;
  teamId: string;
  slackUserId: string;
  fallbackName: string;
  choice: boolean;
  responseUrl?: string;
}): Promise<void> {
  const { data, error } = await options.supabase
    .from('slack_dart_polls')
    .select('*')
    .eq('id', options.pollId)
    .eq('team_id', options.teamId)
    .maybeSingle();
  const poll = data as SlackDartPollRow | null;

  if (error || !poll || poll.status !== 'open' || new Date(poll.scheduled_for) <= new Date()) {
    if (options.responseUrl) {
      await respondToSlack(options.responseUrl, 'Voting for this dart match has closed.');
    }
    return;
  }

  const displayName = await getSlackDisplayName(options.slackUserId, options.fallbackName);
  const { error: voteError } = await options.supabase.from('slack_dart_votes').upsert({
    poll_id: poll.id,
    slack_user_id: options.slackUserId,
    display_name: displayName,
    choice: options.choice,
    updated_at: new Date().toISOString(),
  });
  if (voteError) throw new Error(voteError.message);
  await refreshPollMessage(options.supabase, poll);
}

async function resolvePlayerId(
  supabase: SupabaseClient,
  teamId: string,
  vote: SlackDartVoteRow,
): Promise<string> {
  const linked = await supabase
    .from('slack_player_links')
    .select('player_id')
    .eq('team_id', teamId)
    .eq('slack_user_id', vote.slack_user_id)
    .maybeSingle();
  if (linked.error) throw new Error(linked.error.message);
  if (linked.data) return linked.data.player_id as string;

  const sameName = await supabase
    .from('players')
    .select('id')
    .eq('display_name', vote.display_name)
    .maybeSingle();
  if (sameName.error) throw new Error(sameName.error.message);

  if (sameName.data) {
    const existingPlayerLink = await supabase
      .from('slack_player_links')
      .select('slack_user_id')
      .eq('team_id', teamId)
      .eq('player_id', sameName.data.id)
      .maybeSingle();
    if (existingPlayerLink.error) throw new Error(existingPlayerLink.error.message);
    if (!existingPlayerLink.data) {
      const link = await supabase.from('slack_player_links').insert({
        team_id: teamId,
        slack_user_id: vote.slack_user_id,
        player_id: sameName.data.id,
      });
      if (!link.error) return sameName.data.id as string;

      const raced = await supabase
        .from('slack_player_links')
        .select('player_id')
        .eq('team_id', teamId)
        .eq('slack_user_id', vote.slack_user_id)
        .maybeSingle();
      if (raced.data) return raced.data.player_id as string;
    }
  }

  const displayName = sameName.data
    ? `${vote.display_name} (${vote.slack_user_id.slice(-4)})`
    : vote.display_name;
  const inserted = await supabase
    .from('players')
    .insert({
      display_name: displayName,
    })
    .select('id')
    .single();
  if (inserted.error || !inserted.data) {
    throw new Error(inserted.error?.message ?? 'Failed to create Slack player');
  }

  const link = await supabase.from('slack_player_links').insert({
    team_id: teamId,
    slack_user_id: vote.slack_user_id,
    player_id: inserted.data.id,
  });
  if (!link.error) return inserted.data.id as string;

  await supabase.from('players').delete().eq('id', inserted.data.id);
  const raced = await supabase
    .from('slack_player_links')
    .select('player_id')
    .eq('team_id', teamId)
    .eq('slack_user_id', vote.slack_user_id)
    .maybeSingle();
  if (raced.data) return raced.data.player_id as string;
  throw new Error(link.error.message);
}

async function createSlackMatch(
  supabase: SupabaseClient,
  pollId: string,
  playerIds: string[],
): Promise<string> {
  const { data, error } = await supabase
    .rpc('create_slack_x01_match_atomic', {
      p_poll_id: pollId,
      p_player_ids: playerIds,
    })
    .single();

  if (error?.code === '23505') {
    const existing = await supabase
      .from('matches')
      .select('id')
      .eq('source_slack_poll_id', pollId)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (isRecord(existing.data) && typeof existing.data.id === 'string') return existing.data.id;
  }
  if (error || !isRecord(data) || typeof data.id !== 'string') {
    throw new Error(error?.message ?? 'Failed to create Slack dart match');
  }
  return data.id;
}

async function finalizePoll(
  supabase: SupabaseClient,
  poll: SlackDartPollRow,
  appOrigin: string,
): Promise<void> {
  const votes = await loadVotes(supabase, poll.id);
  const yesVotes = votes.filter((vote) => vote.choice);

  if (yesVotes.length < 2) {
    const cancelled = { ...poll, status: 'cancelled' as const };
    const { error } = await supabase
      .from('slack_dart_polls')
      .update({ status: 'cancelled', failure_message: null, updated_at: new Date().toISOString() })
      .eq('id', poll.id);
    if (error) throw new Error(error.message);
    if (poll.message_ts) {
      await updateSlackMessage(
        poll.channel_id,
        poll.message_ts,
        buildSlackDartPollMessage(pollView(cancelled, votes)),
      );
    }
    return;
  }

  let matchId = poll.match_id;
  if (!matchId) {
    const existingMatch = await supabase
      .from('matches')
      .select('id')
      .eq('source_slack_poll_id', poll.id)
      .maybeSingle();
    if (existingMatch.error) throw new Error(existingMatch.error.message);
    matchId = (existingMatch.data?.id as string | undefined) ?? null;
  }

  if (!matchId) {
    const playerIds: string[] = [];
    for (const vote of yesVotes) {
      playerIds.push(await resolvePlayerId(supabase, poll.team_id, vote));
    }
    matchId = await createSlackMatch(supabase, poll.id, playerIds);
  }

  const { error } = await supabase
    .from('slack_dart_polls')
    .update({
      status: 'completed',
      match_id: matchId,
      failure_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', poll.id);
  if (error) throw new Error(error.message);

  if (poll.message_ts) {
    const completed = { ...poll, status: 'completed' as const, match_id: matchId };
    await updateSlackMessage(
      poll.channel_id,
      poll.message_ts,
      buildSlackDartPollMessage(
        pollView(completed, votes, `${appOrigin}/match/${matchId}`),
      ),
    );
  }
}

export async function finalizeSlackDartPollById(options: {
  supabase: SupabaseClient;
  pollId: string;
  appOrigin: string;
}): Promise<void> {
  const { data, error } = await options.supabase
    .from('slack_dart_polls')
    .select('*')
    .eq('id', options.pollId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Slack dart poll ${options.pollId} does not exist`);

  const poll = data as SlackDartPollRow;
  if (poll.status === 'completed' || poll.status === 'cancelled') {
    if (poll.message_ts) {
      const votes = await loadVotes(options.supabase, poll.id);
      const matchUrl = poll.match_id ? `${options.appOrigin}/match/${poll.match_id}` : undefined;
      await updateSlackMessage(
        poll.channel_id,
        poll.message_ts,
        buildSlackDartPollMessage(pollView(poll, votes, matchUrl)),
      );
    }
    return;
  }
  if (new Date(poll.scheduled_for).getTime() > Date.now()) {
    throw new Error(`Slack dart poll ${poll.id} is not due yet`);
  }

  const { error: claimError } = await options.supabase
    .from('slack_dart_polls')
    .update({ status: 'finalizing', failure_message: null, updated_at: new Date().toISOString() })
    .eq('id', poll.id)
    .in('status', ['open', 'finalizing']);
  if (claimError) throw new Error(claimError.message);

  await finalizePoll(
    options.supabase,
    { ...poll, status: 'finalizing' },
    options.appOrigin,
  );
}
