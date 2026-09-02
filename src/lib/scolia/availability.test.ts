import { describe, expect, it } from 'vitest';

import { hasFreshScoliaHeartbeat, isScoliaBoardReady } from './availability';

const now = Date.parse('2026-09-01T12:00:00.000Z');

describe('isScoliaBoardReady', () => {
  it('accepts a ready board with a live worker heartbeat', () => {
    expect(
      isScoliaBoardReady(
        {
          workerConnectionStatus: 'connected',
          boardStatus: 'Ready',
          workerHeartbeatAt: '2026-09-01T11:59:30.000Z',
        },
        now
      )
    ).toBe(true);
  });

  it.each([
    ['disconnected worker', 'disconnected', 'Ready', '2026-09-01T11:59:30.000Z'],
    ['non-ready board', 'connected', 'Calibrating', '2026-09-01T11:59:30.000Z'],
    ['stale heartbeat', 'connected', 'Ready', '2026-09-01T11:59:00.000Z'],
    ['missing heartbeat', 'connected', 'Ready', null],
  ])('rejects a board with a %s', (_, workerConnectionStatus, boardStatus, workerHeartbeatAt) => {
    expect(isScoliaBoardReady({ workerConnectionStatus, boardStatus, workerHeartbeatAt }, now)).toBe(false);
  });
});

describe('hasFreshScoliaHeartbeat', () => {
  it('rejects invalid heartbeat timestamps', () => {
    expect(hasFreshScoliaHeartbeat({ workerHeartbeatAt: 'not-a-date' }, now)).toBe(false);
  });
});
