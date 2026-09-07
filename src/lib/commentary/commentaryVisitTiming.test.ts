import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CommentaryVisitTiming,
  type CommentaryTimingEvent,
  visitTimingInstruction,
} from './commentaryVisitTiming';

function event(overrides: Partial<CommentaryTimingEvent> = {}): CommentaryTimingEvent {
  return {
    eventId: 'dart-3',
    turnId: 'turn-a',
    playerId: 'player-a',
    dartIndex: 3,
    priority: 'ordinary',
    guaranteed: false,
    ...overrides,
  };
}

afterEach(() => vi.useRealTimers());

describe('CommentaryVisitTiming', () => {
  it('discards aged speech on the next dart even when no replacement call is selected', () => {
    vi.useFakeTimers();
    const timing = new CommentaryVisitTiming();
    const expire = vi.fn();
    timing.trackSpeech(event({ dartIndex: 1 }), expire);
    vi.advanceTimersByTime(2_000);
    timing.observeDart(event({ eventId: 'next', dartIndex: 2 }));
    expect(expire).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(expire).toHaveBeenCalledTimes(1);
  });

  it('cuts the previous visit on a new player but preserves a fresh reaction in the same visit', () => {
    vi.useFakeTimers();
    const timing = new CommentaryVisitTiming();
    const expire = vi.fn();
    timing.trackSpeech(event(), expire);
    timing.observeDart(event({ eventId: 'same-visit', dartIndex: 2 }));
    expect(expire).not.toHaveBeenCalled();
    timing.observeDart(event({ eventId: 'new-visit', turnId: 'turn-b', dartIndex: 1 }));
    expect(expire).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['ordinary', 1, 3_000], ['ordinary', 3, 6_000],
    ['marquee', 3, 8_000], ['terminal', 3, 12_000],
  ] as const)('bounds %s dart %s speech from dispatch, including provider wait', (priority, dartIndex, age) => {
    vi.useFakeTimers();
    const timing = new CommentaryVisitTiming();
    const expire = vi.fn();
    timing.trackSpeech(event({ priority, dartIndex }), expire);
    vi.advanceTimersByTime(age - 1);
    expect(expire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(expire).toHaveBeenCalledTimes(1);
  });

  it('does not let completed or replaced speech timers cancel the current line', () => {
    vi.useFakeTimers();
    const timing = new CommentaryVisitTiming();
    const old = vi.fn();
    const current = vi.fn();
    timing.trackSpeech(event({ dartIndex: 1 }), old);
    vi.advanceTimersByTime(1_000);
    timing.trackSpeech(event({ priority: 'terminal' }), current);
    timing.observeDart(event({ eventId: 'new', turnId: 'turn-b' }));
    vi.advanceTimersByTime(3_000);
    expect(old).not.toHaveBeenCalled();
    expect(current).not.toHaveBeenCalled();
    timing.finishSpeech();
    vi.advanceTimersByTime(20_000);
    expect(current).not.toHaveBeenCalled();
  });

  it('holds an ordinary visit observation for a natural pause', () => {
    vi.useFakeTimers();
    const timing = new CommentaryVisitTiming({ ordinaryHoldMs: 850 });
    const deliver = vi.fn(() => true);
    const ordinary = event();

    timing.observeDart(ordinary);
    expect(timing.schedule(ordinary, deliver)).toBe('held');
    vi.advanceTimersByTime(849);
    expect(deliver).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(deliver).toHaveBeenCalledOnce();
  });

  it('suppresses a held ordinary thought when the next player throws', () => {
    vi.useFakeTimers();
    const timing = new CommentaryVisitTiming({ ordinaryHoldMs: 850 });
    const deliver = vi.fn(() => true);
    const ordinary = event();

    timing.observeDart(ordinary);
    timing.schedule(ordinary, deliver);
    const observation = timing.observeDart(event({
      eventId: 'next-dart',
      turnId: 'turn-b',
      playerId: 'player-b',
      dartIndex: 1,
      priority: 'silent',
    }));
    vi.runAllTimers();

    expect(observation.suppressedPendingSpeech).toBe(true);
    expect(observation.nextPlayerAlreadyThrowing).toBe(true);
    expect(deliver).not.toHaveBeenCalled();
  });

  it.each(['marquee', 'terminal'] as const)('never delays a %s response', (priority) => {
    vi.useFakeTimers();
    const timing = new CommentaryVisitTiming({ ordinaryHoldMs: 850 });
    const deliver = vi.fn(() => true);
    const call = event({ priority, guaranteed: true });

    timing.observeDart(call);
    expect(timing.schedule(call, deliver)).toBe('immediate');
    expect(deliver).toHaveBeenCalledOnce();
  });

  it('nudges once after a long pause and cancels when play resumes', () => {
    vi.useFakeTimers();
    const timing = new CommentaryVisitTiming();
    const deliver = vi.fn();
    timing.scheduleIdle(deliver);
    vi.advanceTimersByTime(19_999);
    expect(deliver).not.toHaveBeenCalled();
    timing.observeDart(event());
    vi.advanceTimersByTime(60_000);
    expect(deliver).not.toHaveBeenCalled();
    timing.scheduleIdle(deliver);
    vi.advanceTimersByTime(60_000);
    expect(deliver).toHaveBeenCalledOnce();
  });

  it('invalidates an idle check already awaiting the database on a dart or correction', () => {
    vi.useFakeTimers();
    const timing = new CommentaryVisitTiming();
    let isCurrent = () => false;
    timing.scheduleIdle((check) => { isCurrent = check; });
    vi.advanceTimersByTime(20_000);
    expect(isCurrent()).toBe(true);
    timing.observeDart(event());
    expect(isCurrent()).toBe(false);
    timing.scheduleIdle((check) => { isCurrent = check; });
    vi.advanceTimersByTime(20_000);
    timing.reset();
    expect(isCurrent()).toBe(false);
  });

  it('tells moving-play calls to become shorter', () => {
    expect(visitTimingInstruction({ priority: 'notable', nextPlayerAlreadyThrowing: true }))
      .toBe('next player throwing');
  });
});
