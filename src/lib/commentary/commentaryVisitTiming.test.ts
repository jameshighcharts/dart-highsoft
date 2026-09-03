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

  it('cancels routine audio that is still active when another dart lands', () => {
    const timing = new CommentaryVisitTiming({ ordinaryHoldMs: 0 });
    const ordinary = event();
    timing.observeDart(ordinary);
    timing.schedule(ordinary, () => true);

    expect(timing.observeDart(event({ eventId: 'next-dart', turnId: 'turn-b', dartIndex: 1 })).cancelActiveSpeech)
      .toBe(true);
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

  it('tells moving-play calls to become shorter', () => {
    expect(visitTimingInstruction({ priority: 'notable', nextPlayerAlreadyThrowing: true }))
      .toContain('within 10 words');
  });
});
