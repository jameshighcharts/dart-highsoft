import { describe, expect, it } from 'vitest';
import { LiveScoringVersions, isLiveScoringBroadcast } from './liveScoringBroadcast';
const change = (live_revision: string, eventType = 'UPDATE') => ({ eventType,
  [eventType === 'DELETE' ? 'old' : 'new']: { id: 'dart', live_revision } });
describe('live scoring revision ordering', () => {
  it('deduplicates WAL echoes while accepting edits to the same dart and rejecting delayed old broadcasts', () => {
    const versions = new LiveScoringVersions();
    expect(versions.accept('throws', change('10', 'INSERT'))).toBe(true);
    expect(versions.accept('throws', change('10', 'INSERT'))).toBe(false);
    expect(versions.accept('throws', change('12'))).toBe(true);
    expect(versions.accept('throws', change('10', 'INSERT'))).toBe(false);
    expect(versions.accept('throws', change('12', 'DELETE'))).toBe(true);
    expect(versions.accept('throws', change('12', 'INSERT'))).toBe(false);
    expect(versions.accept('throws', change('12', 'DELETE'))).toBe(false);
  });
  it('respects newer HTTP snapshots and retains an unversioned delete tombstone', () => {
    const versions = new LiveScoringVersions();
    expect(versions.accept('throws', change('10'), { live_revision: '15' })).toBe(false);
    expect(versions.accept('throws', { eventType: 'DELETE', old: { id: 'dart' } })).toBe(true);
    expect(versions.accept('throws', change('20', 'INSERT'))).toBe(false);
  });
  it('rejects cross-match, malformed and unversioned broadcasts', () => {
    expect(isLiveScoringBroadcast(null, 'match')).toBe(false);
    expect(isLiveScoringBroadcast({ matchId: 'other' }, 'match')).toBe(false);
    expect(isLiveScoringBroadcast({ matchId: 'match', turn: {}, throws: [] }, 'match')).toBe(false);
  });
});
