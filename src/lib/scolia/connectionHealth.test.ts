import { describe, expect, it } from 'vitest';

import { describeScoliaConnection, formatElapsed, isChannelLive } from './connectionHealth';

const now = Date.parse('2026-10-12T12:00:00Z');
const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString();
const ready = {
  workerConnectionStatus: 'connected' as const, workerHeartbeatAt: ago(5), boardStatus: 'Ready', boardPhase: 'Throw',
};

describe('describeScoliaConnection', () => {
  it('headlines the phase: only the Throw phase is ready for darts', () => {
    expect(describeScoliaConnection(ready, { now })).toMatchObject({ tone: 'ready', label: 'Ready for darts' });
    expect(describeScoliaConnection({ ...ready, boardPhase: 'Takeout', boardPhaseChangedAt: ago(3) }, { now }))
      .toMatchObject({ tone: 'degraded', label: 'Removing darts', since: ago(3) });
    expect(describeScoliaConnection({ ...ready, boardPhase: null }, { now })).toMatchObject({ tone: 'ready', label: 'Board ready' });
  });

  it('flags a takeout that never finishes, since the board is blind to darts', () => {
    expect(describeScoliaConnection({ ...ready, boardPhase: 'Takeout', boardPhaseChangedAt: ago(15) }, { now }))
      .toMatchObject({ tone: 'down', label: 'Stuck in takeout', since: ago(15) });
  });

  it('puts the viewer’s own connection first, since everything else may be stale', () => {
    expect(describeScoliaConnection(ready, { now, online: false })).toMatchObject({ tone: 'degraded', label: 'You are offline' });
    expect(describeScoliaConnection(ready, { now, live: false })).toMatchObject({ tone: 'degraded', label: 'Live updates paused' });
  });

  it('calls a stale heartbeat a dead worker, whatever status it last wrote', () => {
    expect(describeScoliaConnection({ ...ready, workerHeartbeatAt: ago(60) }, { now }))
      .toMatchObject({ tone: 'down', label: 'Scolia worker offline', since: ago(60) });
  });

  it('distinguishes reconnecting from disconnected, with when it started', () => {
    expect(describeScoliaConnection({ ...ready, workerConnectionStatus: 'reconnecting', workerConnectionChangedAt: ago(30) }, { now }))
      .toMatchObject({ tone: 'degraded', label: 'Reconnecting to Scolia', since: ago(30) });
    expect(describeScoliaConnection({ ...ready, workerConnectionStatus: 'disconnected' }, { now }))
      .toMatchObject({ tone: 'down', label: 'Scolia disconnected' });
  });

  it('explains a connected board that cannot detect darts', () => {
    expect(describeScoliaConnection({ ...ready, boardStatus: 'Offline' }, { now })).toMatchObject({ tone: 'down', label: 'Board offline' });
    expect(describeScoliaConnection({ ...ready, boardStatus: 'Error', errorType: 'Camera' }, { now }))
      .toMatchObject({ tone: 'down', label: 'Board error', detail: 'Camera error' });
    expect(describeScoliaConnection({ ...ready, boardStatus: 'Calibrating' }, { now }))
      .toMatchObject({ tone: 'degraded', label: 'Board calibrating' });
    expect(describeScoliaConnection(null, { now })).toMatchObject({ tone: 'down', label: 'Board unavailable' });
  });
});

describe('formatElapsed', () => {
  it('formats seconds, minutes and hours', () => {
    expect(formatElapsed(ago(42), now)).toBe('42s');
    expect(formatElapsed(ago(185), now)).toBe('3m');
    expect(formatElapsed(ago(3900), now)).toBe('1h 5m');
    expect(formatElapsed(null, now)).toBeNull();
  });
});

describe('isChannelLive', () => {
  it('treats only a subscribed (or not yet reported) channel as live', () => {
    expect(isChannelLive(undefined)).toBe(true);
    expect(isChannelLive('SUBSCRIBED')).toBe(true);
    expect(isChannelLive('CHANNEL_ERROR')).toBe(false);
  });
});
