import { describe, expect, it } from 'vitest';
import { shareStructurally } from './shareStructurally';

const leaderboard = () => ({
  leaders: [{ player_id: 'a', wins: 3 }, { player_id: 'b', wins: 1 }],
  byPlayer: new Map([['a', [1, 0, 1]], ['b', [0]]]),
  ids: new Set(['a', 'b']),
  at: new Date('2026-10-12T10:00:00Z'),
});

describe('shareStructurally', () => {
  it('returns the previous result when a refetch brings equal data, Maps included', () => {
    const prev = leaderboard();
    expect(shareStructurally(prev, leaderboard())).toBe(prev);
  });

  it('keeps unchanged parts and replaces only what changed', () => {
    const prev = leaderboard();
    const next = leaderboard();
    next.byPlayer.set('b', [0, 1]);
    const shared = shareStructurally(prev, next);
    expect(shared).not.toBe(prev);
    expect(shared).toEqual(next);
    expect(shared.leaders).toBe(prev.leaders);
    expect(shared.byPlayer).not.toBe(prev.byPlayer);
    expect(shared.byPlayer.get('a')).toBe(prev.byPlayer.get('a'));
    expect(shared.byPlayer.get('b')).toEqual([0, 1]);
    expect(shared.ids).toBe(prev.ids);
    expect(shared.at).toBe(prev.at);
  });

  it('notices added, removed and reordered entries', () => {
    const prev = leaderboard();
    const added = leaderboard();
    added.byPlayer.set('c', []);
    expect(shareStructurally(prev, added).byPlayer).not.toBe(prev.byPlayer);
    const removed = leaderboard();
    removed.byPlayer.delete('b');
    expect(shareStructurally(prev, removed).byPlayer.has('b')).toBe(false);
    const reordered = leaderboard();
    reordered.leaders.reverse();
    expect(shareStructurally(prev, reordered).leaders.map((row) => row.player_id)).toEqual(['b', 'a']);
  });

  it('replaces values of different shapes', () => {
    expect(shareStructurally({ a: 1 }, [1])).toEqual([1]);
    expect(shareStructurally(new Map(), { a: 1 })).toEqual({ a: 1 });
    expect(shareStructurally(undefined, leaderboard())).toEqual(leaderboard());
  });
});
