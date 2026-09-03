import { describe, expect, it } from 'vitest';

import { GAME_MODES, getEngine, isGameMode } from './registry.ts';

describe('getEngine', () => {
  it.each(GAME_MODES)('resolves %s to an engine with a matching mode', (mode) => {
    const engine = getEngine(mode);
    expect(engine.mode).toBe(mode);
    expect(engine.minPlayers).toBeGreaterThanOrEqual(1);
    expect(engine.maxPlayers).toBeGreaterThanOrEqual(engine.minPlayers);
    expect(typeof engine.parseConfig).toBe('function');
    expect(typeof engine.finalizeConfig).toBe('function');
    expect(typeof engine.deriveState).toBe('function');
  });

  it('throws for an unknown mode', () => {
    expect(() => getEngine('golf' as never)).toThrow('Unknown game mode: golf');
  });
});

describe('isGameMode', () => {
  it('accepts every registered mode', () => {
    for (const mode of GAME_MODES) expect(isGameMode(mode)).toBe(true);
  });

  it.each([undefined, null, 42, '', 'x01', 'Cricket', 'CRICKET', ['cricket'], { mode: 'cricket' }])(
    'rejects %j',
    (value) => {
      expect(isGameMode(value)).toBe(false);
    }
  );
});
