import type { DartIQHistoricalFact } from '../dartiq/evidence';
import { selectCommentaryRivalry } from './commentaryNarrative';
import { describe, expect, it } from 'vitest';

import type { DartIQDartEvent } from '@/lib/dartiq/replay';
import { buildCommentaryNarrativeMemory } from './commentaryNarrative';

function dartIQEvent(overrides: Partial<DartIQDartEvent> = {}): DartIQDartEvent {
  return {
    eventId: 'event-1', engineVersion: 'behavioral-v1', matchId: 'match', sequence: 1,
    legId: 'leg', legNumber: 1, turnId: 'turn', playerId: 'a', dartId: 'dart',
    dartIndex: 3, segment: 'S5', scored: 5, turnScoreAfter: 26, busted: false,
    checkedOut: false,
    consequence: { leg: 0.2, match: 0.1 },
    semanticStakes: {
      oneDartFinishAvailable: true,
      finishAvailableThisVisit: true,
      matchWinAvailableThisVisit: true,
    },
    checkout: {
      checkoutProbabilityBefore: 0.2, checkoutProbabilityAfter: 0,
      nextVisitCheckoutProbability: 0, leaveProbabilityChange: 0,
      createdBogey: false, avoidedBogey: false,
    },
    fairEndingBefore: null, fairEndingAfter: null,
    before: {
      scores: { a: 40 },
      projections: [{ id: 'a', matchWinProbability: 0.5 }],
    } as DartIQDartEvent['before'],
    after: {
      scores: { a: 35 },
      projections: [{
        id: 'a', threeDartAverage: 62, baselineThreeDartAverage: 50,
        dartsThrown: 9,
      }],
    } as DartIQDartEvent['after'],
    matchWinProbabilityAdded: { a: -0.1 }, legWinProbabilityAdded: { a: -0.2 },
    ...overrides,
  };
}

describe('buildCommentaryNarrativeMemory', () => {
  it('tracks factual double misses, biggest swing, pressure history, and baseline form', () => {
    const memory = buildCommentaryNarrativeMemory({
      finishRule: 'double_out',
      events: [dartIQEvent()],
      rematch: { previousMatchId: 'old', previousWinnerId: 'b', revengePlayerIds: ['a'] },
    });

    expect(memory.biggestSwing).toMatchObject({ playerId: 'a', matchWpa: -0.1 });
    expect(memory.rematch?.revengePlayerIds).toEqual(['a']);
    expect(memory.players[0]).toMatchObject({
      baselinePerformance: 'outperforming',
      baselineDelta: 12,
      checkoutPressure: {
        opportunities: 1,
        highPressureOpportunities: 1,
        recentUnconvertedOneDartFinishes: [{ scoreBefore: 40, hitSegment: 'S5' }],
      },
    });
  });

  it('only reports tendencies after they recur', () => {
    const events = [1, 2, 3].map((sequence) => dartIQEvent({
      eventId: `event-${sequence}`,
      dartId: `dart-${sequence}`,
      turnId: `turn-${sequence}`,
      sequence,
      turnScoreAfter: 20,
      before: {
        scores: { a: 200 },
        projections: [{ id: 'a', matchWinProbability: 0.5 }],
      } as DartIQDartEvent['before'],
    }));
    const memory = buildCommentaryNarrativeMemory({ events, finishRule: 'double_out' });
    expect(memory.players[0].tendencies).toContain('recurring low-scoring visits');
  });
});


describe('selectCommentaryRivalry', () => {
  const fact = (evidence: Partial<DartIQHistoricalFact['evidence']> = {}): DartIQHistoricalFact => ({
    kind: 'matchup_history', subjectPlayerId: 'a', counterpartPlayerId: 'b',
    support: 5, confidenceTier: 'supported', evidence: {
      sharedMatches: 5, subjectWins: 1, counterpartWins: 4, otherWinnerMatches: 0,
      twoPlayerMatches: 5, latestWinnerPlayerId: 'b', currentWinnerStreak: 3,
      ...evidence,
    } as DartIQHistoricalFact['evidence'],
  });
  const select = (history: DartIQHistoricalFact[], playerIds = ['a', 'b']) =>
    selectCommentaryRivalry({ playerIds, historicalFacts: history });

  it('selects a supported streak with the challenger correctly oriented', () => {
    expect(select([fact()])).toMatchObject({ kind: 'streak', subjectId: 'a', counterpartId: 'b', streak: 3 });
    expect(select([fact({ subjectWins: 4, counterpartWins: 1, latestWinnerPlayerId: 'a' })]))
      .toMatchObject({ kind: 'streak', subjectId: 'b', counterpartId: 'a' });
  });
  it('selects a first breakthrough without requiring an explicit rematch', () => {
    expect(select([fact({ subjectWins: 0, counterpartWins: 5, currentWinnerStreak: 5 })]))
      .toMatchObject({ kind: 'breakthrough', subjectId: 'a', meetings: 5 });
  });
  it('allows multiplayer streaks while retaining their shared-field scope', () => {
    expect(select([fact({ subjectWins: 0, counterpartWins: 3, otherWinnerMatches: 2, twoPlayerMatches: 1 })], ['a', 'b', 'c']))
      .toMatchObject({ kind: 'streak', scope: 'shared', fieldSize: 3 });
  });
  it('uses a tied direct record only when the current match is a duel', () => {
    const tied = fact({ sharedMatches: 4, subjectWins: 2, counterpartWins: 2, twoPlayerMatches: 4, currentWinnerStreak: 1 });
    expect(select([tied])?.kind).toBe('tied_record');
    expect(select([tied], ['a', 'b', 'c'])).toBeNull();
  });
  it.each([
    { confidenceTier: 'thin' as const }, { support: 1 }, { counterpartPlayerId: 'absent' },
    { evidence: { ...fact().evidence, sharedMatches: 2 } },
    { evidence: { ...fact().evidence, subjectWins: -1 } },
    { evidence: { ...fact().evidence, twoPlayerMatches: 6 } },
    { evidence: { ...fact().evidence, currentWinnerStreak: 8 } },
  ])('rejects unsupported or inconsistent evidence: %j', (override) => {
    expect(select([{ ...fact(), ...override }])).toBeNull();
  });
  it('selects the same featured pair regardless of source ordering', () => {
    const other = { ...fact(), subjectPlayerId: 'c', counterpartPlayerId: 'd',
      evidence: { ...fact().evidence, latestWinnerPlayerId: 'd' } };
    expect(select([fact(), other], ['a', 'b', 'c', 'd']))
      .toEqual(select([other, fact()], ['d', 'c', 'b', 'a']));
  });
  it('can seed immediate revenge with a verified rematch winner', () => {
    expect(selectCommentaryRivalry({ playerIds: ['a', 'b'], historicalFacts: [],
      rematch: { previousMatchId: 'old', previousWinnerId: 'b', revengePlayerIds: ['absent', 'a'] } }))
      .toMatchObject({ kind: 'revenge', subjectId: 'a', counterpartId: 'b' });
    expect(select([])).toBeNull();
  });
});
