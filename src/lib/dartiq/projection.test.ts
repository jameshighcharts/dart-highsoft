import { describe, expect, it } from 'vitest';

import {
  calculateDartIQProjection,
} from './projection';

const player = (id: string, scoreRemaining = 501, legsWon = 0, average = 45, dartsThrown = 0) => ({
  id,
  scoreRemaining,
  legsWon,
  threeDartAverage: average,
  dartsThrown,
});

describe('DartIQ projection', () => {
  it('gives the on-throw player a modest opening advantage', () => {
    const result = calculateDartIQProjection({
      players: [player('a'), player('b')],
      playOrder: ['a', 'b'],
      currentPlayerId: 'a',
      dartsRemainingInTurn: 3,
      legsToWin: 1,
      finishRule: 'double_out',
    });

    expect(result.players[0].matchWinProbability).toBeGreaterThan(0.5);
    expect(result.players[0].matchWinProbability).toBeLessThan(0.65);
    expect(result.players.reduce((sum, entry) => sum + entry.matchWinProbability, 0)).toBeCloseTo(1);
  });

  it('strongly favors a player on a finish over an opponent far behind', () => {
    const result = calculateDartIQProjection({
      players: [player('a', 40, 0, 55, 30), player('b', 301, 0, 55, 30)],
      playOrder: ['a', 'b'],
      currentPlayerId: 'a',
      dartsRemainingInTurn: 3,
      legsToWin: 1,
      finishRule: 'double_out',
    });

    expect(result.favoritePlayerId).toBe('a');
    expect(result.players[0].matchWinProbability).toBeGreaterThan(0.8);
  });

  it('carries a lead in legs into the match projection', () => {
    const result = calculateDartIQProjection({
      players: [player('a', 501, 2), player('b', 501, 0)],
      playOrder: ['b', 'a'],
      currentPlayerId: 'b',
      dartsRemainingInTurn: 3,
      legsToWin: 3,
      finishRule: 'double_out',
    });

    expect(result.players[0].matchWinProbability).toBeGreaterThan(0.7);
  });

  it('supports multiplayer races and keeps probabilities normalized', () => {
    const result = calculateDartIQProjection({
      players: [player('a', 120), player('b', 180), player('c', 240)],
      playOrder: ['a', 'b', 'c'],
      currentPlayerId: 'a',
      dartsRemainingInTurn: 2,
      legsToWin: 2,
      finishRule: 'single_out',
    });

    expect(result.players).toHaveLength(3);
    expect(result.players.reduce((sum, entry) => sum + entry.matchWinProbability, 0)).toBeCloseTo(1);
    expect(result.players.reduce((sum, entry) => sum + entry.legWinProbability, 0)).toBeCloseTo(1);
  });

  it('accounts for throw order and match position across four players', () => {
    const result = calculateDartIQProjection({
      players: [
        player('a', 210, 1, 52, 30),
        player('b', 170, 0, 48, 30),
        player('c', 96, 1, 50, 30),
        player('d', 260, 0, 60, 30),
      ],
      playOrder: ['c', 'd', 'a', 'b'],
      currentPlayerId: 'c',
      dartsRemainingInTurn: 2,
      legsToWin: 3,
      finishRule: 'double_out',
    });

    expect(result.players).toHaveLength(4);
    expect(result.favoritePlayerId).toBe('c');
    expect(result.players.reduce((sum, entry) => sum + entry.matchWinProbability, 0)).toBeCloseTo(1);
  });

  it('keeps arbitrarily large multiplayer fields bounded', () => {
    const players = Array.from({ length: 16 }, (_, index) =>
      player(String(index), 501 - index * 20, index === 0 ? 1 : 0, 45 + index, 24)
    );
    const result = calculateDartIQProjection({
      players,
      playOrder: players.map((entry) => entry.id),
      currentPlayerId: '0',
      dartsRemainingInTurn: 3,
      legsToWin: 5,
      finishRule: 'double_out',
    });

    expect(result.players).toHaveLength(16);
    expect(result.players.every((entry) => Number.isFinite(entry.matchWinProbability))).toBe(true);
    expect(result.players.reduce((sum, entry) => sum + entry.matchWinProbability, 0)).toBeCloseTo(1);
  });

  it('locks the result to a completed match winner', () => {
    const result = calculateDartIQProjection({
      players: [player('a', 0, 1), player('b', 40, 0)],
      playOrder: ['a', 'b'],
      currentPlayerId: null,
      dartsRemainingInTurn: 0,
      legsToWin: 1,
      finishRule: 'double_out',
      matchWinnerId: 'a',
    });

    expect(result.players.map((entry) => entry.matchWinProbability)).toEqual([1, 0]);
  });

  it('makes throw advantage state-sensitive instead of scale-free', () => {
    const opening = calculateDartIQProjection({
      players: [player('a'), player('b')],
      playOrder: ['a', 'b'],
      currentPlayerId: 'a',
      dartsRemainingInTurn: 3,
      legsToWin: 3,
      finishRule: 'double_out',
    });
    const atTheDouble = calculateDartIQProjection({
      players: [player('a', 40, 2, 55, 30), player('b', 40, 1, 55, 30)],
      playOrder: ['a', 'b'],
      currentPlayerId: 'a',
      dartsRemainingInTurn: 3,
      legsToWin: 3,
      finishRule: 'double_out',
    });

    expect(atTheDouble.players[0].legWinProbability)
      .toBeGreaterThan(opening.players[0].legWinProbability + 0.05);
  });

  it('keeps Markov probabilities normalized for large multiplayer fields', () => {
    const players = Array.from({ length: 20 }, (_, index) =>
      player(String(index), index === 19 ? 40 : 501 - index * 10, 0, 45 + index, 24)
    );
    const projection = calculateDartIQProjection({
      players,
      playOrder: players.map((entry) => entry.id),
      currentPlayerId: '0',
      dartsRemainingInTurn: 3,
      legsToWin: 5,
      finishRule: 'double_out',
    });

    expect(projection.players.reduce((sum, entry) => sum + entry.legWinProbability, 0))
      .toBeCloseTo(1);
    expect(projection.players.reduce((sum, entry) => sum + entry.matchWinProbability, 0))
      .toBeCloseTo(1);
  });

  it('uses shrunk personal history as the baseline before live form exists', () => {
    const experienced = {
      ...player('a'),
      historicalProfile: {
        playerId: 'a', finishRule: 'double_out' as const, matchesPlayed: 80, visits: 900,
        dartsThrown: 2_700, scoringPoints: 63_000, threeDartAverage: 70,
        busts: 20, bustRate: 0.022, checkoutOpportunities: 300, checkouts: 90,
        checkoutRate: 0.3,
      },
    };
    const result = calculateDartIQProjection({
      players: [experienced, player('b')],
      playOrder: ['a', 'b'],
      currentPlayerId: 'a',
      dartsRemainingInTurn: 3,
      legsToWin: 1,
      finishRule: 'double_out',
    });

    expect(result.players[0].profileSource).toBe('personal');
    expect(result.players[0].historicalDarts).toBe(2_700);
    expect(result.players[0].adjustedThreeDartAverage).toBeGreaterThan(68);
    expect(result.players[0].baselineThreeDartAverage).toBeGreaterThan(68);
  });

  it('does not let one early maximum overwhelm the frozen baseline', () => {
    const result = calculateDartIQProjection({
      players: [player('a', 321, 0, 180, 3), player('b', 501)],
      playOrder: ['b', 'a'],
      currentPlayerId: 'b',
      dartsRemainingInTurn: 3,
      legsToWin: 1,
      finishRule: 'double_out',
    });

    expect(result.players[0].adjustedThreeDartAverage).toBeLessThan(50);
    expect(result.players[0].adjustedThreeDartAverage).toBeGreaterThan(45);
  });

  it('keeps fair-ending checkout-waiting probabilities provisional and normalized', () => {
    const result = calculateDartIQProjection({
      players: [player('a', 0, 0, 55, 30), player('b', 40, 0, 55, 30)],
      playOrder: ['a', 'b'],
      currentPlayerId: 'b',
      dartsRemainingInTurn: 3,
      legsToWin: 2,
      finishRule: 'double_out',
      fairEnding: {
        phase: 'completing_round',
        checkedOutPlayerIds: ['a'],
        tiebreakRound: 0,
        tiebreakPlayerIds: [],
        tiebreakScores: {},
        winnerId: null,
        pendingPlayerIds: ['b'],
        tiebreakDartsThrown: {},
      },
    });

    expect(result.approximationMode).toBe('fair-ending-weighted');
    expect(result.players[0].legWinProbability).toBeGreaterThan(0.5);
    expect(result.players[0].legWinProbability).toBeLessThan(1);
    expect(result.players.reduce((sum, entry) => sum + entry.legWinProbability, 0)).toBeCloseTo(1);
  });

  it('limits tiebreak probability to eligible players in large fields', () => {
    const players = Array.from({ length: 12 }, (_, index) =>
      player(String(index), index < 3 ? 0 : 40, 0, 42 + index, 30)
    );
    const result = calculateDartIQProjection({
      players,
      playOrder: players.map((entry) => entry.id),
      currentPlayerId: '1',
      dartsRemainingInTurn: 2,
      legsToWin: 3,
      finishRule: 'double_out',
      fairEnding: {
        phase: 'tiebreak',
        checkedOutPlayerIds: ['0', '1', '2'],
        tiebreakRound: 1,
        tiebreakPlayerIds: ['0', '1', '2'],
        tiebreakScores: { '0': 100, '1': 60, '2': 0 },
        winnerId: null,
        pendingPlayerIds: ['1', '2'],
        tiebreakDartsThrown: { '0': 3, '1': 1, '2': 0 },
      },
    });

    expect(result.players.slice(3).every((entry) => entry.legWinProbability === 0)).toBe(true);
    expect(result.players.reduce((sum, entry) => sum + entry.legWinProbability, 0)).toBeCloseTo(1);
    expect(result.players.every((entry) => Number.isFinite(entry.matchWinProbability))).toBe(true);
  });
});
