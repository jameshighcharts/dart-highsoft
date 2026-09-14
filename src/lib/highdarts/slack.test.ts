import { expect, it } from 'vitest';
import { buildHighdartsResultMessage } from './slack';
import type { FixtureResult } from './standings';
const result: FixtureResult = {
  id: 'fixture',
  event_id: 'event',
  stage: 'group',
  office: 'bergen',
  fixture_no: 5,
  player_a_id: 'a',
  player_b_id: 'b',
  player_a_name: 'James',
  player_b_name: 'Håvard',
  match_id: 'match',
  match: {
    id: 'match',
    winner_player_id: 'b',
    completed_at: '2026-09-14',
    ended_early: false,
    legs: [
      {
        winner_player_id: 'b',
        turns: [
          {
            player_id: 'b',
            total_scored: 40,
            darts_thrown: 2,
            busted: false,
            tiebreak_round: null,
          },
        ],
      },
      { winner_player_id: 'a', turns: [] },
      { winner_player_id: 'b', turns: [] },
    ],
  },
};
it('builds a winner-first score, mentions, averages and report links', () => {
  const message = buildHighdartsResultMessage(
    result,
    [],
    new Map([['b', 'U123']]),
    'https://darts.example',
  );
  expect(message.text).toContain('Håvard beat James 2–1');
  expect(JSON.stringify(message.blocks)).toContain(
    '*<@U123>* beat James *2–1*',
  );
  expect(message.text).toContain('60.00 avg');
  expect(message.text).toContain('Highest checkout: 40');
  expect(JSON.stringify(message.blocks)).toContain(
    'https://darts.example/match/match/report',
  );
});
it('does not announce an early ending as a tournament win', () => {
  const message = buildHighdartsResultMessage(
    { ...result, match: { ...result.match!, ended_early: true } },
    [],
    new Map(),
    'https://darts.example',
  );
  expect(message.text).toContain('Excluded from standings');
  expect(message.text).not.toContain('beat');
});
it('escapes player text so names cannot inject mentions', () => {
  const message = buildHighdartsResultMessage(
    { ...result, player_a_name: '<@everyone>&' },
    [],
    new Map(),
    'https://darts.example',
  );
  expect(JSON.stringify(message.blocks)).toContain('&lt;@everyone&gt;&amp;');
});
