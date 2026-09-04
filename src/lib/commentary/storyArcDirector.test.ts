import { describe, expect, it } from 'vitest';

import type { DartIQDartEvent, DartIQReplayState } from '@/lib/dartiq/replay';
import { directCommentaryStoryArc } from './storyArcDirector';

function state(a: number, b: number, scores = { a: 200, b: 200 }): DartIQReplayState {
  return {
    legId: 'leg', legNumber: 1, currentPlayerId: 'a', currentVisitStartScore: scores.a,
    dartsRemainingInTurn: 3,
    scores,
    legsWon: { a: 0, b: 0 }, fairEnding: null,
    projections: [
      { id: 'a', matchWinProbability: a, threeDartAverage: 50, baselineThreeDartAverage: 50, dartsThrown: 9 },
      { id: 'b', matchWinProbability: b, threeDartAverage: 50, baselineThreeDartAverage: 50, dartsThrown: 9 },
    ] as DartIQReplayState['projections'],
    approximationMode: 'standard',
  };
}

function event(input: {
  sequence: number;
  playerId?: string;
  before: DartIQReplayState;
  after: DartIQReplayState;
  checkedOut?: boolean;
  scoreBefore?: number;
}): DartIQDartEvent {
  const playerId = input.playerId ?? 'a';
  const beforeProbability = input.before.projections.find((entry) => entry.id === playerId)?.matchWinProbability ?? 0;
  const afterProbability = input.after.projections.find((entry) => entry.id === playerId)?.matchWinProbability ?? 0;
  const before = input.scoreBefore === undefined
    ? input.before
    : { ...input.before, scores: { ...input.before.scores, [playerId]: input.scoreBefore } };
  return {
    eventId: `event-${input.sequence}`, engineVersion: 'behavioral-v1', matchId: 'match',
    sequence: input.sequence, legId: 'leg', legNumber: 1, turnId: `turn-${input.sequence}`,
    playerId, dartId: `dart-${input.sequence}`, dartIndex: 3, segment: 'S5', scored: 5,
    turnScoreAfter: 60, busted: false, checkedOut: input.checkedOut ?? false,
    consequence: { leg: Math.abs(afterProbability - beforeProbability), match: Math.abs(afterProbability - beforeProbability) },
    semanticStakes: {
      oneDartFinishAvailable: input.scoreBefore !== undefined,
      finishAvailableThisVisit: input.scoreBefore !== undefined,
      matchWinAvailableThisVisit: false,
    },
    checkout: {
      checkoutProbabilityBefore: input.scoreBefore ? 0.3 : 0,
      checkoutProbabilityAfter: 0, nextVisitCheckoutProbability: 0,
      leaveProbabilityChange: 0,
      createdBogey: false, avoidedBogey: false,
    },
    fairEndingBefore: null, fairEndingAfter: null, before, after: input.after,
    matchWinProbabilityAdded: { [playerId]: afterProbability - beforeProbability },
    legWinProbabilityAdded: { [playerId]: afterProbability - beforeProbability },
  };
}

describe('directCommentaryStoryArc', () => {
  it('selects a comeback after a real probability recovery', () => {
    const events = [
      event({ sequence: 1, before: state(0.45, 0.55), after: state(0.15, 0.85) }),
      event({ sequence: 2, before: state(0.15, 0.85), after: state(0.52, 0.48) }),
    ];
    expect(directCommentaryStoryArc({ events, finishRule: 'double_out' })).toMatchObject({
      kind: 'comeback',
      subjectPlayerId: 'a',
      treatment: 'narrative_callback',
    });
  });

  it('prioritizes an opponent immediately punishing a failed double leave', () => {
    const events = [
      event({ sequence: 1, playerId: 'a', before: state(0.5, 0.5), after: state(0.4, 0.6), scoreBefore: 40 }),
      event({ sequence: 2, playerId: 'b', before: state(0.4, 0.6), after: state(0.2, 0.8), checkedOut: true, scoreBefore: 32 }),
    ];
    expect(directCommentaryStoryArc({ events, finishRule: 'double_out' })).toMatchObject({
      kind: 'finish_chance_punished',
      phase: 'payoff',
      subjectPlayerId: 'b',
      counterpartPlayerId: 'a',
      treatment: 'light_sass',
    });
  });

  it('turns a rematch win into a revenge payoff', () => {
    const events = [event({ sequence: 1, before: state(0.5, 0.5), after: state(1, 0) })];
    expect(directCommentaryStoryArc({
      events,
      finishRule: 'double_out',
      rematch: { previousWinnerId: 'b', revengePlayerIds: ['a'] },
    })).toMatchObject({
      kind: 'rematch_revenge',
      phase: 'payoff',
      treatment: 'match_closing',
      subjectPlayerId: 'a',
      counterpartPlayerId: 'b',
    });
  });

  it('stays quiet when no story has earned the label', () => {
    const events = [event({ sequence: 1, before: state(0.5, 0.5), after: state(0.52, 0.48) })];
    expect(directCommentaryStoryArc({ events, finishRule: 'double_out' })).toBeNull();
  });
});
