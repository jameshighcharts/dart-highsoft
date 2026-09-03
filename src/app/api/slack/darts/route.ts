import { after, NextRequest, NextResponse } from 'next/server';

import { getSupabaseServerClient } from '@/lib/supabaseServer';
import { createSlackDartPoll, recordSlackDartVote } from '@/lib/slack/dartPollService';
import { parseSlackDartTime } from '@/lib/slack/dartTime';
import { verifySlackRequest } from '@/lib/slack/signature';

type SlackBlockAction = {
  type: string;
  team?: { id?: string };
  user?: { id?: string; username?: string; name?: string };
  actions?: Array<{ action_id?: string; value?: string }>;
  response_url?: string;
};

function slackText(text: string, status = 200): NextResponse {
  return NextResponse.json({ response_type: 'ephemeral', text }, { status });
}

export async function POST(request: NextRequest) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) return slackText('Slack integration is not configured.', 503);

  const body = await request.text();
  const verified = await verifySlackRequest({
    body,
    signature: request.headers.get('x-slack-signature'),
    timestamp: request.headers.get('x-slack-request-timestamp'),
    signingSecret,
  });
  if (!verified) return new NextResponse('Invalid Slack signature', { status: 401 });

  const form = new URLSearchParams(body);
  const interactionJson = form.get('payload');
  if (interactionJson) {
    let payload: SlackBlockAction;
    try {
      payload = JSON.parse(interactionJson) as SlackBlockAction;
    } catch {
      return new NextResponse('Invalid interaction payload', { status: 400 });
    }

    const action = payload.actions?.[0];
    const choice = action?.action_id === 'dart_vote_yes'
      ? true
      : action?.action_id === 'dart_vote_no'
        ? false
        : null;
    if (
      payload.type !== 'block_actions' ||
      choice === null ||
      !action?.value ||
      !payload.team?.id ||
      !payload.user?.id
    ) {
      return new NextResponse('Unsupported interaction', { status: 400 });
    }

    const supabase = getSupabaseServerClient();
    after(async () => {
      try {
        await recordSlackDartVote({
          supabase,
          pollId: action.value!,
          teamId: payload.team!.id!,
          slackUserId: payload.user!.id!,
          fallbackName: payload.user!.username || payload.user!.name || payload.user!.id!,
          choice,
          responseUrl: payload.response_url,
        });
      } catch (error) {
        console.error('Failed to record Slack dart vote:', error);
      }
    });
    return new NextResponse(null, { status: 200 });
  }

  if (form.get('command') !== '/dart') {
    return slackText('Unsupported command.', 400);
  }
  const teamId = form.get('team_id');
  const channelId = form.get('channel_id');
  const userId = form.get('user_id');
  const responseUrl = form.get('response_url');
  if (!teamId || !channelId || !userId || !responseUrl) {
    return slackText('Slack did not provide enough context for this poll.', 400);
  }

  const timeZone = process.env.SLACK_DART_TIME_ZONE?.trim() || 'Europe/Oslo';
  let scheduledFor: Date | null;
  try {
    scheduledFor = parseSlackDartTime(form.get('text') ?? '', { timeZone });
  } catch {
    return slackText('SLACK_DART_TIME_ZONE is not a valid IANA time zone.', 503);
  }
  if (!scheduledFor) {
    return slackText('Use `/dart HH:MM`, for example `/dart 14:00`.');
  }

  const supabase = getSupabaseServerClient();
  after(async () => {
    try {
      await createSlackDartPoll({
        supabase,
        teamId,
        channelId,
        createdBySlackUserId: userId,
        scheduledFor,
        timeZone,
        responseUrl,
      });
    } catch (error) {
      console.error('Failed to create Slack dart poll:', error);
    }
  });

  return slackText(
    `Creating a dart poll for ${scheduledFor.toLocaleString('en-GB', {
      timeZone,
      dateStyle: 'medium',
      timeStyle: 'short',
    })}.`,
  );
}
