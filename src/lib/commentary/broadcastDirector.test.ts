import { RivalryDirector, type RivalryObservation } from './broadcastDirector';
import type { CommentaryRivalry } from './commentaryNarrative';
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


describe('RivalryDirector', () => {
  const rivalry: CommentaryRivalry = {
    key: 'streak:a:b', kind: 'streak', subjectId: 'a', counterpartId: 'b',
    scope: 'shared', fieldSize: 6, meetings: 5, subjectWins: 1, counterpartWins: 4, streak: 3,
  };
  const visit = (sequence: number, overrides: Partial<RivalryObservation> = {}): RivalryObservation => ({
    eventId: `event-${sequence}`, sequence, turnId: `turn-${sequence}`, playerId: 'a',
    probabilityBefore: 0.16, probabilityAfter: 0.17, matchChance: false, completedVisit: true,
    checkedOut: false, busted: false, protectedMoment: false, legResolved: false,
    fairEndingPending: false, winnerId: null, ...overrides,
  });
  function setup() {
    const director = new RivalryDirector();
    director.reset(rivalry);
    return director;
  }
  function establish(director: RivalryDirector, delivered = false) {
    const beat = director.observe(visit(3))!;
    expect(beat.stage).toBe('establish');
    director.dispatched(beat);
    if (delivered) {
      director.responseCreated('opening', beat);
      director.generationFinished('opening', 'He is starting to charge rent.', true);
      director.playbackStopped('opening', false);
    }
    return beat;
  }
  it('retains the rivalry through quiet visits and notices a large-field gain below 55%', () => {
    const director = setup();
    establish(director, true);
    for (let sequence = 6; sequence <= 60; sequence += 3) expect(director.observe(visit(sequence))).toBeNull();
    expect(director.observe(visit(63, { probabilityAfter: 0.24 })))
      .toMatchObject({ stage: 'threaten', development: 'gain', callbackExcerpt: 'He is starting to charge rent.' });
  });
  it('aggregates the full visit and preserves an earlier match opportunity', () => {
    const director = setup(); establish(director);
    director.observe(visit(10, { turnId: 'visit', completedVisit: false, matchChance: true }));
    director.observe(visit(11, { turnId: 'visit', completedVisit: false }));
    expect(director.observe(visit(12, { turnId: 'visit' })))
      .toMatchObject({ stage: 'twist', development: 'chance_unconverted' });
  });
  it('does not consume a setup or development that loses the speech slot', () => {
    const director = setup();
    expect(director.observe(visit(3))?.stage).toBe('establish');
    const next = director.observe(visit(6))!;
    expect(next.stage).toBe('establish'); director.dispatched(next);
    expect(director.observe(visit(12, { probabilityAfter: 0.25 }))?.development).toBe('gain');
    expect(director.observe(visit(15, { probabilityAfter: 0.25 }))?.development).toBe('gain');
  });
  it('allows an earned match-chance twist beyond two developments and reserves the result', () => {
    const director = setup(); establish(director);
    director.dispatched(director.observe(visit(9, { probabilityAfter: 0.25 }))!);
    expect(director.observe(visit(15, { probabilityAfter: 0.3 }))).toBeNull();
    director.dispatched(director.observe(visit(18, { playerId: 'b', probabilityAfter: 0.3 }))!);
    expect(director.observe(visit(24, { matchChance: true })))
      .toMatchObject({ development: 'chance_unconverted' });
    const ending = director.observe(visit(25, { winnerId: 'a', checkedOut: true, legResolved: true }))!;
    expect(ending).toMatchObject({ stage: 'resolve', development: 'subject_won' });
    director.dispatched(ending);
    expect(director.observe(visit(26, { winnerId: 'a' }))).toBeNull();
  });
  it('anticipates a live finish once per visit without waiting for the ordinary six-dart gap', () => {
    const director = setup(); establish(director, true);
    const anticipation = director.observe(visit(4, { turnId: 'finish-visit', completedVisit: false,
      matchDart: { score: 32, target: 'D16' } }))!;
    expect(anticipation).toMatchObject({ stage: 'anticipate', development: 'match_dart', actorId: 'a',
      matchDart: { score: 32, target: 'D16' } });
    director.dispatched(anticipation);
    expect(director.observe(visit(5, { turnId: 'finish-visit', completedVisit: false,
      matchDart: { score: 16, target: 'D8' } }))).toBeNull();
    expect(director.observe(visit(6, { completedVisit: true, matchDart: { score: 16, target: 'D8' } }))).toBeNull();
  });
  it('gives the rival a live match-dart beat too, but not during fair ending or protected moments', () => {
    const director = setup(); establish(director);
    const chance = { completedVisit: false, playerId: 'b', matchDart: { score: 50, target: 'bull (50)' } };
    expect(director.observe(visit(4, { ...chance, fairEndingPending: true }))).toBeNull();
    expect(director.observe(visit(5, { ...chance, protectedMoment: true }))).toBeNull();
    expect(director.observe(visit(6, chance))).toMatchObject({ stage: 'anticipate', actorId: 'b' });
  });
  it('earns extra beats through alternating reversals with a hard ceiling of six developments', () => {
    const director = setup(); establish(director);
    for (let i = 0; i < 6; i++) {
      const beat = director.observe(visit(9 + i * 6, { playerId: i % 2 ? 'b' : 'a', probabilityAfter: 0.35 }))!;
      expect(beat.development).toBe(i % 2 ? 'rival_response' : 'gain');
      director.dispatched(beat);
    }
    expect(director.observe(visit(45, { probabilityAfter: 0.4 }))).toBeNull();
    expect(director.observe(visit(46, { completedVisit: false, matchDart: { score: 32, target: 'D16' } }))).toBeNull();
    expect(director.observe(visit(47, { winnerId: 'a' }))?.stage).toBe('resolve');
  });
  it('preserves the delivered opening position separately from the latest callback', () => {
    const director = setup(); establish(director, true);
    const turn = director.observe(visit(9, { probabilityAfter: 0.35 }))!;
    director.dispatched(turn); director.responseCreated('twist', turn);
    director.generationFinished('twist', 'Hang on. The tenant has ideas.', true);
    director.playbackStopped('twist', false);
    expect(director.observe(visit(15, { winnerId: 'a' }))).toMatchObject({
      setupExcerpt: 'He is starting to charge rent.', callbackExcerpt: 'Hang on. The tenant has ideas.',
    });
  });
  it.each(['a', 'b', 'c'])('resolves with the actual authoritative winner %s', (winnerId) => {
    const director = setup(); establish(director);
    expect(director.observe(visit(4, { winnerId, playerId: 'c', checkedOut: true, protectedMoment: true })))
      .toMatchObject({ stage: 'resolve', winnerId, development: winnerId === 'a' ? 'subject_won' : winnerId === 'b' ? 'rival_won' : 'other_won' });
  });
  it('never resolves a provisional fair-ending checkout or a leg-only win', () => {
    const director = setup(); establish(director);
    expect(director.observe(visit(9, { checkedOut: true, fairEndingPending: true, probabilityAfter: 1 }))).toBeNull();
    expect(director.observe(visit(12, { checkedOut: true, legResolved: true }))).toBeNull();
    expect(director.observe(visit(15, { fairEndingPending: true, probabilityAfter: 0.6 }))).toBeNull();
  });
  it('ignores duplicate, stale and between-dart observations', () => {
    const director = setup();
    expect(director.observe(visit(2, { completedVisit: false }))).toBeNull();
    establish(director);
    expect(director.observe(visit(3, { winnerId: 'a' }))).toBeNull();
    expect(director.observe(visit(2, { winnerId: 'a' }))).toBeNull();
    expect(director.observe(visit(9, { winnerId: 'a', isLatest: false }))).toBeNull();
  });
  it.each(['generation-first', 'playback-first'])('requires generation AND drained audio: %s', (order) => {
    const director = setup(); const beat = establish(director);
    director.responseCreated('response', beat);
    if (order === 'generation-first') director.generationFinished('response', 'The tenant has ideas.', true);
    else director.playbackStopped('response', false);
    expect(director.observe(visit(9, { probabilityAfter: 0.3 }))?.callbackExcerpt).toBeNull();
    if (order === 'generation-first') director.playbackStopped('response', false);
    else director.generationFinished('response', 'The tenant has ideas.', true);
    expect(director.observe(visit(12, { probabilityAfter: 0.3 }))?.callbackExcerpt).toBe('The tenant has ideas.');
  });
  it.each(['cleared', 'cancelled', 'failed', 'text-only'])('does not remember %s audio', (reason) => {
    const director = setup(); const beat = establish(director);
    director.responseCreated('response', beat);
    director.generationFinished('response', 'Unheard rent joke.', reason !== 'failed' && reason !== 'text-only');
    if (reason === 'cancelled') director.cancelPending();
    director.playbackStopped('response', reason === 'cleared');
    director.playbackStopped('response', false);
    expect(director.observe(visit(9, { probabilityAfter: 0.3 }))?.callbackExcerpt).toBeNull();
  });
  it('clears claims and callback audio on correction or end; reconnect does not repeat setup', () => {
    const director = setup(); establish(director, true);
    director.reset(rivalry, true);
    director.playbackStopped('opening', false);
    expect(director.observe(visit(9))).toBeNull();
    expect(director.observe(visit(12, { probabilityAfter: 0.3 })))
      .toMatchObject({ stage: 'threaten', callbackExcerpt: null });
    director.reset(null);
    expect(director.observe(visit(15, { winnerId: 'a' }))).toBeNull();
  });
  it('lets a promoted live story keep its slot but gives the rivalry its ending', () => {
    const rivalryDirector = setup(); const director = new BroadcastDirector();
    const opening = rivalryDirector.observe(visit(3))!;
    expect(director.direct({ sequence: 3, candidates: [arc('comeback', 0.8)], rivalry: opening }).rivalry).toBeUndefined();
    const ending = rivalryDirector.observe(visit(6, { winnerId: 'a' }))!;
    expect(director.direct({ sequence: 6, candidates: [], matchWinnerId: 'a', rivalry: ending }).rivalry).toEqual(ending);
  });
});
