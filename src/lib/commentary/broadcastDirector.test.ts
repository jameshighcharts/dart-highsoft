import { describe, expect, it } from 'vitest';

import {
  BroadcastDirector,
  broadcastDirectionInstruction,
  buildBroadcastStoryTimeline,
  storyArcKey,
} from './broadcastDirector';
import type { DartIQDartEvent } from '@/lib/dartiq/replay';
import type { CommentaryStoryArc } from './storyArcDirector';

function arc(
  kind: CommentaryStoryArc['kind'],
  strength: number,
  overrides: Partial<CommentaryStoryArc> = {}
): CommentaryStoryArc {
  return {
    kind,
    phase: 'developing',
    treatment: 'narrative_callback',
    strength,
    subjectPlayerId: 'a',
    counterpartPlayerId: 'b',
    evidence: {},
    ...overrides,
  };
}

describe('BroadcastDirector', () => {
  it('commits to an active story instead of chasing a small fluctuation', () => {
    const director = new BroadcastDirector();
    director.direct({ sequence: 10, candidates: [arc('comeback', 0.7)] });
    const direction = director.direct({
      sequence: 11,
      candidates: [arc('collapse', 0.78), arc('comeback', 0.69)],
    });

    expect(direction.activeStoryArc?.kind).toBe('comeback');
    expect(direction.backgroundStoryArcs[0]?.kind).toBe('collapse');
    expect(direction.transition).toBe('continued');
  });

  it('switches after commitment when a materially stronger story emerges', () => {
    const director = new BroadcastDirector();
    director.direct({ sequence: 10, candidates: [arc('comeback', 0.55)] });
    const direction = director.direct({
      sequence: 14,
      candidates: [arc('finish_chance_punished', 0.9, { phase: 'payoff' })],
    });

    expect(direction.activeStoryArc?.kind).toBe('finish_chance_punished');
    expect(direction.transition).toBe('payoff_due');
    expect(direction.lifecycleEvents.map((event) => [event.type, event.closeReason])).toEqual([
      ['closed', 'superseded'],
      ['switched_in', undefined],
      ['payoff_due', undefined],
    ]);
  });

  it('creates a callback obligation and forces its match resolution', () => {
    const director = new BroadcastDirector();
    const revenge = arc('rematch_revenge', 0.75);
    const opening = director.direct({ sequence: 20, candidates: [revenge] });
    const ending = director.direct({ sequence: 30, candidates: [
      { ...revenge, phase: 'payoff' },
    ], matchWinnerId: 'a' });

    expect(opening.callback).toMatchObject({ trigger: 'match_resolution', status: 'watching' });
    expect(opening.lifecycleEvents.map((event) => event.type)).toEqual(['opened']);
    expect(ending.transition).toBe('payoff_due');
    expect(ending.callback).toMatchObject({ trigger: 'match_resolution', status: 'payoff_due' });
    expect(broadcastDirectionInstruction(ending)).toContain('Pay off the supplied earlier thread');
    director.markResponseCompleted(ending);
    const afterPayoff = director.direct({
      sequence: 31,
      candidates: [{ ...revenge, phase: 'payoff' }],
      matchWinnerId: 'a',
    });
    expect(afterPayoff.transition).toBe('continued');
    expect(afterPayoff.shouldPromote).toBe(false);
  });

  it('closes an established story when the counterpart wins', () => {
    const director = new BroadcastDirector();
    const comeback = arc('comeback', 0.8);
    director.direct({ sequence: 5, candidates: [comeback] });
    const ending = director.direct({ sequence: 15, candidates: [comeback], matchWinnerId: 'b' });

    expect(ending.transition).toBe('closure_due');
    expect(ending.callback).toMatchObject({
      trigger: 'probability_reversal',
      status: 'closure_due',
    });
  });

  it('uses the declared callback trigger instead of waiting for match resolution', () => {
    const director = new BroadcastDirector();
    const duel = arc('checkout_duel', 0.76, { phase: 'established' });
    director.direct({ sequence: 3, candidates: [duel] });
    const payoff = director.direct({
      sequence: 8,
      candidates: [duel],
      observedTriggers: ['next_checkout_chance'],
      triggerPlayerId: 'a',
    });
    expect(payoff.transition).toBe('payoff_due');
    expect(payoff.lifecycleEvents.at(-1)?.type).toBe('payoff_due');
  });

  it('budgets repeated promotion of the same active story', () => {
    const director = new BroadcastDirector();
    const comeback = arc('comeback', 0.8);
    const first = director.direct({ sequence: 5, candidates: [comeback] });
    expect(first.shouldPromote).toBe(true);
    director.markMentioned(first);

    const held = director.direct({ sequence: 6, candidates: [comeback] });
    expect(held.shouldPromote).toBe(false);
    expect(broadcastDirectionInstruction(held)).toBe('');
  });

  it('keeps an unspoken story promoted until a completed visit can use it', () => {
    const director = new BroadcastDirector();
    const comeback = arc('comeback', 0.8);

    expect(director.direct({ sequence: 5, candidates: [comeback] }).shouldPromote).toBe(true);
    expect(director.direct({ sequence: 6, candidates: [comeback] }).shouldPromote).toBe(true);
    expect(director.direct({ sequence: 7, candidates: [comeback] }).shouldPromote).toBe(true);
  });

  it('does not fulfil a callback until speech actually completes', () => {
    const director = new BroadcastDirector();
    const revenge = arc('rematch_revenge', 0.75);
    director.direct({ sequence: 1, candidates: [revenge] });
    const due = director.direct({
      sequence: 9,
      candidates: [{ ...revenge, phase: 'payoff' }],
      matchWinnerId: 'a',
    });
    director.markMentioned(due);
    expect(director.direct({
      sequence: 10,
      candidates: [{ ...revenge, phase: 'payoff' }],
      matchWinnerId: 'a',
    }).transition).toBe('payoff_due');
    director.markResponseCompleted(due);
    expect(director.direct({
      sequence: 11,
      candidates: [{ ...revenge, phase: 'payoff' }],
      matchWinnerId: 'a',
    }).transition).toBe('continued');
  });

  it('does not let a late response fulfil a newer arc', () => {
    const director = new BroadcastDirector();
    const oldArc = arc('comeback', 0.7, { phase: 'payoff' });
    const oldDue = director.direct({ sequence: 1, candidates: [oldArc] });
    const newArc = arc('finish_chance_punished', 0.95, {
      phase: 'payoff',
      subjectPlayerId: 'b',
      counterpartPlayerId: 'a',
    });
    director.direct({ sequence: 5, candidates: [newArc] });
    director.markResponseCompleted(oldDue);
    const stillDue = director.direct({ sequence: 6, candidates: [newArc] });
    expect(stillDue.transition).toBe('payoff_due');
    expect(stillDue.callback?.arcKey).toBe(storyArcKey(newArc));
  });

  it('builds a deterministic report timeline from story start through payoff', () => {
    const events = Array.from({ length: 10 }, (_, index) => ({
      sequence: index + 1,
      dartId: `dart-${index + 1}`,
      legNumber: 1,
      turnId: `turn-${index + 1}`,
      playerId: 'a',
      dartIndex: 3,
      checkedOut: false,
      before: {
        scores: { a: 301, b: 301 },
        projections: [
          { id: 'a', matchWinProbability: index === 0 ? 0.85 : 0.9 },
          { id: 'b', matchWinProbability: index === 0 ? 0.15 : 0.1 },
        ],
      },
      after: {
        scores: { a: 281, b: 301 },
        projections: [
          { id: 'a', matchWinProbability: index === 9 ? 1 : 0.9 },
          { id: 'b', matchWinProbability: index === 9 ? 0 : 0.1 },
        ],
      },
      checkout: { checkoutProbabilityBefore: 0 },
      semanticStakes: {},
      ...(index === 9 ? {
        legResolution: {
          winnerPlayerId: 'a', startingPlayerId: 'a', wonAgainstThrow: false,
          legsWonAfter: { a: 3, b: 0 }, matchWon: true, nextLeg: null,
        },
      } : {}),
    })) as unknown as DartIQDartEvent[];

    const beats = buildBroadcastStoryTimeline({ events, finishRule: 'double_out' });
    expect(beats.map((beat) => beat.transition)).toEqual(['started', 'payoff_due']);
    expect(beats.every((beat) => beat.arc.kind === 'dominance')).toBe(true);
    expect(beats.at(-1)?.dartId).toBe('dart-10');
  });
});
