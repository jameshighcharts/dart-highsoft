import { describe, expect, it } from 'vitest';

import { buildSlackDartPollMessage } from './messages';

describe('buildSlackDartPollMessage', () => {
  const basePoll = {
    id: 'poll-1',
    scheduledFor: '2026-09-02T12:00:00.000Z',
    createdBySlackUserId: 'U1',
    yesUserIds: ['U1', 'U2'],
    noUserIds: ['U3'],
    startScore: '501',
    finish: 'double_out',
    legsToWin: 1,
  };

  it('renders voters, settings and join buttons while open', () => {
    const message = buildSlackDartPollMessage({ ...basePoll, status: 'open' });
    const blocks = JSON.stringify(message.blocks);

    expect(message.text).toContain('2 in, 1 out');
    expect(message.text).toContain('501 · 1 leg · double out');
    expect(blocks).toContain('<@U2>');
    expect(blocks).toContain('dart_vote_yes');
    expect(blocks).toContain('dart_vote_no');
    expect(blocks).toContain("I'm down");
  });

  it('shows custom settings', () => {
    const message = buildSlackDartPollMessage({
      ...basePoll,
      status: 'open',
      startScore: '301',
      finish: 'single_out',
      legsToWin: 2,
    });

    expect(JSON.stringify(message.blocks)).toContain('301 · 2 legs · single out');
  });

  it('replaces voting controls with the match links after completion', () => {
    const message = buildSlackDartPollMessage({
      ...basePoll,
      status: 'completed',
      matchUrl: 'https://darts.example/match/match-1',
      spectatorUrl: 'https://darts.example/match/match-1?spectator=true',
    });
    const blocks = JSON.stringify(message.blocks);

    expect(blocks).not.toContain('dart_vote_yes');
    expect(blocks).toContain('https://darts.example/match/match-1|open scoring');
    expect(blocks).toContain('https://darts.example/match/match-1?spectator=true|spectate');
  });

  it('explains a cancelled poll', () => {
    const message = buildSlackDartPollMessage({ ...basePoll, yesUserIds: ['U1'], status: 'cancelled' });
    expect(JSON.stringify(message.blocks)).toContain('Cancelled');
    expect(JSON.stringify(message.blocks)).not.toContain('dart_vote_yes');
  });
});
