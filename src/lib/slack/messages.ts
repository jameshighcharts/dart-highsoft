export type SlackDartPollView = {
  id: string;
  scheduledFor: string;
  createdBySlackUserId: string;
  yesUserIds: string[];
  noUserIds: string[];
  status: 'open' | 'finalizing' | 'completed' | 'cancelled';
  matchUrl?: string;
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
  const isOpen = poll.status === 'open';
  const resultText = poll.status === 'completed'
    ? `Match ready: <${poll.matchUrl}|open scoring>`
    : poll.status === 'cancelled'
      ? 'Cancelled — at least two Yes votes are required.'
      : poll.status === 'finalizing'
        ? 'Creating the match…'
        : 'Voting closes when the match starts.';
  const text = `Darts ${date} — ${poll.yesUserIds.length} yes, ${poll.noUserIds.length} no. ${resultText}`;
  const blocks: object[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:dart: *Darts ${date}*\nStarted by <@${poll.createdBySlackUserId}>`,
      },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Yes (${poll.yesUserIds.length})*\n${mentions(poll.yesUserIds)}` },
        { type: 'mrkdwn', text: `*No (${poll.noUserIds.length})*\n${mentions(poll.noUserIds)}` },
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
          text: { type: 'plain_text', text: 'Yes' },
          style: 'primary',
          value: poll.id,
        },
        {
          type: 'button',
          action_id: 'dart_vote_no',
          text: { type: 'plain_text', text: 'No' },
          style: 'danger',
          value: poll.id,
        },
      ],
    });
  }

  return { text, blocks };
}
