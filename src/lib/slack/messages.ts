import { describeSlackDartSettings } from './dartTime';

export type SlackDartPollView = {
  id: string;
  scheduledFor: string;
  createdBySlackUserId: string;
  yesUserIds: string[];
  noUserIds: string[];
  status: 'open' | 'finalizing' | 'completed' | 'cancelled';
  startScore: string;
  finish: string;
  legsToWin: number;
  matchUrl?: string;
  spectatorUrl?: string;
};

function mentions(userIds: string[]): string {
  return userIds.length > 0 ? userIds.map((id) => `<@${id}>`).join(', ') : 'Nobody yet';
}

export function buildSlackDartPollMessage(poll: SlackDartPollView): {
  text: string;
  blocks: object[];
} {
  const unixTime = Math.floor(new Date(poll.scheduledFor).getTime() / 1000);
  const date = `<!date^${unixTime}^{date_short_pretty} at {time}|scheduled dart match>`;
  const settings = describeSlackDartSettings(poll);
  const isOpen = poll.status === 'open';
  const resultText = poll.status === 'completed'
    ? `Match ready: <${poll.matchUrl}|open scoring>${poll.spectatorUrl ? ` · <${poll.spectatorUrl}|spectate>` : ''}`
    : poll.status === 'cancelled'
      ? 'Cancelled — at least two players are required.'
      : poll.status === 'finalizing'
        ? 'Creating the match…'
        : `Sign-up closes ${date}.`;
  const text = `Darts ${settings} ${date} — ${poll.yesUserIds.length} in, ${poll.noUserIds.length} out. ${resultText}`;
  const blocks: object[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:dart: *Darts ${date}*\n${settings}\nStarted by <@${poll.createdBySlackUserId}>`,
      },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*I'm down (${poll.yesUserIds.length})*\n${mentions(poll.yesUserIds)}` },
        { type: 'mrkdwn', text: `*Not this time (${poll.noUserIds.length})*\n${mentions(poll.noUserIds)}` },
      ],
    },
    { type: 'context', elements: [{ type: 'mrkdwn', text: resultText }] },
  ];

  if (isOpen) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          action_id: 'dart_vote_yes',
          text: { type: 'plain_text', text: "I'm down", emoji: true },
          style: 'primary',
          value: poll.id,
        },
        {
          type: 'button',
          action_id: 'dart_vote_no',
          text: { type: 'plain_text', text: 'Not this time', emoji: true },
          value: poll.id,
        },
      ],
    });
  }

  return { text, blocks };
}
