import { describe, expect, it } from 'vitest';

import { expireStaleBoards, mergeBoardStatus } from './boardOptions';
import type { ScoliaBoardOption, ScoliaBoardPublicStatus } from './types';

const now = Date.parse('2026-10-12T12:00:00Z');
const fresh = new Date(now - 5_000).toISOString();

function status(overrides: Partial<ScoliaBoardPublicStatus> = {}): ScoliaBoardPublicStatus {
  return {
    boardId: 'b1', name: 'Bergen', isHomeSbc: false, workerConnectionStatus: 'connected',
    boardStatus: 'Ready', boardPhase: 'Throw', boardPhaseChangedAt: null, errorType: null,
    lastEventAt: null, workerHeartbeatAt: new Date().toISOString(), ...overrides,
  };
}

function option(overrides: Partial<ScoliaBoardOption> = {}): ScoliaBoardOption {
  return {
    id: 'b1', name: 'Bergen', isHomeSbc: false, workerConnectionStatus: 'connected', boardStatus: 'Ready',
    workerHeartbeatAt: fresh, activeMatchId: null, activeGameSessionId: null, activeGame: null, selectable: true,
    ...overrides,
  };
}

describe('mergeBoardStatus', () => {
  it('updates a board in place and keeps the occupancy only the API knows', () => {
    const merged = mergeBoardStatus([option({ activeMatchId: 'm1', selectable: false }), option({ id: 'b0', name: 'Askøy' })],
      status({ boardStatus: 'Calibrating' }));
    expect(merged.map((board) => board.name)).toEqual(['Askøy', 'Bergen']);
    expect(merged[1]).toMatchObject({ boardStatus: 'Calibrating', activeMatchId: 'm1', selectable: false });
  });

  it('treats a stale heartbeat as disconnected', () => {
    const [board] = mergeBoardStatus([], status({ workerHeartbeatAt: '2020-01-01T00:00:00Z' }));
    expect(board).toMatchObject({ workerConnectionStatus: 'disconnected', selectable: false });
  });
});

describe('expireStaleBoards', () => {
  it('returns the same list while every heartbeat is fresh', () => {
    const boards = [option()];
    expect(expireStaleBoards(boards, now)).toBe(boards);
  });

  it('disconnects a board whose worker stopped reporting', () => {
    const [board] = expireStaleBoards([option({ workerHeartbeatAt: new Date(now - 60_000).toISOString() })], now);
    expect(board).toMatchObject({ workerConnectionStatus: 'disconnected', selectable: false });
  });
});
