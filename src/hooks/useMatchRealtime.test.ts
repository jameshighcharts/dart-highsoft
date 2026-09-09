import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PendingThrowBuffer } from '@/lib/match/realtime';
import { createMockLeg, createMockMatch } from '@/test-utils/factories';
import type { TurnWithThrows } from '@/lib/match/types';
import { useMatchRealtime } from './useMatchRealtime';

const getClient = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: getClient }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function setup(connected = true) {
  let resolve!: (result: { data: TurnWithThrows[]; error: null }) => void;
  const response = new Promise<{ data: TurnWithThrows[]; error: null }>((done) => { resolve = done; });
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnValue(response) };
  getClient.mockResolvedValue({ from: vi.fn().mockReturnValue(query) });
  const leg = createMockLeg({ id: 'leg', match_id: 'match', winner_player_id: null });
  const args: Parameters<typeof useMatchRealtime>[0] = {
    matchId: 'match', realtime: { isConnected: connected, connectionStatus: connected ? 'connected' : 'error', updatePresence: vi.fn() },
    realtimeEnabled: true, isSpectatorMode: true,
    loadAll: vi.fn(), loadAllSpectator: vi.fn(), loadMatchOnly: vi.fn(), loadLegsOnly: vi.fn(), loadPlayersOnly: vi.fn(), loadTurnsForLeg: vi.fn(),
    latestStateRef: { current: { isSpectatorMode: true, playerById: {}, turnThrowCounts: {}, turns: [], turnsByLeg: {}, legs: [leg], players: [],
      match: { ...createMockMatch({ id: 'match' }), scolia_board_id: 'board' }, knownLegIds: new Set(['leg']), knownTurnIds: new Set() } },
    pendingThrowBufferRef: { current: new PendingThrowBuffer() }, pendingTurnReconcileRef: { current: new Set() },
    setTurns: vi.fn(), setTurnsByLeg: vi.fn(), setTurnThrowCounts: vi.fn(), setMatch: vi.fn(),
    ongoingTurnRef: { current: null }, setLocalTurn: vi.fn(), setCelebration: vi.fn(), celebratedTurns: { current: new Set() },
    commentaryEnabled: false, personaId: 'chad', setCommentaryLoading: vi.fn(), setCommentaryPlaying: vi.fn(), setCurrentCommentary: vi.fn(), recordCompletedCommentary: vi.fn(),
    ttsServiceRef: { current: { getSettings: () => ({ enabled: false, voice: 'alloy' }), queueCommentary: vi.fn(), getIsPlaying: () => false, skipCurrent: vi.fn(), clearQueue: vi.fn() } },
    realtimeCommentaryRef: { current: null }, dartIQEvidenceByPlayerId: new Map(), dartIQModelsByPlayerId: new Map(),
  };
  const hook = renderHook(() => useMatchRealtime(args));
  return { args, query, resolve, ...hook };
}

const first = { id: 'd1', turn_id: 'turn', dart_index: 1, segment: 'S20', scored: 20, impact_x_mm: 0, impact_y_mm: 130 };
const turn: TurnWithThrows = { id: 'turn', leg_id: 'leg', player_id: 'a', turn_number: 1, total_scored: 0, busted: false, tiebreak_round: null, throws: [first] };
async function emit(payload: object) {
  await act(async () => { window.dispatchEvent(new CustomEvent('supabase-throws-change', { detail: payload })); });
}

