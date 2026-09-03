import { describe, expect, it } from 'vitest';

import type { DartIQDartEvent, DartIQReplayState } from './replay';
import { createDartIQDartPacket } from './events';

function state(matchProbability: number, legProbability: number): DartIQReplayState {
  return {
    legId: 'leg-1',
    legNumber: 1,
    currentPlayerId: 'a',
    currentVisitStartScore: 100,
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

function event(overrides: Partial<DartIQDartEvent> = {}): DartIQDartEvent {
  const before = state(0.45, 0.55);
  const after = state(0.54, 0.7);
  return {
    eventId: 'behavioral-v1:match-1:dart-1', engineVersion: 'behavioral-v1', matchId: 'match-1',
    sequence: 1, legId: 'leg-1', legNumber: 1, turnId: 'turn-1', playerId: 'a',
    dartId: 'dart-1', dartIndex: 1, segment: 'T20', scored: 60, turnScoreAfter: 60,
    busted: false, checkedOut: false,
    consequence: { leg: 0.15, match: 0.09 },
    semanticStakes: {
      oneDartFinishAvailable: false,
      finishAvailableThisVisit: false,
      matchWinAvailableThisVisit: false,
      oneDartFinishUnconverted: false,
      unconvertedMatchFinishChancesInVisit: 0,
    },
    fairEndingBefore: null, fairEndingAfter: null,
    checkout: {
      checkoutProbabilityBefore: 0.2, checkoutProbabilityAfter: 0.1,
      nextVisitCheckoutProbability: 0.4, leaveProbabilityChange: 0.12,
      createdBogey: false, avoidedBogey: false,
    },
    before, after,
    matchWinProbabilityAdded: { a: 0.09, b: -0.09 },
    legWinProbabilityAdded: { a: 0.15, b: -0.15 },
    ...overrides,
  };
}

describe('createDartIQDartPacket', () => {
  it('creates a compact notable packet for a large swing', () => {
    const packet = createDartIQDartPacket(event());

    expect(packet).toMatchObject({
      schemaVersion: 2,
      eventId: 'behavioral-v1:match-1:dart-1',
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
      consequence: { leg: 0.02, match: 0.01 },
      matchWinProbabilityAdded: { a: 0.01, b: -0.01 },
      legWinProbabilityAdded: { a: 0.02, b: -0.02 },
      after: state(0.46, 0.57),
    });

    expect(createDartIQDartPacket(quiet)).toMatchObject({ priority: 'silent', shouldSpeak: false });
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

    const packet = createDartIQDartPacket(checkout);
    expect(packet.priority).toBe('terminal');
    expect(packet.signals).toEqual(expect.arrayContaining(['match_win', 'checkout']));
  });

  it('recognizes a completed 180 visit as marquee commentary', () => {
    const packet = createDartIQDartPacket(event({
      dartIndex: 3,
      turnScoreAfter: 180,
      matchWinProbabilityAdded: { a: 0.02, b: -0.02 },
      legWinProbabilityAdded: { a: 0.03, b: -0.03 },
      consequence: { leg: 0.03, match: 0.02 },
      after: state(0.47, 0.58),
    }));

    expect(packet.priority).toBe('marquee');
    expect(packet.signals).toContain('one_eighty');
  });

  it('reports repeated unconverted match-finish chances only when the visit completes', () => {
    const midVisit = event({
      dartIndex: 2,
      semanticStakes: {
        oneDartFinishAvailable: true,
        finishAvailableThisVisit: true,
        matchWinAvailableThisVisit: true,
        oneDartFinishUnconverted: true,
        unconvertedMatchFinishChancesInVisit: 2,
      },
      consequence: { leg: 0.01, match: 0.01 },
    });
    const completedVisit = event({
      ...midVisit,
      dartIndex: 3,
    });

    expect(createDartIQDartPacket(midVisit).signals).not.toContain('match_finish_chances_unconverted');
    expect(createDartIQDartPacket(completedVisit)).toMatchObject({
      priority: 'notable',
      shouldSpeak: true,
    });
    expect(createDartIQDartPacket(completedVisit).signals).toContain('match_finish_chances_unconverted');
  });

  it('promotes bogey mistakes to notable events', () => {
    const source = event();
    source.checkout = { ...source.checkout, createdBogey: true };
    source.matchWinProbabilityAdded = { a: 0, b: 0 };
    source.legWinProbabilityAdded = { a: 0, b: 0 };
    source.consequence = { leg: 0, match: 0 };
    source.after = state(0.45, 0.55);

    const packet = createDartIQDartPacket(source);
    expect(packet.priority).toBe('notable');
    expect(packet.signals).toContain('bogey_created');
  });

  it('announces a fair-ending checkout without prematurely declaring the leg', () => {
    const packet = createDartIQDartPacket(event({
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
    const packet = createDartIQDartPacket(event({
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
    const packet = createDartIQDartPacket(event({
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
