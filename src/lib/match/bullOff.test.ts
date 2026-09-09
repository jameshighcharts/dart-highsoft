import { describe, expect, it } from 'vitest';
import { createBullOff, finishBullOffTakeout, formatBullDistance, recordBullOffShot, type BullOffState } from './bullOff';
const dart = (state: BullOffState, distanceMm: number | null) => finishBullOffTakeout(recordBullOffShot(state, { playerId: state.pending[0], distanceMm }));
describe('bull-off', () => {
  it('uses one dart each and waits for removal before advancing or starting X01', () => {
    let state = createBullOff(['a', 'b']);
    state = recordBullOffShot(state, { playerId: 'a', distanceMm: 152.4 });
    expect(state.pending[0]).toBe('a');
    expect(() => recordBullOffShot(state, { playerId: 'b', distanceMm: 5 })).toThrow();
    state = finishBullOffTakeout(state);
    state = recordBullOffShot(state, { playerId: 'b', distanceMm: 5 });
    expect(state.phase).toBe('throwing');
    state = finishBullOffTakeout(state);
    expect(state.phase).toBe('complete');
    expect(state.order).toEqual(['b', 'a']);
    expect(formatBullDistance(152.4)).toBe('6.00″');
  });
  it('rethrows tied positions independently without displacing locked places', () => {
    let state = createBullOff(['a', 'b', 'c', 'd', 'e']);
    for (const distance of [10, 10, 20, 30, 30]) state = dart(state, distance);
    expect(state.pending).toEqual(['a', 'b', 'd', 'e']);
    expect(state.round).toBe(2);
    for (const distance of [100, 100, 0, 1]) state = dart(state, distance);
    expect(state.pending).toEqual(['a', 'b']);
    expect(state.round).toBe(3);
    state = dart(dart(state, 9), 2);
    expect(state.phase).toBe('complete');
    expect(state.order).toEqual(['b', 'a', 'c', 'd', 'e']);
  });
  it('ranks misses last, rethrows tied misses and distinguishes measured zero', () => {
    let state = createBullOff(['a', 'b', 'c']);
    state = dart(dart(dart(state, null), 0), null);
    expect(state.pending).toEqual(['a', 'c']);
    state = dart(dart(state, null), 250);
    expect(state.order).toEqual(['b', 'c', 'a']);
    expect(state.shots[1].distanceMm).toBe(0);
  });
  it('rejects out-of-turn and invalid readings and ties at measurement precision', () => {
    const state = createBullOff(['a', 'b']);
    for (const distanceMm of [-1, NaN, Infinity, 1001]) expect(() => recordBullOffShot(state, { playerId: 'a', distanceMm })).toThrow();
    expect(() => recordBullOffShot(state, { playerId: 'b', distanceMm: 1 })).toThrow();
    expect(dart(dart(state, 1.01), 1.04).pending).toEqual(['a', 'b']);
    expect(state.shots).toEqual([]);
  });
});

it('moves measured players into provisional order immediately while pending players stay behind them', async () => {
  const { liveBullOffOrder } = await import('./bullOff');
  let state = createBullOff(['a', 'b', 'c']);
  state = recordBullOffShot(state, { playerId: 'a', distanceMm: 150 });
  state = recordBullOffShot(finishBullOffTakeout(state), { playerId: 'b', distanceMm: 20 });
  expect(liveBullOffOrder(state)).toEqual(['b', 'a', 'c']);
  expect(state.pending[0]).toBe('b');
});
