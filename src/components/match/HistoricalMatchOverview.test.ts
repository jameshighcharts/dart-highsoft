import { describe, expect, it } from 'vitest';

import { computeHistoricalMatchStats } from './HistoricalMatchOverview';
import type { LegRecord, Player, TurnWithThrows } from '@/lib/match/types';

const players: Player[] = [
  { id: 'player-1', display_name: 'Alice' },
  { id: 'player-2', display_name: 'Bob' },
];

const legs: LegRecord[] = [
  { id: 'leg-1', match_id: 'match-1', leg_number: 1, starting_player_id: 'player-1', winner_player_id: 'player-1' },
];

describe('computeHistoricalMatchStats', () => {
  it('calculates whole-match player stats without double-counting current-leg turns', () => {
    const aliceTurn: TurnWithThrows = {
      id: 'turn-1',
      leg_id: 'leg-1',
      player_id: 'player-1',
      turn_number: 1,
      total_scored: 100,
      busted: false,
      tiebreak_round: null,
      throws: [
        { id: 'throw-1', turn_id: 'turn-1', dart_index: 1, segment: 'T20', scored: 60 },
        { id: 'throw-2', turn_id: 'turn-1', dart_index: 2, segment: 'S20', scored: 20 },
        { id: 'throw-3', turn_id: 'turn-1', dart_index: 3, segment: 'S20', scored: 20 },
      ],
    };
    const bobTurn: TurnWithThrows = {
      id: 'turn-2',
      leg_id: 'leg-1',
      player_id: 'player-2',
      turn_number: 2,
      total_scored: 180,
      busted: false,
      tiebreak_round: null,
      throws: [
        { id: 'throw-4', turn_id: 'turn-2', dart_index: 1, segment: 'T20', scored: 60 },
        { id: 'throw-5', turn_id: 'turn-2', dart_index: 2, segment: 'T20', scored: 60 },
        { id: 'throw-6', turn_id: 'turn-2', dart_index: 3, segment: 'T20', scored: 60 },
      ],
    };

    const stats = computeHistoricalMatchStats({
      players,
      legs,
      turns: [aliceTurn, bobTurn],
      turnsByLeg: { 'leg-1': [aliceTurn, bobTurn] },
    });

    expect(stats.allTurns).toHaveLength(2);
    expect(stats.totalDarts).toBe(6);
    expect(stats.bestAverage).toBe(180);
    expect(stats.bestVisit).toBe(180);
    expect(stats.tonPlusVisits).toBe(2);
    expect(stats.players.find((player) => player.player.id === 'player-1')).toMatchObject({
      legsWon: 1,
      threeDartAverage: 100,
      bestVisit: 100,
      tonPlusVisits: 1,
    });
  });
});
