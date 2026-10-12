import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createFrameQueue } from './frameQueue';

let clock = 0;
const nextFrame = () => vi.advanceTimersByTimeAsync(20);

beforeEach(() => {
  clock = 0;
  vi.useFakeTimers();
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 16));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('runs queued tasks only after the next frame', async () => {
  const queue = createFrameQueue();
  const task = vi.fn();
  queue.add(task);
  expect(task).not.toHaveBeenCalled();
  await nextFrame();
  expect(task).toHaveBeenCalledTimes(1);
});

it('stops a slice once the budget is spent and continues in the next frame', async () => {
  const queue = createFrameQueue(8);
  const ran: number[] = [];
  for (let i = 0; i < 5; i += 1) queue.add(() => { ran.push(i); clock += 5; });
  await nextFrame();
  expect(ran).toEqual([0, 1]);
  await nextFrame();
  await nextFrame();
  expect(ran).toEqual([0, 1, 2, 3, 4]);
});

it('never runs a cancelled task, and one failing task does not stop the rest', async () => {
  const queue = createFrameQueue();
  const cancelled = vi.fn();
  const after = vi.fn();
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  queue.add(() => { throw new Error('boom'); });
  const cancel = queue.add(cancelled);
  queue.add(after);
  cancel();
  await nextFrame();
  expect(cancelled).not.toHaveBeenCalled();
  expect(after).toHaveBeenCalledTimes(1);
  expect(error).toHaveBeenCalled();
});
