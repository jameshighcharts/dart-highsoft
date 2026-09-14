import { beforeEach, expect, it, vi } from 'vitest';
import { publishHighdartsResult } from './slackResult';
import { postSlackMessage } from '@/lib/slack/client';
import { createSupabaseMock } from '@/test-utils/gameSupabaseMock';
vi.mock('@/lib/slack/client', () => ({ postSlackMessage: vi.fn() }));
const f = {
  id: 'f',
  event_id: 'e',
  stage: 'group',
  office: 'bergen',
  fixture_no: 1,
  player_a_id: 'a',
  player_b_id: 'b',
  player_a_name: 'Ada',
  player_b_name: 'Ben',
  match_id: 'm',
  match: {
    id: 'm',
    completed_at: '2026-09-14',
    ended_early: false,
    winner_player_id: 'a',
    legs: [],
  },
};
function db(ts: string | null = null) {
  return createSupabaseMock(
    {
      highdarts_fixtures: [{ id: 'f', event_id: 'e', slack_message_ts: ts }],
      highdarts_events: [{ id: 'e', slack_channel_id: 'C123' }],
      slack_player_links: [],
    },
    {
      highdarts_snapshot: () => ({
        data: { fixtures: [f], players: [] },
        error: null,
      }),
    },
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('SLACK_BOT_TOKEN', 'test-token');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://darts.example');
});
it('posts once and records the Slack timestamp', async () => {
  const client = db();
  vi.mocked(postSlackMessage).mockResolvedValue('123.456');
  await publishHighdartsResult(client as never, 'f', 'https://darts.example');
  await publishHighdartsResult(client as never, 'f', 'https://darts.example');
  expect(postSlackMessage).toHaveBeenCalledTimes(1);
});
it('skips already delivered results', async () => {
  await publishHighdartsResult(
    db('123.456') as never,
    'f',
    'https://darts.example',
  );
  expect(postSlackMessage).not.toHaveBeenCalled();
});
it('does not resend after an uncertain network outcome', async () => {
  const client = db();
  vi.mocked(postSlackMessage).mockRejectedValue(new Error('timeout'));
  await expect(
    publishHighdartsResult(client as never, 'f', 'https://darts.example'),
  ).rejects.toThrow('timeout');
  await expect(
    publishHighdartsResult(client as never, 'f', 'https://darts.example'),
  ).rejects.toThrow('uncertain');
  expect(postSlackMessage).toHaveBeenCalledTimes(1);
});
it('degrades gracefully without a bot token', async () => {
  vi.stubEnv('SLACK_BOT_TOKEN', '');
  await publishHighdartsResult(db() as never, 'f', 'https://darts.example');
  expect(postSlackMessage).not.toHaveBeenCalled();
});
