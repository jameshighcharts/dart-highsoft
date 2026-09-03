import { describe, expect, it } from 'vitest';

import type { DartIQDartEvent, DartIQReplayState } from './replay';
import { analyzeDartIQTimeline, summarizeDartIQForTurn } from './insights';

function state(
  legProbabilityA: number,
  matchProbabilityA: number,
  legsA = 0,
  legsB = 0
): DartIQReplayState {
  return {
    legId: 'leg-1',
    legNumber: 1,
    currentPlayerId: 'a',
    dartsRemainingInTurn: 1,
    scores: { a: 40, b: 80 },
    legsWon: { a: legsA, b: legsB },
    fairEnding: null,
    projections: [
      {
        id: 'a', scoreRemaining: 40, legsWon: legsA, threeDartAverage: 50, dartsThrown: 30,
        adjustedThreeDartAverage: 50, expectedDartsRemaining: 3,
        legWinProbability: legProbabilityA, matchWinProbability: matchProbabilityA,
        baselineThreeDartAverage: 45, historicalDarts: 0, profileConfidence: 0,
        profileSource: 'fallback', checkoutRate: 0.12, populationCheckoutRate: 0.12,
        bustRate: 0.04,
      },
      {
        id: 'b', scoreRemaining: 80, legsWon: legsB, threeDartAverage: 50, dartsThrown: 30,
        adjustedThreeDartAverage: 50, expectedDartsRemaining: 6,
        legWinProbability: 1 - legProbabilityA, matchWinProbability: 1 - matchProbabilityA,
        baselineThreeDartAverage: 45, historicalDarts: 0, profileConfidence: 0,
        profileSource: 'fallback', checkoutRate: 0.12, populationCheckoutRate: 0.12,
        bustRate: 0.04,
      },
    ],
  };
}

function event(
  sequence: number,
  before: DartIQReplayState,
  after: DartIQReplayState,
  options: { checkedOut?: boolean; busted?: boolean } = {}
): DartIQDartEvent {
  const beforeA = before.projections[0];
  const afterA = after.projections[0];
  return {
    eventId: `behavioral-v1:match-1:dart-${sequence}`, engineVersion: 'behavioral-v1', matchId: 'match-1',
    sequence, legId: 'leg-1', legNumber: 1, turnId: 'turn-1', playerId: 'a',
    dartId: `dart-${sequence}`, dartIndex: sequence, segment: 'D20', scored: 40, turnScoreAfter: 40 * sequence,
    busted: options.busted ?? false, checkedOut: options.checkedOut ?? false,
    fairEndingBefore: null, fairEndingAfter: null,
    consequence: {
      leg: Math.abs(afterA.legWinProbability - beforeA.legWinProbability),
      match: Math.abs(afterA.matchWinProbability - beforeA.matchWinProbability),
    },
    semanticStakes: {
      oneDartFinishAvailable: false,
      finishAvailableThisVisit: false,
      matchWinAvailableThisVisit: false,
    },
    checkout: {
      checkoutProbabilityBefore: 0.2, checkoutProbabilityAfter: 0.1,
      nextVisitCheckoutProbability: 0.4, leaveProbabilityChange: 0.12,
      createdBogey: false, avoidedBogey: false,
    },
    before, after,
    matchWinProbabilityAdded: {
      a: afterA.matchWinProbability - beforeA.matchWinProbability,
      b: after.projections[1].matchWinProbability - before.projections[1].matchWinProbability,
    },
    legWinProbabilityAdded: {
      a: afterA.legWinProbability - beforeA.legWinProbability,
      b: after.projections[1].legWinProbability - before.projections[1].legWinProbability,
    },
  };
}

describe('analyzeDartIQTimeline', () => {
  it('finds the turning point and a change in match favorite', () => {
    const first = event(1, state(0.35, 0.4), state(0.6, 0.55));
    const second = event(2, state(0.6, 0.55), state(0.88, 0.82));
    const insights = analyzeDartIQTimeline([first, second]);

    expect(insights.leadChanges).toHaveLength(1);
    expect(insights.leadChanges[0]).toMatchObject({ previousLeaderId: 'b', newLeaderId: 'a' });
    expect(insights.turningPoint?.sequence).toBe(2);
    expect(insights.biggestPositiveSwing?.matchWpa).toBeCloseTo(0.27);
  });

  it('identifies stolen and thrown-away legs from probability extremes', () => {
    const lowPoint = event(1, state(0.15, 0.3), state(0.1, 0.25));
    const comeback = event(2, state(0.1, 0.25), state(1, 1, 1, 0), { checkedOut: true });
    const insights = analyzeDartIQTimeline([lowPoint, comeback]);

    expect(insights.stolenLegs).toEqual([
      expect.objectContaining({ playerId: 'a', winnerId: 'a', probability: 0.1 }),
    ]);
    expect(insights.thrownAwayLegs).toEqual([
      expect.objectContaining({ playerId: 'b', winnerId: 'a', probability: 0.9 }),
    ]);
  });

  it('keeps pressure busts separate from positive clutch events', () => {
    const bust = event(1, state(0.65, 0.6), state(0.4, 0.38), { busted: true });
    const insights = analyzeDartIQTimeline([bust]);

    expect(insights.commentaryMoments.map((moment) => moment.kind)).toContain('lead_change');
    expect(insights.commentaryMoments.map((moment) => moment.kind)).toContain('pressure_bust');
    expect(insights.commentaryMoments.map((moment) => moment.kind)).not.toContain('surge');
  });

  it('returns an empty summary for an empty timeline', () => {
    const insights = analyzeDartIQTimeline([]);
    expect(insights.turningPoint).toBeNull();
    expect(insights.commentaryMoments).toEqual([]);
  });

  it('condenses multiple darts into one commentary-safe turn summary', () => {
    const first = event(1, state(0.3, 0.35), state(0.45, 0.44));
    const second = event(2, state(0.45, 0.44), state(0.7, 0.61));
    const summary = summarizeDartIQForTurn([first, second], 'turn-1', 'a');

    expect(summary).toMatchObject({
      matchProbabilityBefore: 0.35,
      matchProbabilityAfter: 0.61,
      matchWpa: 0.26,
      legProbabilityBefore: 0.3,
      legProbabilityAfter: 0.7,
      changedMatchFavorite: true,
      leaveProbabilityChange: 0.12,
      nextVisitCheckoutProbability: 0.4,
      createdBogey: false,
    });
    expect(summary?.peakLegConsequence).toBeCloseTo(0.25);
    expect(summary?.peakMatchConsequence).toBeCloseTo(0.17);
    expect(summary?.biggestDartMatchWpa).toBeCloseTo(0.17);
  });
});
