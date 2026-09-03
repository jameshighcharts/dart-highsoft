import { describe, expect, it } from 'vitest';

import { buildSlackDartPollMessage } from './messages';

describe('buildSlackDartPollMessage', () => {
  const basePoll = {
    id: 'poll-1',
    scheduledFor: '2026-09-02T12:00:00.000Z',
    createdBySlackUserId: 'U1',
    yesUserIds: ['U1', 'U2'],
    noUserIds: ['U3'],
  };

  it('renders voters and voting buttons while open', () => {
    const message = buildSlackDartPollMessage({ ...basePoll, status: 'open' });

    expect(message.text).toContain('2 yes, 1 no');
    expect(JSON.stringify(message.blocks)).toContain('<@U2>');
    expect(JSON.stringify(message.blocks)).toContain('dart_vote_yes');
    expect(JSON.stringify(message.blocks)).toContain('dart_vote_no');
  });

  it('replaces voting controls with the match link after completion', () => {
    const message = buildSlackDartPollMessage({
      ...basePoll,
      status: 'completed',
      matchUrl: 'https://darts.example/match/match-1',
    });

    expect(JSON.stringify(message.blocks)).not.toContain('dart_vote_yes');
    expect(JSON.stringify(message.blocks)).toContain('https://darts.example/match/match-1');
  });
});
