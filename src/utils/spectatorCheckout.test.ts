import { describe, expect, it } from 'vitest';
import type { TurnRecord, TurnWithThrows } from '@/lib/match/types';
import { describeSegment, getSpectatorCheckout } from './spectatorCheckout';

const base = { currentLegId: 'leg', startScore: 501, finishRule: 'double_out' as const, playerId: 'p1' };
const turn = (id: string, total: number, extra: Partial<TurnWithThrows> = {}): TurnRecord => ({
  id, leg_id: 'leg', player_id: 'p1', turn_number: 1, total_scored: total, busted: false, tiebreak_round: null, ...extra,
});

describe('getSpectatorCheckout', () => {
  it('returns a three-dart route at the start of a visit', () => {
    const result = getSpectatorCheckout({ ...base, turns: [turn('t1', 180), turn('t2', 180)], turnThrowCounts: { t1: 3, t2: 3 } });
    expect(result).toMatchObject({ kind: 'checkout', score: 141, dartsLeft: 3 });
    expect(result?.kind === 'checkout' && result.routes[0]).toHaveLength(3);
  });

  it('recomputes the route for the darts left mid-visit', () => {
    const inProgress = turn('t2', 0, { throws: [{ id: 'd1', turn_id: 't2', dart_index: 1, segment: 'T20', scored: 60 }] } as Partial<TurnWithThrows>);
    const result = getSpectatorCheckout({ ...base, startScore: 160, turns: [inProgress], turnThrowCounts: { t2: 1 } });
    expect(result).toMatchObject({ kind: 'checkout', score: 100, dartsLeft: 2, routes: [['T20', 'D20']] });
  });

  it('ignores turns from previous legs when counting darts left', () => {
    const oldLegCheckout = turn('old', 40, { leg_id: 'prev' });
    const result = getSpectatorCheckout({ ...base, startScore: 40, turns: [oldLegCheckout], turnThrowCounts: { old: 1 } });
    expect(result).toMatchObject({ kind: 'checkout', score: 40, dartsLeft: 3 });
  });

  it('suggests a setup when no finish is reachable', () => {
    const result = getSpectatorCheckout({ ...base, startScore: 57, turns: [turn('t1', 0, { throws: [] } as Partial<TurnWithThrows>)], turnThrowCounts: { t1: 2 } });
    expect(result).toMatchObject({ kind: 'setup', score: 57, dartsLeft: 1, target: 32, path: ['SB'] });
  });

  it('flags bogey numbers and stays quiet on big scores', () => {
    expect(getSpectatorCheckout({ ...base, startScore: 169, turns: [], turnThrowCounts: {} })).toMatchObject({ kind: 'none', score: 169 });
    expect(getSpectatorCheckout({ ...base, turns: [], turnThrowCounts: {} })).toBeNull();
  });
});

describe('describeSegment', () => {
  it('splits labels for display', () => {
    expect(describeSegment('T20')).toEqual({ kind: 'triple', prefix: 'T', value: '20' });
    expect(describeSegment('D16')).toEqual({ kind: 'double', prefix: 'D', value: '16' });
    expect(describeSegment('S5')).toEqual({ kind: 'single', prefix: '', value: '5' });
    expect(describeSegment('DB')).toEqual({ kind: 'bull', prefix: '', value: 'BULL' });
    expect(describeSegment('SB')).toEqual({ kind: 'outer-bull', prefix: '', value: '25' });
  });
});