describe('spectator immediate turn recovery', () => {
  it('starts immediately, coalesces concurrent darts, and retains geometry and in-flight corrections', async () => {
    const test = setup();
    await emit({ eventType: 'INSERT', new: first });
    expect(test.query.limit).toHaveBeenCalledTimes(1); // No timer advancement or 200ms delay.
    expect(test.query.eq).toHaveBeenCalledWith('match_id', 'match');
    expect(test.query.select.mock.calls[0][0]).toContain('impact_x_mm');
    await emit({ eventType: 'INSERT', new: { ...first, id: 'd2', dart_index: 2 } });
    await emit({ eventType: 'UPDATE', new: { ...first, impact_x_mm: 5 } });
    expect(test.query.limit).toHaveBeenCalledTimes(1);
    await act(async () => { test.resolve({ data: [turn], error: null }); });
    const darts = (test.args.latestStateRef.current.turns[0] as TurnWithThrows).throws!;
    expect(darts.map((dart) => dart.id)).toEqual(['d1', 'd2']);
    expect(darts[0].impact_x_mm).toBe(5);
    await emit({ eventType: 'UPDATE', new: { ...first, impact_x_mm: null, impact_y_mm: null } });
    expect((test.args.latestStateRef.current.turns[0] as TurnWithThrows).throws![0].impact_x_mm).toBeNull();
    expect(test.query.limit).toHaveBeenCalledTimes(1);
  });

  it('ignores another match and does not publish a recovery response after unmount', async () => {
    const test = setup();
    await emit({ eventType: 'INSERT', new: { ...first, match_id: 'other' } });
    expect(test.query.limit).not.toHaveBeenCalled();
    await emit({ eventType: 'INSERT', new: first });
    test.unmount();
    await act(async () => { test.resolve({ data: [turn], error: null }); });
    expect(test.args.setTurns).not.toHaveBeenCalled();
  });
});

describe('payload-first scoring and direct broadcasts', () => {
  it('applies scoring-view darts immediately without a debounce or leg query, preserving optimistic darts', async () => {
    const test = setup();
    const state = test.args.latestStateRef.current;
    state.isSpectatorMode = false;
    const emptyTurn: TurnWithThrows = { ...turn, throws: [] };
    state.turns = [emptyTurn];
    state.knownTurnIds.add('turn');
    const optimistic = { turnId: 'turn', playerId: 'a', startScore: 301,
      darts: [{ scored: 20, label: 'S20', kind: 'Single' as const }, { scored: 60, label: 'T20', kind: 'Triple' as const }] };
    test.args.ongoingTurnRef.current = optimistic;
    await emit({ eventType: 'INSERT', new: { ...first, live_revision: '10' } });
    expect((test.args.latestStateRef.current.turns[0] as TurnWithThrows).throws).toHaveLength(1);
    expect(test.args.ongoingTurnRef.current).toBe(optimistic);
    expect(getClient).not.toHaveBeenCalled();
    await act(async () => window.dispatchEvent(new CustomEvent('supabase-turns-change', {
      detail: { eventType: 'UPDATE', new: { ...turn, throws: undefined, busted: true, live_revision: '11' } },
    })));
    expect(test.args.ongoingTurnRef.current).toBeNull();
    expect(test.args.latestStateRef.current.turns[0].busted).toBe(true);
    expect(getClient).not.toHaveBeenCalled();
  });

  it.each([[true, true], [true, false], [false, true], [false, false]])('broadcasts a first dart and rejects stale edits/undo echoes (spectator %s, connected %s)', async (spectator, connected) => {
    const test = setup(connected);
    test.args.latestStateRef.current.isSpectatorMode = spectator;
    const packet = { matchId: 'match', turn: { ...turn, throws: undefined, live_revision: '10' },
      throws: [{ ...first, live_revision: '11' }] };
    const broadcast = async () => act(async () => {
      window.dispatchEvent(new CustomEvent('supabase-scoring-commit', { detail: packet }));
    });
    await broadcast();
    expect((test.args.latestStateRef.current.turns[0] as TurnWithThrows).throws).toHaveLength(1);
    expect(getClient).not.toHaveBeenCalled();
    await emit({ eventType: 'UPDATE', new: { ...first, segment: 'T20', scored: 60, live_revision: '12' } });
    await broadcast();
    expect((test.args.latestStateRef.current.turns[0] as TurnWithThrows).throws[0].scored).toBe(60);
    await emit({ eventType: 'DELETE', new: {}, old: { ...first, live_revision: '12' } });
    await broadcast();
    expect((test.args.latestStateRef.current.turns[0] as TurnWithThrows).throws).toHaveLength(0);
  });
});
