import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { postSlackMessage } from '@/lib/slack/client';
import { loadHighdarts } from './server';
import { buildHighdartsResultMessage } from './slack';

export async function publishHighdartsResult(
  db: SupabaseClient,
  fixtureId: string,
  appOrigin: string,
) {
  const { data: fixture, error } = await db
    .from('highdarts_fixtures')
    .select('event_id, slack_message_ts')
    .eq('id', fixtureId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!fixture) return;
  if (fixture.slack_message_ts === 'sending')
    throw new Error(
      'Slack delivery outcome is uncertain. Check the channel before clearing the sending marker.',
    );
  if (fixture.slack_message_ts) return;
  const { data: event, error: eventError } = await db
    .from('highdarts_events')
    .select('slack_channel_id')
    .eq('id', fixture.event_id)
    .single();
  if (eventError) throw new Error(eventError.message);
  const channel =
    event?.slack_channel_id || process.env.SLACK_HIGHDARTS_CHANNEL_ID;
  if (!channel || !process.env.SLACK_BOT_TOKEN) {
    console.info(
      'Highdarts result skipped: Slack channel or bot token is not configured',
    );
    return;
  }
  const snapshot = await loadHighdarts(db);
  const f = snapshot.fixtures.find((f) => f.id === fixtureId);
  if (!f?.match || (!f.match.completed_at && !f.match.ended_early))
    throw new Error('Highdarts match is not complete');
  const ids = [f.player_a_id, f.player_b_id].filter(
    (id): id is string => id !== null,
  );
  const { data: links, error: linksError } = await db
    .from('slack_player_links')
    .select('player_id, slack_user_id')
    .in('player_id', ids);
  if (linksError) throw new Error(linksError.message);
  const message = buildHighdartsResultMessage(
    f,
    snapshot.players,
    new Map((links ?? []).map((link) => [link.player_id, link.slack_user_id])),
    process.env.NEXT_PUBLIC_APP_URL || appOrigin,
  );
  // Claim before the network call. An ambiguous send is never retried blindly.
  const { data: claimed, error: claimError } = await db
    .from('highdarts_fixtures')
    .update({ slack_message_ts: 'sending' })
    .eq('id', fixtureId)
    .is('slack_message_ts', null)
    .select('id')
    .maybeSingle();
  if (claimError) throw new Error(claimError.message);
  if (!claimed) return;
  const ts = await postSlackMessage(channel, {
    text: message.text,
    blocks: message.blocks,
  });
  const { error: savedError } = await db
    .from('highdarts_fixtures')
    .update({ slack_message_ts: ts })
    .eq('id', fixtureId)
    .eq('slack_message_ts', 'sending');
  if (savedError)
    throw new Error(
      `Slack posted at ${ts}, but saving its timestamp failed: ${savedError.message}`,
    );
}
