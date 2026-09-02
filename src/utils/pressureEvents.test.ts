import { describe, expect, it } from 'vitest';

import type { PressureDartEvent, PressureReplayState } from './pressureReplay';
import { createPressureDartPacket } from './pressureEvents';

function state(matchProbability: number, legProbability: number): PressureReplayState {
  return {
    legId: 'leg-1',
    legNumber: 1,
    currentPlayerId: 'a',
    dartsRemainingInTurn: 1,
    scores: { a: 40, b: 80 },
    legsWon: { a: 0, b: 0 },
    fairEnding: null,
    projections: [
      {
        id: 'a', scoreRemaining: 40, legsWon: 0, threeDartAverage: 60, dartsThrown: 20,
        adjustedThreeDartAverage: 55, expectedDartsRemaining: 3,
        legWinProbability: legProbability, matchWinProbability: matchProbability,
        baselineThreeDartAverage: 45, historicalDarts: 0, profileConfidence: 0,
        profileSource: 'fallback', checkoutRate: 0.12, populationCheckoutRate: 0.12,
        bustRate: 0.04,
      },
      {
        id: 'b', scoreRemaining: 80, legsWon: 0, threeDartAverage: 60, dartsThrown: 20,
        adjustedThreeDartAverage: 55, expectedDartsRemaining: 5,
        legWinProbability: 1 - legProbability, matchWinProbability: 1 - matchProbability,
        baselineThreeDartAverage: 45, historicalDarts: 0, profileConfidence: 0,
        profileSource: 'fallback', checkoutRate: 0.12, populationCheckoutRate: 0.12,
        bustRate: 0.04,
      },
    ],
  };
}

function event(overrides: Partial<PressureDartEvent> = {}): PressureDartEvent {
  const before = state(0.45, 0.55);
  const after = state(0.54, 0.7);
  return {
    eventId: 'pressure-v2:match-1:dart-1', engineVersion: 'pressure-v2', matchId: 'match-1',
    sequence: 1, legId: 'leg-1', legNumber: 1, turnId: 'turn-1', playerId: 'a',
    dartId: 'dart-1', dartIndex: 1, segment: 'T20', scored: 60, turnScoreAfter: 60,
    busted: false, checkedOut: false, leverage: { leg: 0.8, match: 0.7, pressureIndex: 0.72 },
    fairEndingBefore: null, fairEndingAfter: null,
    checkout: {
      checkoutProbabilityBefore: 0.2, checkoutProbabilityAfter: 0.1,
      nextVisitCheckoutProbability: 0.4, bestAvailableLeaveValue: 0.6,
      actualLeaveValue: 0.55, setupQuality: 0.92, setupGrade: 'good',
      bestSegment: 'D20', createdBogey: false, avoidedBogey: false,
    },
    before, after,
    matchWinProbabilityAdded: { a: 0.09, b: -0.09 },
    legWinProbabilityAdded: { a: 0.15, b: -0.15 },
    ...overrides,
  };
}

