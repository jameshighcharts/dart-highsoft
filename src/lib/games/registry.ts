import { cricketEngine } from './engines/cricket.ts';
import { killerEngine } from './engines/killer.ts';
import { shanghaiEngine } from './engines/shanghai.ts';
import { aroundTheClockEngine } from './engines/aroundTheClock.ts';
import type { GameEngine, GameEvent, GameMode } from './types.ts';

export { isGameMode, GAME_MODES } from './types.ts';

const ENGINES: Record<GameMode, GameEngine<unknown, unknown, GameEvent>> = {
  cricket: cricketEngine as unknown as GameEngine<unknown, unknown, GameEvent>,
  killer: killerEngine as unknown as GameEngine<unknown, unknown, GameEvent>,
  shanghai: shanghaiEngine as unknown as GameEngine<unknown, unknown, GameEvent>,
  around_the_clock: aroundTheClockEngine as unknown as GameEngine<unknown, unknown, GameEvent>,
};

export function getEngine(mode: GameMode): GameEngine<unknown, unknown, GameEvent> {
  const engine = ENGINES[mode];
  if (!engine) throw new Error(`Unknown game mode: ${String(mode)}`);
  return engine;
}
