import { describe, expect, it } from 'vitest';

import {
  BroadcastDirector,
  broadcastDirectionInstruction,
} from './broadcastDirector';
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
  });

  it('creates a callback obligation and forces its match resolution', () => {
    const director = new BroadcastDirector();
    const revenge = arc('rematch_revenge', 0.75);
    const opening = director.direct({ sequence: 20, candidates: [revenge] });
    const ending = director.direct({ sequence: 30, candidates: [
      { ...revenge, phase: 'payoff' },
    ], matchWinnerId: 'a' });

    expect(opening.callback).toMatchObject({ trigger: 'match_resolution', status: 'watching' });
    expect(ending.transition).toBe('payoff_due');
    expect(ending.callback).toMatchObject({ trigger: 'match_resolution', status: 'payoff_due' });
    expect(broadcastDirectionInstruction(ending)).toContain('resolve the named active story');
    director.markMentioned(ending);
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

  it('budgets repeated promotion of the same active story', () => {
    const director = new BroadcastDirector();
    const comeback = arc('comeback', 0.8);
    const first = director.direct({ sequence: 5, candidates: [comeback] });
    expect(first.shouldPromote).toBe(true);
    director.markMentioned(first);

    const held = director.direct({ sequence: 6, candidates: [comeback] });
    expect(held.shouldPromote).toBe(false);
    expect(broadcastDirectionInstruction(held)).toContain('keep the named active story in memory');
  });

  it('keeps an unspoken story promoted until a completed visit can use it', () => {
    const director = new BroadcastDirector();
    const comeback = arc('comeback', 0.8);

    expect(director.direct({ sequence: 5, candidates: [comeback] }).shouldPromote).toBe(true);
    expect(director.direct({ sequence: 6, candidates: [comeback] }).shouldPromote).toBe(true);
    expect(director.direct({ sequence: 7, candidates: [comeback] }).shouldPromote).toBe(true);
  });
});