describe('createPressureDartPacket', () => {
  it('creates a compact notable packet for a large swing', () => {
    const packet = createPressureDartPacket(event());

    expect(packet).toMatchObject({
      schemaVersion: 2,
      eventId: 'pressure-v2:match-1:dart-1',
      priority: 'notable',
      shouldSpeak: true,
      scoreBefore: 40,
      scoreAfter: 40,
    });
    expect(packet.signals).toContain('favorite_change');
    expect(packet.signals).toContain('large_swing');
  });

  it('keeps uneventful first and second darts silent while preserving the event', () => {
    const quiet = event({
      leverage: { leg: 0.2, match: 0.1, pressureIndex: 0.15 },
      matchWinProbabilityAdded: { a: 0.01, b: -0.01 },
      legWinProbabilityAdded: { a: 0.02, b: -0.02 },
      after: state(0.46, 0.57),
    });

    expect(createPressureDartPacket(quiet)).toMatchObject({ priority: 'silent', shouldSpeak: false });
  });

  it('gives a match-winning checkout terminal priority', () => {
    const after = state(1, 1);
    after.scores.a = 0;
    after.legsWon.a = 1;
    after.projections[0].legsWon = 1;
    const checkout = event({
      checkedOut: true,
      segment: 'D20',
      scored: 40,
      after,
      matchWinProbabilityAdded: { a: 0.55, b: -0.55 },
      legWinProbabilityAdded: { a: 0.45, b: -0.45 },
    });

    const packet = createPressureDartPacket(checkout);
    expect(packet.priority).toBe('terminal');
    expect(packet.signals).toEqual(expect.arrayContaining(['match_win', 'checkout']));
  });

  it('recognizes a completed 180 visit as marquee commentary', () => {
    const packet = createPressureDartPacket(event({
      dartIndex: 3,
      turnScoreAfter: 180,
      matchWinProbabilityAdded: { a: 0.02, b: -0.02 },
      legWinProbabilityAdded: { a: 0.03, b: -0.03 },
      leverage: { leg: 0.3, match: 0.2, pressureIndex: 0.25 },
      after: state(0.47, 0.58),
    }));

    expect(packet.priority).toBe('marquee');
    expect(packet.signals).toContain('one_eighty');
  });

  it('promotes bogey mistakes to notable events', () => {
    const source = event();
    source.checkout = { ...source.checkout, createdBogey: true, setupGrade: 'poor' };
    source.matchWinProbabilityAdded = { a: 0, b: 0 };
    source.legWinProbabilityAdded = { a: 0, b: 0 };
    source.leverage = { leg: 0.3, match: 0.2, pressureIndex: 0.25 };
    source.after = state(0.45, 0.55);

    const packet = createPressureDartPacket(source);
    expect(packet.priority).toBe('notable');
    expect(packet.signals).toContain('bogey_created');
  });

  it('announces a fair-ending checkout without prematurely declaring the leg', () => {
    const packet = createPressureDartPacket(event({
      checkedOut: true,
      fairEndingBefore: {
        phase: 'normal', checkedOutPlayerIds: [], tiebreakRound: 0,
        tiebreakPlayerIds: [], tiebreakScores: {}, winnerId: null,
        pendingPlayerIds: [], tiebreakDartsThrown: {}, approximationMode: 'standard',
      },
      fairEndingAfter: {
        phase: 'completing_round', checkedOutPlayerIds: ['a'], tiebreakRound: 0,
        tiebreakPlayerIds: [], tiebreakScores: {}, winnerId: null,
        pendingPlayerIds: ['b'], tiebreakDartsThrown: {}, approximationMode: 'fair-ending-weighted',
      },
    }));

    expect(packet.priority).toBe('marquee');
    expect(packet.signals).toEqual(expect.arrayContaining(['checkout', 'fair_ending_checkout']));
    expect(packet.signals).not.toContain('leg_win');
    expect(packet.signals).not.toContain('match_win');
    expect(packet.fairEnding).toMatchObject({ phase: 'completing_round', winnerId: null });
  });

  it('emits a terminal win when a non-checkout tiebreak dart resolves the match', () => {
    const after = state(1, 1);
    after.legsWon.a = 1;
    after.projections[0].legsWon = 1;
    const packet = createPressureDartPacket(event({
      checkedOut: false,
      after,
      fairEndingBefore: {
        phase: 'tiebreak', checkedOutPlayerIds: ['a', 'b'], tiebreakRound: 1,
        tiebreakPlayerIds: ['a', 'b'], tiebreakScores: { a: 100, b: 70 }, winnerId: null,
        pendingPlayerIds: ['b'], tiebreakDartsThrown: { a: 3, b: 2 },
        approximationMode: 'fair-ending-weighted',
      },
      fairEndingAfter: {
        phase: 'resolved', checkedOutPlayerIds: ['a', 'b'], tiebreakRound: 1,
        tiebreakPlayerIds: ['a', 'b'], tiebreakScores: { a: 100, b: 80 }, winnerId: 'a',
        pendingPlayerIds: [], tiebreakDartsThrown: { a: 3, b: 3 },
        approximationMode: 'fair-ending-weighted',
      },
      matchWinProbabilityAdded: { a: 0.55, b: -0.55 },
      legWinProbabilityAdded: { a: 0.45, b: -0.45 },
    }));

    expect(packet.priority).toBe('terminal');
    expect(packet.signals).toEqual(expect.arrayContaining(['leg_win', 'match_win']));
    expect(packet.signals).not.toContain('checkout');
  });

  it('keeps the accepted dart score when the replay state has rolled into the next leg', () => {
    const after = state(0.55, 0.5);
    after.legId = 'leg-2';
    after.legNumber = 2;
    after.scores.a = 301;
    const packet = createPressureDartPacket(event({
      segment: 'S20',
      scored: 20,
      before: state(0.45, 0.5),
      after,
      matchWinProbabilityAdded: { a: 0, b: 0 },
      legWinProbabilityAdded: { a: 0.1, b: -0.1 },
    }));

    expect(packet.scoreBefore).toBe(40);
    expect(packet.scoreAfter).toBe(20);
  });
});
