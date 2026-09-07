import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { DartIQLiveProcessor, type DartIQLiveInput, type DartIQLiveRequest, type DartIQLiveResponse } from './liveWorker';
import { DartIQTracker } from './tracker';
import { createAdaptiveDartIQModel } from './model/training';
import { useDartIQWorker, computeDartIQCommentary } from '@/hooks/useDartIQWorker';

const input: DartIQLiveInput = {
  playerIds: ['a', 'b'], startScore: 301, finishRule: 'double_out', legsToWin: 1,
  legs: [{ id: 'leg', match_id: 'match', leg_number: 1, starting_player_id: 'a', winner_player_id: null }],
  turnsByLeg: {},
};
const evidence = { playerProfiles: [], playerOutcomes: [], populationOutcomes: [] };
const snapshot = new DartIQLiveProcessor().update({ id: 1, input, evidence });
class MockWorker {
  static instances: MockWorker[] = [];
  onmessage?: (event: { data: DartIQLiveResponse }) => void;
  onerror?: () => void;
  postMessage = vi.fn<(request: DartIQLiveRequest) => void>();
  terminate = vi.fn();
  constructor() { MockWorker.instances.push(this); }
  reply(id: number, result: DartIQLiveResponse['snapshot'] = snapshot) { act(() => this.onmessage?.({ data: { id, snapshot: result } })); }
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); MockWorker.instances = []; });

describe('worker-owned DartIQ', () => {
  it('matches canonical replay for appends, edits, undo, new players, and serializable responses', () => {
    const processor = new DartIQLiveProcessor();
    const first = processor.update({ id: 1, input, evidence });
    expect(structuredClone(first)).toEqual(first);
    const turn = { id: 'turn', leg_id: 'leg', player_id: 'a', turn_number: 1, total_scored: 20, busted: false, tiebreak_round: null,
      throws: [{ id: 'dart', turn_id: 'turn', dart_index: 1, segment: 'S20', scored: 20 }] };
    const appended = { ...input, turnsByLeg: { leg: [turn] } };
    const edited = { ...input, turnsByLeg: { leg: [{ ...turn, total_scored: 5, throws: [{ ...turn.throws[0], segment: 'S5', scored: 5 }] }] } };
    for (const next of [appended, edited, input, { ...input, playerIds: ['a', 'b', 'c'] }]) {
      const actual = processor.update({ id: 2, input: structuredClone(next) });
      const expected = new DartIQTracker().update({ ...next, playerProfiles: {}, outcomeModels: Object.fromEntries(next.playerIds.map((playerId) => [playerId, createAdaptiveDartIQModel({ playerId, population: [] })])) });
      expect(actual).toEqual(expected);
      expect(structuredClone(actual)).toEqual(actual);
    }
    expect(() => new DartIQLiveProcessor().update({ id: 0, input })).toThrow('initial evidence');
  });

  it('coalesces bursts, rejects obsolete and duplicate replies, and resends changed evidence', () => {
    vi.stubGlobal('Worker', MockWorker);
    const hook = renderHook(({ state, facts }) => useDartIQWorker(state, facts), { initialProps: { state: input, facts: evidence } });
    const worker = MockWorker.instances[0];
    hook.rerender({ state: { ...input, startScore: 501 }, facts: evidence });
    const newest = { ...input, startScore: 701 };
    hook.rerender({ state: newest, facts: evidence });
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    worker.reply(99);
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    worker.reply(1);
    expect(hook.result.current).toBeNull();
    expect(worker.postMessage).toHaveBeenLastCalledWith({ id: 3, input: newest });
    worker.reply(1);
    expect(hook.result.current).toBeNull();
    worker.reply(3);
    expect(hook.result.current).toEqual(snapshot);
    const changed = { ...evidence };
    hook.rerender({ state: newest, facts: changed });
    expect(hook.result.current).toBeNull();
    expect(worker.postMessage).toHaveBeenLastCalledWith({ id: 4, input: newest, evidence: changed });
  });

  it('restarts once on failure with full evidence, then fails closed', () => {
    vi.stubGlobal('Worker', MockWorker);
    const hook = renderHook(() => useDartIQWorker(input, evidence));
    const first = MockWorker.instances[0];
    first.reply(1, null);
    expect(first.terminate).toHaveBeenCalledOnce();
    const replacement = MockWorker.instances[1];
    expect(replacement.postMessage).toHaveBeenCalledWith({ id: 1, input, evidence });
    first.reply(1);
    expect(hook.result.current).toBeNull();
    replacement.reply(1, null);
    expect(MockWorker.instances).toHaveLength(2);
    expect(hook.result.current).toBeNull();
  });

  it('bounds hung work and cleans up timers on unmount', () => {
    vi.useFakeTimers(); vi.stubGlobal('Worker', MockWorker);
    const hook = renderHook(() => useDartIQWorker(input, evidence));
    act(() => vi.advanceTimersByTime(30_000));
    expect(MockWorker.instances).toHaveLength(2);
    hook.unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(MockWorker.instances[1].terminate).toHaveBeenCalledOnce();
  });

  it('survives StrictMode remount and unsupported Worker without main-thread replay', () => {
    vi.stubGlobal('Worker', MockWorker);
    const update = vi.spyOn(DartIQTracker.prototype, 'update');
    const hook = renderHook(() => useDartIQWorker(input, evidence), { reactStrictMode: true });
    expect(MockWorker.instances).toHaveLength(2);
    expect(MockWorker.instances[0].terminate).toHaveBeenCalledOnce();
    MockWorker.instances[0].reply(1);
    expect(hook.result.current).toBeNull();
    MockWorker.instances[1].reply(1);
    expect(hook.result.current).toEqual(snapshot);
    hook.unmount();
    vi.stubGlobal('Worker', undefined);
    expect(renderHook(() => useDartIQWorker(input, evidence)).result.current).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it('bounds fallback commentary and terminates its worker', async () => {
    vi.useFakeTimers(); vi.stubGlobal('Worker', MockWorker);
    const pending = computeDartIQCommentary(input, evidence, 'turn', 'a');
    act(() => vi.advanceTimersByTime(10_000));
    expect(await pending).toBeUndefined();
    expect(MockWorker.instances[0].terminate).toHaveBeenCalledOnce();
  });
});
