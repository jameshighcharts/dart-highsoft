import { describe, expect, it } from 'vitest';

import { getManualScoringPrompt } from './manualScoringPrompt';
import type { ScoliaBoardOption } from './types';

function board(overrides: Partial<ScoliaBoardOption> = {}): ScoliaBoardOption {
  return {
    id: 'b1',
    name: 'Scolia Bergen',
    isHomeSbc: true,
    workerConnectionStatus: 'connected',
    boardStatus: 'Ready',
    workerHeartbeatAt: new Date().toISOString(),
    activeMatchId: null,
    activeGameSessionId: null,
    selectable: true,
    ...overrides,
  };
}

describe('getManualScoringPrompt', () => {
  it('returns null when no board is online', () => {
    expect(getManualScoringPrompt([])).toBeNull();
    expect(
      getManualScoringPrompt([board({ workerConnectionStatus: 'disconnected', selectable: false })])
    ).toBeNull();
  });

  it('offers ready boards as an alternative to manual scoring', () => {
    const ready = board();
    const prompt = getManualScoringPrompt([ready]);
    expect(prompt?.readyBoards).toEqual([ready]);
    expect(prompt?.busyBoards).toEqual([]);
  });

  it('reports online boards that already have a match or game running', () => {
    const inMatch = board({ id: 'b1', activeMatchId: 'm1', selectable: false });
    const inGame = board({ id: 'b2', name: 'Scolia Vik', activeGameSessionId: 'g1', selectable: false });
    const prompt = getManualScoringPrompt([inMatch, inGame]);
    expect(prompt?.readyBoards).toEqual([]);
    expect(prompt?.busyBoards).toEqual([inMatch, inGame]);
  });

  it('ignores offline boards even when they have a stale active match', () => {
    const offline = board({ workerConnectionStatus: 'disconnected', activeMatchId: 'm1', selectable: false });
    const ready = board({ id: 'b2', name: 'Scolia Vik' });
    const prompt = getManualScoringPrompt([offline, ready]);
    expect(prompt?.readyBoards).toEqual([ready]);
    expect(prompt?.busyBoards).toEqual([]);
  });
});
