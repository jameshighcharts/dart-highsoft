import { describe, expect, it } from 'vitest';

import type { PressureDartEvent } from '@/utils/pressureReplay';
import { buildCommentaryNarrativeMemory } from './commentaryNarrative';

function pressureEvent(overrides: Partial<PressureDartEvent> = {}): PressureDartEvent {
  return {
    eventId: 'event-1', engineVersion: 'behavioral-v1', matchId: 'match', sequence: 1,
    legId: 'leg', legNumber: 1, turnId: 'turn', playerId: 'a', dartId: 'dart',
    dartIndex: 3, segment: 'S5', scored: 5, turnScoreAfter: 26, busted: false,
    checkedOut: false,
    consequence: { leg: 0.2, match: 0.1 },
    semanticStakes: {
      directCheckoutOpportunity: true,
      checkoutVisitOpportunity: true,
      matchCheckoutOpportunity: true,
    },
    checkout: {
      checkoutProbabilityBefore: 0.2, checkoutProbabilityAfter: 0,
      nextVisitCheckoutProbability: 0, bestAvailableLeaveValue: 1, actualLeaveValue: 0.5,
      setupQuality: 0.5, setupGrade: 'neutral', bestSegment: 'D20',
      createdBogey: false, avoidedBogey: false,
    },
    fairEndingBefore: null, fairEndingAfter: null,
    before: {
      scores: { a: 40 },
      projections: [{ id: 'a', matchWinProbability: 0.5 }],
    } as PressureDartEvent['before'],
    after: {
      scores: { a: 35 },
      projections: [{
        id: 'a', threeDartAverage: 62, baselineThreeDartAverage: 50,
        dartsThrown: 9,
      }],
    } as PressureDartEvent['after'],
    matchWinProbabilityAdded: { a: -0.1 }, legWinProbabilityAdded: { a: -0.2 },
    ...overrides,
  };
}

describe('buildCommentaryNarrativeMemory', () => {
  it('tracks factual double misses, biggest swing, pressure history, and baseline form', () => {
    const memory = buildCommentaryNarrativeMemory({
      finishRule: 'double_out',
      events: [pressureEvent()],
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
        recentMissedDoubles: [{ scoreBefore: 40, hitSegment: 'S5' }],
      },
    });
  });

  it('only reports tendencies after they recur', () => {
    const events = [1, 2, 3].map((sequence) => pressureEvent({
      eventId: `event-${sequence}`,
      dartId: `dart-${sequence}`,
      turnId: `turn-${sequence}`,
      sequence,
      turnScoreAfter: 20,
      before: {
        scores: { a: 200 },
        projections: [{ id: 'a', matchWinProbability: 0.5 }],
      } as PressureDartEvent['before'],
    }));
    const memory = buildCommentaryNarrativeMemory({ events, finishRule: 'double_out' });
    expect(memory.players[0].tendencies).toContain('recurring low-scoring visits');
  });
});
