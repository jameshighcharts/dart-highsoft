import { describe, expect, it } from 'vitest';

import {
  CommentaryPolicy,
  priorityInstruction,
  visitScopeInstruction,
  type CommentaryPolicyEvent,
} from './commentaryPolicy';

function event(overrides: Partial<CommentaryPolicyEvent> = {}): CommentaryPolicyEvent {
  return {
    eventId: 'dart-1',
    playerId: 'player-1',
    turnId: 'turn-1',
    dartIndex: 3,
    scored: 60,
    turnScore: 100,
    checkedOut: false,
    busted: false,
    matchWon: false,
    priority: 'ordinary',
    signals: [],
    ...overrides,
  };
}

describe('CommentaryPolicy', () => {
  it('samples ordinary completed visits and lets quiet matches breathe', () => {
    const policy = new CommentaryPolicy({ ordinaryEveryVisits: 3, ordinaryQuietWindowMs: 20_000 });

    expect(policy.evaluate(event(), 1_000).shouldSpeak).toBe(true);
    policy.responseFinished();
    expect(policy.evaluate(event({ eventId: 'dart-2', turnId: 'turn-2', turnScore: 41 }), 14_000).reason)
      .toBe('ordinary-sampling');
    expect(policy.evaluate(event({ eventId: 'dart-3', turnId: 'turn-3', turnScore: 45 }), 27_000).shouldSpeak)
      .toBe(true);
  });

  it('uses independent cooldowns per priority', () => {
    const policy = new CommentaryPolicy();
    expect(policy.evaluate(event(), 10_000).shouldSpeak).toBe(true);
    policy.responseFinished();
    expect(policy.evaluate(event({ eventId: 'notable', priority: 'notable', signals: ['large_swing'] }), 11_000).shouldSpeak)
      .toBe(true);
    policy.responseFinished();
    expect(policy.evaluate(event({ eventId: 'notable-2', priority: 'notable', signals: ['favorite_change'] }), 12_000).reason)
      .toBe('cooldown');
  });

  it('suppresses repeat observations within the memory window', () => {
    const policy = new CommentaryPolicy({ cooldownMs: { notable: 0 } });
    const first = event({ priority: 'notable', signals: ['favorite_change'] });
    expect(policy.evaluate(first, 1_000).shouldSpeak).toBe(true);
    policy.responseFinished();
    expect(policy.evaluate({ ...first, eventId: 'dart-2' }, 3_000).reason).toBe('duplicate-observation');
  });

  it('deduplicates ordinary busts by player rather than unique dart id', () => {
    const policy = new CommentaryPolicy({ cooldownMs: { notable: 0 } });
    const bust = event({ priority: 'notable', busted: true, signals: ['bust'] });
    const first = policy.evaluate(bust, 1_000);
    expect(first.shouldSpeak).toBe(true);
    expect(first.guaranteed).toBe(false);
    policy.responseFinished();
    expect(policy.evaluate({ ...bust, eventId: 'dart-2' }, 3_000).reason)
      .toBe('duplicate-observation');
  });

  it('does not prime the commentator to repeat a generic turning-point label', () => {
    expect(priorityInstruction('notable').toLowerCase()).not.toContain('turning point');
    expect(priorityInstruction('notable')).toContain('Call what changed');
    expect(priorityInstruction('ordinary')).toContain('fresh joke');
  });

  it('deduplicates the same directed story while allowing a new arc', () => {
    const policy = new CommentaryPolicy({ cooldownMs: { notable: 0 } });
    const story = event({ priority: 'notable', signals: ['story_arc'], storyKey: 'comeback:a' });
    expect(policy.evaluate(story, 1_000).shouldSpeak).toBe(true);
    policy.responseFinished();
    expect(policy.evaluate({ ...story, eventId: 'dart-2' }, 2_000).reason).toBe('duplicate-observation');
    expect(policy.evaluate({ ...story, eventId: 'dart-3', storyKey: 'miss_punished:b' }, 3_000).shouldSpeak)
      .toBe(true);
  });

  it('stays silent on routine darts during a rapid sequence', () => {
    const policy = new CommentaryPolicy();
    policy.evaluate(event({ eventId: 'dart-1', dartIndex: 1, priority: 'silent' }), 1_000);
    expect(policy.evaluate(event({ eventId: 'dart-2', dartIndex: 3 }), 1_400).reason).toBe('rapid-sequence');
  });

  it('holds non-terminal notable observations until the visit is complete', () => {
    const policy = new CommentaryPolicy();
    expect(policy.evaluate(event({
      dartIndex: 1,
      priority: 'notable',
      signals: ['favorite_change'],
    }), 1_000).reason).toBe('visit-in-progress');
    expect(policy.evaluate(event({
      eventId: 'dart-3',
      dartIndex: 3,
      priority: 'notable',
      signals: ['favorite_change'],
    }), 5_000).shouldSpeak).toBe(true);
  });

  it('reacts immediately to a genuinely large single-dart swing', () => {
    const policy = new CommentaryPolicy();
    const decision = policy.evaluate(event({
      dartIndex: 2,
      priority: 'notable',
      signals: ['large_swing'],
    }), 1_000);

    expect(decision.shouldSpeak).toBe(true);
  });

  it('directs completed calls around the whole visit', () => {
    const instruction = visitScopeInstruction({
      dartIndex: 3,
      turnScore: 140,
      checkedOut: false,
      busted: false,
      visitDarts: [
        { segment: 'T20', scored: 60 },
        { segment: 'T20', scored: 60 },
        { segment: 'S20', scored: 20 },
      ],
    });

    expect(instruction).toContain('completed visit as one beat');
    expect(instruction).not.toContain('140');
    expect(instruction).not.toContain('T20');
  });

  it('uses latest-wins interruption without replacing higher priority speech', () => {
    const policy = new CommentaryPolicy();
    expect(policy.evaluate(event({ priority: 'notable', signals: ['large_swing'] }), 1_000).interrupt).toBe(false);
    expect(policy.evaluate(event({ eventId: 'ordinary', turnScore: 40 }), 15_000).reason)
      .toBe('active-higher-priority');
    const marquee = policy.evaluate(event({ eventId: 'bust', priority: 'marquee', busted: true, signals: ['bust'] }), 16_000);
    expect(marquee.shouldSpeak).toBe(true);
    expect(marquee.interrupt).toBe(true);
  });

  it.each([
    event({ eventId: '180', priority: 'marquee', turnScore: 180, signals: ['one_eighty'] }),
    event({ eventId: 'nikita', priority: 'marquee', turnScore: 26, signals: ['nikita_special'] }),
    event({ eventId: 'bust', priority: 'marquee', busted: true, signals: ['bust'] }),
    event({ eventId: 'checkout', priority: 'marquee', checkedOut: true, scoreBefore: 121, signals: ['checkout'] }),
    event({ eventId: 'leg', priority: 'marquee', checkedOut: true, signals: ['leg_win', 'checkout'] }),
    event({ eventId: 'match', priority: 'terminal', matchWon: true, signals: ['match_win', 'leg_win'] }),
  ])('always calls guaranteed moment $eventId', (guaranteedEvent) => {
    const policy = new CommentaryPolicy();
    policy.evaluate(event({ eventId: 'prior', priority: 'marquee', busted: true, signals: ['bust'] }), 1_000);
    const decision = policy.evaluate(guaranteedEvent, 1_100);
    expect(decision.shouldSpeak).toBe(true);
    expect(decision.guaranteed).toBe(true);
    expect(decision.interrupt).toBe(true);
  });

  it('does not guarantee an inferred unconverted match-finish chance', () => {
    const policy = new CommentaryPolicy();
    const decision = policy.evaluate(event({
      eventId: 'unconverted-match-finish-chances',
      priority: 'notable',
      signals: ['match_finish_chances_unconverted'],
    }), 1_000);

    expect(decision.guaranteed).toBe(false);
  });

  it('allows distinct bad outcomes instead of deduplicating the roast', () => {
    const policy = new CommentaryPolicy({ cooldownMs: { notable: 0 } });
    const first = event({
      eventId: 'bogey-1',
      priority: 'notable',
      signals: ['bogey_created'],
    });
    expect(policy.evaluate(first, 1_000).shouldSpeak).toBe(true);
    policy.responseFinished();
    expect(policy.evaluate({ ...first, eventId: 'bogey-2' }, 2_000).shouldSpeak).toBe(true);
  });

  it('clears invalid narrative memory when the epoch advances', () => {
    const policy = new CommentaryPolicy({ cooldownMs: { notable: 0 } });
    const favorite = event({ priority: 'notable', signals: ['favorite_change'] });
    policy.evaluate(favorite, 1_000);
    policy.reset(4);
    expect(policy.getEpoch()).toBe(4);
    expect(policy.evaluate({ ...favorite, eventId: 'replacement' }, 1_100).shouldSpeak).toBe(true);
  });
});
