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
        adjustedThreeDartAverage: 55, expectedVisitsRemaining: 1,
        legWinProbability: legProbability, matchWinProbability: matchProbability,
        baselineThreeDartAverage: 45, historicalDarts: 0, profileConfidence: 0,
        profileSource: 'fallback', checkoutRate: 0.12, populationCheckoutRate: 0.12,
        bustRate: 0.04,
      },
      {
        id: 'b', scoreRemaining: 80, legsWon: 0, threeDartAverage: 60, dartsThrown: 20,
        adjustedThreeDartAverage: 55, expectedVisitsRemaining: 2,
        legWinProbability: 1 - legProbability, matchWinProbability: 1 - matchProbability,
        baselineThreeDartAverage: 45, historicalDarts: 0, profileConfidence: 0,
        profileSource: 'fallback', checkoutRate: 0.12, populationCheckoutRate: 0.12,
        bustRate: 0.04,
      },
    ],
    approximationMode: 'standard',
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

  it('opens an ordinary editorial window for an uneventful first or second dart', () => {
    const quiet = event({
      segment: 'S20',
      scored: 20,
      turnScoreAfter: 20,
      consequence: { leg: 0.02, match: 0.01 },
      matchWinProbabilityAdded: { a: 0.01, b: -0.01 },
      legWinProbabilityAdded: { a: 0.02, b: -0.02 },
      after: state(0.46, 0.57),
    });

    expect(createDartIQDartPacket(quiet)).toMatchObject({ priority: 'ordinary', shouldSpeak: true });
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

  it('names darts-native marquee finishes without inferring an aim', () => {
    const before = state(0.25, 0.2);
    before.scores.a = 170;
    const after = state(0.7, 1);
    after.scores.a = 0;

    const bigFish = createDartIQDartPacket(event({
      before,
      after,
      checkedOut: true,
      segment: 'DB',
      scored: 50,
      turnScoreAfter: 170,
    }));
    expect(bigFish.signals).toEqual(expect.arrayContaining([
      'checkout', 'big_fish', 'bull_checkout',
    ]));
    expect(bigFish.signals).not.toContain('ton_plus_checkout');

    before.scores.a = 120;
    const tonPlus = createDartIQDartPacket(event({
      before, after, checkedOut: true, turnScoreAfter: 120,
    }));
    expect(tonPlus.signals).toContain('ton_plus_checkout');
    expect(tonPlus.signals).not.toContain('big_fish');
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

  it('creates live mid-visit moments for back-to-back T20s and a newly available finish', () => {
    const maximumBefore = state(0.45, 0.55);
    maximumBefore.scores.a = 241;
    const maximumAfter = state(0.5, 0.62);
    maximumAfter.scores.a = 181;
    const maximum = createDartIQDartPacket(event({
      finishRule: 'double_out', dartIndex: 2, segment: 'T20', turnScoreAfter: 120,
      before: maximumBefore, after: maximumAfter,
      consequence: { leg: 0.03, match: 0.02 },
    }));
    expect(maximum.signals).toContain('back_to_back_t20');
    expect(maximum.priority).toBe('notable');

    const finishBefore = state(0.45, 0.55);
    finishBefore.scores.a = 100;
    const finishAfter = state(0.52, 0.68);
    finishAfter.scores.a = 40;
    const finish = createDartIQDartPacket(event({
      finishRule: 'double_out', dartIndex: 1, segment: 'T20', scored: 60,
      turnScoreAfter: 60, before: finishBefore, after: finishAfter,
      consequence: { leg: 0.03, match: 0.02 },
    }));
    expect(finish.signals).toContain('one_dart_finish_created');
    expect(finish.priority).toBe('notable');
  });

  it('flags an unconverted one-dart finish without claiming an attempted target', () => {
    const before = state(0.45, 0.55);
    before.scores.a = 40;
    const after = state(0.42, 0.5);
    after.scores.a = 39;
    const packet = createDartIQDartPacket(event({
      finishRule: 'double_out', dartIndex: 1, segment: 'S1', scored: 1,
      turnScoreAfter: 1, before, after,
      semanticStakes: {
        oneDartFinishAvailable: true,
        finishAvailableThisVisit: true,
        matchWinAvailableThisVisit: false,
        oneDartFinishUnconverted: true,
        unconvertedMatchFinishChancesInVisit: 0,
      },
      consequence: { leg: 0.03, match: 0.01 },
    }));

    expect(packet.signals).toContain('one_dart_finish_unconverted');
    expect(packet.priority).toBe('notable');
  });

  it('allows a factual mid-visit roast for a very low scoring dart in the long game', () => {
    const before = state(0.45, 0.55);
    before.scores.a = 260;
    const after = state(0.44, 0.54);
    after.scores.a = 259;
    const packet = createDartIQDartPacket(event({
      dartIndex: 1, segment: 'S1', scored: 1, turnScoreAfter: 1,
      before, after, consequence: { leg: 0.01, match: 0.005 },
    }));

    expect(packet.signals).toContain('low_scoring_dart');
    expect(packet.priority).toBe('notable');
  });

  it.each([
    ['T19', 57, 'treble_hit'],
    ['D11', 22, 'double_hit'],
    ['Miss', 0, 'missed_board'],
  ] as const)('opens a live reaction window for %s', (segment, scored, signal) => {
    const before = state(0.45, 0.55);
    before.scores.a = 260;
    const after = state(0.46, 0.56);
    after.scores.a = 260 - scored;
    const packet = createDartIQDartPacket(event({
      dartIndex: 1, segment, scored, turnScoreAfter: scored,
      before, after, consequence: { leg: 0.01, match: 0.005 },
    }));

    expect(packet.signals).toContain(signal);
    expect(packet.priority).toBe('notable');
  });

  it('tees up a dangerous opponent at the end of a visit', () => {
    const after = state(0.455, 0.56);
    after.currentPlayerId = 'b';
    const packet = createDartIQDartPacket(event({
      dartIndex: 3,
      nextOpponentThreat: {
        playerId: 'b', scoreRemaining: 41, checkoutProbabilityNextVisit: 0.28,
      },
      consequence: { leg: 0.01, match: 0.005 },
      matchWinProbabilityAdded: { a: 0.005, b: -0.005 },
      legWinProbabilityAdded: { a: 0.01, b: -0.01 },
      after,
    }));

    expect(packet.signals).toContain('opponent_checkout_threat');
    expect(packet.priority).toBe('notable');
    expect(packet.nextPlayer).toEqual({ playerId: 'b', scoreRemaining: 80 });
  });

  it('recognizes nine-dart pace and a completed nine-darter exactly', () => {
    const paceBefore = state(0.5, 0.5);
    paceBefore.scores.a = 201;
    const paceAfter = state(0.65, 0.7);
    paceAfter.scores.a = 141;
    const pace = createDartIQDartPacket(event({
      startScore: 501,
      finishRule: 'double_out',
      playerLegDartNumber: 6,
      dartIndex: 3,
      before: paceBefore,
      after: paceAfter,
    }));
    expect(pace.signals).toContain('nine_dart_pace');
    expect(pace.priority).toBe('marquee');

    const nine = createDartIQDartPacket(event({
      startScore: 501,
      finishRule: 'double_out',
      playerLegDartNumber: 9,
      checkedOut: true,
      segment: 'D12',
    }));
    expect(nine.signals).toContain('nine_darter');
  });

  it('recognizes ton-plus checkouts from the completed visit total, not the final double leave', () => {
    const packet = createDartIQDartPacket(event({
      checkedOut: true,
      dartIndex: 3,
      segment: 'DB',
      scored: 50,
      turnScoreAfter: 170,
    }));

    expect(packet.signals).toContain('big_fish');
    expect(packet.signals).toContain('bull_checkout');
    expect(packet.priority).toBe('marquee');
  });

  it('carries a break of throw and native visit facts without losing the winner subject', () => {
    const packet = createDartIQDartPacket(event({
      firstNineAverage: 104.3,
      tonPlusVisitStreak: 3,
      tonPlusStreakReached: true,
      legResolution: {
        winnerPlayerId: 'b',
        startingPlayerId: 'a',
        wonAgainstThrow: true,
        legsWonAfter: { a: 0, b: 1 },
        matchWon: false,
        nextLeg: { number: 2, startingPlayerId: 'b' },
      },
    }));

    expect(packet.signals).toEqual(expect.arrayContaining([
      'break_of_throw', 'first_nine', 'ton_plus_streak',
    ]));
    expect(packet.legResolution?.winnerPlayerId).toBe('b');
    expect(packet.priority).toBe('notable');
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
