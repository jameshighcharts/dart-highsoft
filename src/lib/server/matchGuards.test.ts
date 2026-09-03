import { describe, expect, it } from 'vitest';

import { isMatchActive, isMatchPaused, isMatchScoringActive, type MatchRow } from './matchGuards';

const activeMatch: MatchRow = {
  id: 'match-1',
  winner_player_id: null,
  completed_at: null,
  ended_early: false,
  start_score: '501',
  finish: 'double_out',
  legs_to_win: 1,
  fair_ending: false,
  tournament_match_id: null,
  scolia_board_id: null,
};

describe('match guards', () => {
  it('keeps a paused match active while disabling scoring', () => {
    const pausedMatch = { ...activeMatch, paused_at: '2026-09-03T10:00:00.000Z' };

    expect(isMatchActive(pausedMatch)).toBe(true);
    expect(isMatchPaused(pausedMatch)).toBe(true);
    expect(isMatchScoringActive(pausedMatch)).toBe(false);
  });

  it('allows scoring for an active match without a pause timestamp', () => {
    expect(isMatchPaused(activeMatch)).toBe(false);
    expect(isMatchScoringActive(activeMatch)).toBe(true);
  });
});
