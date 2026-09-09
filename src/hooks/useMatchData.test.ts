import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockLeg, createMockMatch } from '@/test-utils/factories';
import type { MatchLoadResult } from '@/lib/match/loadMatchData';
import { LiveScoringVersions } from '@/lib/match/liveScoringBroadcast';
import { useMatchData } from './useMatchData';
const { load } = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: async () => ({}) }));
vi.mock('@/lib/match/loadMatchData', () => ({ loadMatchData: load }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const match = createMockMatch({ id: 'm' });
const leg = createMockLeg({ id: 'l', match_id: 'm' });
const dart = { id: 'd', turn_id: 't', dart_index: 1, segment: 'S20', scored: 20, live_revision: '10' };
const turn = { id: 't', leg_id: 'l', player_id: 'p', turn_number: 1, total_scored: 20, busted: false, tiebreak_round: null, throws: [dart] };
const snapshot = (throws: typeof dart[]): MatchLoadResult => ({ match, legs: [leg], players: [],
  turns: [{ ...turn, throws }], turnsByLeg: { l: [{ ...turn, throws }] }, turnThrowCounts: { t: throws.length } } as MatchLoadResult);
const deferred = () => {
  let resolve!: (value: MatchLoadResult) => void;
  const promise = new Promise<MatchLoadResult>(done => { resolve = done; });
  return { promise, resolve };
};

describe('HTTP snapshots racing with live updates', () => {
  it.each(['insert', 'edit', 'delete'])('preserves a live %s when an older snapshot arrives, including rejected WAL echoes', async kind => {
    const first = deferred();
    const retry = deferred();
    load.mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise);
    const { result } = renderHook(() => useMatchData('m'));
    let recovery!: Promise<void>;
    await act(async () => { recovery = result.current.loadAllSpectator(true); });
    const versions = new LiveScoringVersions();
    const current = kind === 'delete' ? [] : [{ ...dart, scored: kind === 'edit' ? 60 : 20, live_revision: '11' }];
    const event = kind === 'delete' ? { eventType: 'DELETE', old: dart }
      : { eventType: 'INSERT', new: current[0] };
    expect(versions.accept('throws', event)).toBe(true);
    await act(async () => {
      result.current.setTurns(snapshot(current).turns);
      result.current.setTurnsByLeg(snapshot(current).turnsByLeg);
      result.current.setTurnThrowCounts({ t: current.length });
      window.dispatchEvent(new CustomEvent(kind === 'insert' ? 'supabase-scoring-commit' : 'supabase-throws-change', {
        detail: kind === 'insert' ? { matchId: 'm', turn, throws: current } : event,
      }));
      first.resolve(snapshot(kind === 'insert' ? [] : [dart]));
    });
    expect(load).toHaveBeenCalledTimes(2);
    expect(result.current.turns).toEqual(snapshot(current).turns);
    expect(result.current.turnThrowCounts.t).toBe(current.length);
    // The echo cannot repair a clobber: it is correctly rejected by the version floor.
    expect(versions.accept('throws', event)).toBe(false);
    await act(async () => { retry.resolve(snapshot(current)); await recovery; });
    expect(result.current.turnsByLeg).toEqual(snapshot(current).turnsByLeg);
  });

  it('accepts authoritative deletions missed while disconnected', async () => {
    const { result } = renderHook(() => useMatchData('m'));
    await act(async () => result.current.setTurns(snapshot([dart]).turns));
    load.mockResolvedValue(snapshot([]));
    await act(async () => result.current.loadAllSpectator(true));
    expect(result.current.turns).toEqual(snapshot([]).turns);
  });

  it('does not apply an old-match snapshot after navigation', async () => {
    const pending = deferred();
    load.mockReturnValue(pending.promise);
    const { result, rerender } = renderHook(id => useMatchData(id), { initialProps: 'm' });
    let loading!: Promise<void>;
    await act(async () => { loading = result.current.loadAllSpectator(); });
    rerender('other');
    await act(async () => { pending.resolve(snapshot([dart])); await loading; });
    expect(result.current.match).toBeNull();
  });
});
