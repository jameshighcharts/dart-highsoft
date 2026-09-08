import { describe, expect, it } from 'vitest';

import type { DartIQDartEvent, DartIQReplayState } from '@/lib/dartiq/replay';
import { directCommentaryStoryArc, rankCommentaryStoryArcs } from './storyArcDirector';

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

function multiplayerState(probabilities: Record<string, number>): DartIQReplayState {
  const ids = Object.keys(probabilities);
  const scores = Object.fromEntries(ids.map((id) => [id, 40]));
  return {
    legId: 'leg', legNumber: 1, currentPlayerId: ids[0], currentVisitStartScore: 40,
    dartsRemainingInTurn: 3,
    scores,
    legsWon: Object.fromEntries(ids.map((id) => [id, 0])), fairEnding: null,
    projections: ids.map((id) => ({
      id,
      matchWinProbability: probabilities[id],
      threeDartAverage: 40,
      baselineThreeDartAverage: 40,
      dartsThrown: 30,
    })) as DartIQReplayState['projections'],
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
  dartIndex?: number;
  turnId?: string;
}): DartIQDartEvent {
  const playerId = input.playerId ?? 'a';
  const beforeProbability = input.before.projections.find((entry) => entry.id === playerId)?.matchWinProbability ?? 0;
  const afterProbability = input.after.projections.find((entry) => entry.id === playerId)?.matchWinProbability ?? 0;
  const before = input.scoreBefore === undefined
    ? input.before
    : { ...input.before, scores: { ...input.before.scores, [playerId]: input.scoreBefore } };
  return {
    eventId: `event-${input.sequence}`, engineVersion: 'behavioral-v1', matchId: 'match',
    sequence: input.sequence, legId: 'leg', legNumber: 1, turnId: input.turnId ?? `turn-${input.sequence}`,
    playerId, dartId: `dart-${input.sequence}`, dartIndex: input.dartIndex ?? 3, segment: 'S5', scored: 5,
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
  it('does not cast an evenly matched six-player field as six underdogs', () => {
    const initial = multiplayerState({ a: 1 / 6, b: 1 / 6, c: 1 / 6, d: 1 / 6, e: 1 / 6, f: 1 / 6 });
    const lead = multiplayerState({ a: 0.6, b: 0.08, c: 0.08, d: 0.08, e: 0.08, f: 0.08 });
    const events = Array.from({ length: 4 }, (_, index) => event({
      sequence: index + 1, before: index === 0 ? initial : lead, after: lead,
    }));
    expect(rankCommentaryStoryArcs({ events, finishRule: 'double_out' })
      .some((arc) => arc.kind === 'underdog_rising')).toBe(false);
  });

  it('recognizes a player who started well below their share of a six-player field', () => {
    const initial = multiplayerState({ a: 0.05, b: 0.19, c: 0.19, d: 0.19, e: 0.19, f: 0.19 });
    const lead = multiplayerState({ a: 0.6, b: 0.08, c: 0.08, d: 0.08, e: 0.08, f: 0.08 });
    const events = Array.from({ length: 4 }, (_, index) => event({
      sequence: index + 1, before: index === 0 ? initial : lead, after: lead,
    }));
    expect(rankCommentaryStoryArcs({ events, finishRule: 'double_out' }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'underdog_rising', subjectPlayerId: 'a' })]));
  });

  it('selects a comeback after a real probability recovery', () => {
    const events = [
      event({ sequence: 1, before: state(0.45, 0.55), after: state(0.15, 0.85) }),
      event({ sequence: 2, before: state(0.15, 0.85), after: state(0.25, 0.75) }),
      event({ sequence: 3, before: state(0.25, 0.75), after: state(0.35, 0.65) }),
      event({ sequence: 4, before: state(0.35, 0.65), after: state(0.52, 0.48) }),
    ];
    expect(directCommentaryStoryArc({ events, finishRule: 'double_out' })).toMatchObject({
      kind: 'comeback',
      subjectPlayerId: 'a',
      treatment: 'narrative_callback',
    });
  });

  it('does not invent comeback or seesaw stories from probability flicker inside one visit', () => {
    const events = [
      event({
        sequence: 1, dartIndex: 1, turnId: 'turn-a',
        before: state(0.6, 0.4), after: state(0.35, 0.65),
      }),
      event({
        sequence: 2, dartIndex: 2, turnId: 'turn-a',
        before: state(0.35, 0.65), after: state(0.48, 0.52),
      }),
      event({
        sequence: 3, dartIndex: 3, turnId: 'turn-a',
        before: state(0.48, 0.52), after: state(0.62, 0.38),
      }),
    ];

    const story = directCommentaryStoryArc({ events, finishRule: 'double_out' });
    expect(story?.kind).not.toBe('comeback');
    expect(story?.kind).not.toBe('seesaw_match');
  });

  it('treats a multiplayer favorite carousel as one stable field-wide story', () => {
    const snapshots = [
      { a: 0.3, b: 0.2, c: 0.18, d: 0.14, e: 0.1, f: 0.08 },
      { a: 0.2, b: 0.31, c: 0.18, d: 0.13, e: 0.1, f: 0.08 },
      { a: 0.19, b: 0.2, c: 0.32, d: 0.12, e: 0.09, f: 0.08 },
      { a: 0.18, b: 0.19, c: 0.2, d: 0.33, e: 0.06, f: 0.04 },
      { a: 0.34, b: 0.18, c: 0.17, d: 0.16, e: 0.09, f: 0.06 },
    ];
    const events = snapshots.slice(1).map((after, index) => event({
      sequence: index + 1,
      playerId: Object.keys(after)[index + 1] ?? 'a',
      before: multiplayerState(snapshots[index]),
      after: multiplayerState(after),
    }));

    const seesaw = rankCommentaryStoryArcs({ events, finishRule: 'double_out' })
      .find((arc) => arc.kind === 'seesaw_match');

    expect(seesaw).toMatchObject({
      subjectPlayerId: null,
      counterpartPlayerId: null,
      phase: 'established',
      evidence: {
        favoriteChanges: 4,
        distinctFavorites: 4,
        checkoutContenders: 6,
        playerCount: 6,
      },
    });
  });

  it('does not label a normal late winner as dominant from one locked projection', () => {
    const events = Array.from({ length: 9 }, (_, index) => event({
      sequence: index + 1,
      before: state(index === 8 ? 0.7 : 0.5, index === 8 ? 0.3 : 0.5),
      after: state(index === 8 ? 1 : 0.5, index === 8 ? 0 : 0.5),
      checkedOut: index === 8,
    }));

    expect(directCommentaryStoryArc({ events, finishRule: 'double_out' })?.kind)
      .not.toBe('dominance');
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
    const resolved = event({ sequence: 1, before: state(0.5, 0.5), after: state(1, 0) });
    resolved.legResolution = { winnerPlayerId: 'a', startingPlayerId: 'a', wonAgainstThrow: false, legsWonAfter: { a: 1, b: 0 }, matchWon: true, nextLeg: null };
    const events = [resolved];
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


it('does not close a rematch story from model certainty before resolution', () => {
  const story = directCommentaryStoryArc({
    events: [event({ sequence: 1, before: state(0.5, 0.5), after: state(1, 0) })],
    finishRule: 'double_out', rematch: { previousWinnerId: 'b', revengePlayerIds: ['a'] },
  });
  expect(story?.phase).not.toBe('payoff');
  expect(story?.treatment).not.toBe('match_closing');
});
