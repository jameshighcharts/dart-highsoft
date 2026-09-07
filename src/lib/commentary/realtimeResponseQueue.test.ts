import { afterEach, describe, expect, it, vi } from 'vitest';

import { RealtimeResponseQueue } from './realtimeResponseQueue';
afterEach(() => vi.useRealTimers());

describe('RealtimeResponseQueue', () => {
  it('releases only a matching rejected create and preserves the latest replacement', () => {
    const queue = new RealtimeResponseQueue<string>({ eventId: (id) => id });
    queue.enqueue('request-1');
    queue.enqueue('request-2');
    expect(queue.reject('unrelated-error').handled).toBe(false);
    expect(queue.reject('request-1').next).toBe('request-2');
    expect(queue.reject('request-1').handled).toBe(false);
    queue.markCreated('response-2');
    expect(queue.reject('request-2').handled).toBe(false);
    queue.reset();
  });

  it('ignores duplicate completion before a queued response has been created', () => {
    const queue = new RealtimeResponseQueue<string>();
    queue.enqueue('first');
    queue.markCreated('response-1');
    queue.enqueue('second');
    expect(queue.complete('response-1').next).toBe('second');
    expect(queue.complete('response-1').handled).toBe(false);
    expect(queue.busy).toBe(true);
  });

  it('times out a missing lifecycle and cancels watchdogs on teardown', async () => {
    vi.useFakeTimers();
    const timeout = vi.fn();
    const queue = new RealtimeResponseQueue<string>({ onTimeout: timeout, timeoutMs: 100 });
    queue.enqueue('first');
    await vi.advanceTimersByTimeAsync(100);
    expect(timeout).toHaveBeenCalledOnce();
    expect(queue.busy).toBe(false);
    queue.enqueue('second');
    queue.reset();
    await vi.advanceTimersByTimeAsync(100);
    expect(timeout).toHaveBeenCalledOnce();
  });
  it('sends immediately while idle', () => {
    const queue = new RealtimeResponseQueue<string>();

    expect(queue.enqueue('first')).toBe('first');
    expect(queue.busy).toBe(true);
  });

  it('waits for response.created before cancelling a just-sent response', () => {
    const queue = new RealtimeResponseQueue<string>();
    queue.enqueue('first');

    expect(queue.requestCancellation()).toEqual({
      shouldCancel: false,
      discardedResponseId: null,
    });
    expect(queue.enqueue('replacement')).toBeNull();
    expect(queue.markCreated('response-1')).toEqual({
      shouldCancel: true,
      discardedResponseId: 'response-1',
    });
  });

  it('retains only the latest replacement until the cancelled response is done', () => {
    const queue = new RealtimeResponseQueue<string>();
    queue.enqueue('first');
    queue.markCreated('response-1');
    expect(queue.requestCancellation().shouldCancel).toBe(true);
    expect(queue.enqueue('stale')).toBeNull();
    expect(queue.enqueue('latest')).toBeNull();

    expect(queue.complete('response-1')).toEqual({
      handled: true,
      discarded: true,
      next: 'latest',
    });
    expect(queue.busy).toBe(true);
  });

  it('does not send duplicate cancellation requests', () => {
    const queue = new RealtimeResponseQueue<string>();
    queue.enqueue('first');
    queue.markCreated('response-1');

    expect(queue.requestCancellation().shouldCancel).toBe(true);
    expect(queue.requestCancellation().shouldCancel).toBe(false);
  });

  it('ignores a stale terminal event after the next response becomes active', () => {
    const queue = new RealtimeResponseQueue<string>();
    queue.enqueue('first');
    queue.markCreated('response-1');
    queue.requestCancellation();
    queue.enqueue('second');
    expect(queue.complete('response-1').next).toBe('second');
    queue.markCreated('response-2');

    expect(queue.complete('response-1').handled).toBe(false);
    expect(queue.responseId).toBe('response-2');
  });
});
