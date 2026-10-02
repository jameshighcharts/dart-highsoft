import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { postSlackMessage } from '@/lib/slack/client';
import { buildHighdartsDigestMessage } from './digest';
import { loadHighdarts } from './server';

/** Posts one Highdarts wrap-up per day. The digest row is claimed before the
 *  network call, so a retried job never posts the same day twice. */
export async function publishHighdartsDigest(
  db: SupabaseClient,
  eventId: string,
  digestDate: string,
  appOrigin: string,
) {
  const { data: event, error: eventError } = await db
    .from('highdarts_events')
    .select('slack_channel_id')
    .eq('id', eventId)
    .maybeSingle();
  if (eventError) throw new Error(eventError.message);
  if (!event) return;

  const channel = event.slack_channel_id || process.env.SLACK_HIGHDARTS_CHANNEL_ID;
  if (!channel || !process.env.SLACK_BOT_TOKEN) {
    console.info(
      'Highdarts digest skipped: Slack channel or bot token is not configured',
    );
    return;
  }

  const { data: previous, error: previousError } = await db
    .from('highdarts_digests')
    .select('digest_date, slack_message_ts, covered_through')
    .eq('event_id', eventId)
    .order('digest_date', { ascending: false })
    .limit(1);
  if (previousError) throw new Error(previousError.message);
  const last = previous?.[0];
  if (last?.slack_message_ts === 'sending' && last.digest_date !== digestDate)
    throw new Error(
      'A previous Highdarts digest has an uncertain delivery outcome. Check the channel before clearing the sending marker.',
    );
  const since = last?.covered_through ?? null;

  // Claim the day first. A concurrent or retried job loses the insert and stops.
  const { data: claimed, error: claimError } = await db
    .from('highdarts_digests')
    .insert({
      event_id: eventId,
      digest_date: digestDate,
      slack_message_ts: 'sending',
      covered_through: since,
    })
    .select('digest_date')
    .maybeSingle();
  if (claimError) {
    if (claimError.code === '23505') return;
    throw new Error(claimError.message);
  }
  if (!claimed) return;

  const snapshot = await loadHighdarts(db);
  const message = buildHighdartsDigestMessage(snapshot, appOrigin, since);
  if (!message) {
    // Nothing finished today. Keep the day marked so the hourly enqueue cannot
    // retry it, and leave coverage where it was.
    const { error } = await db
      .from('highdarts_digests')
      .update({ slack_message_ts: null })
      .eq('event_id', eventId)
      .eq('digest_date', digestDate);
    if (error) throw new Error(error.message);
    return;
  }

  const ts = await postSlackMessage(channel, {
    text: message.text,
    blocks: message.blocks,
  });
  const { error: savedError } = await db
    .from('highdarts_digests')
    .update({
      slack_message_ts: ts,
      covered_through: message.latest ?? new Date().toISOString(),
    })
    .eq('event_id', eventId)
    .eq('digest_date', digestDate);
  if (savedError) throw new Error(savedError.message);
}
