import { aroundTheClockEngine } from './engines/aroundTheClock';
import { cricketEngine } from './engines/cricket';
import { killerEngine } from './engines/killer';
import { shanghaiEngine, shanghaiTargetForRound } from './engines/shanghai';
import type { GameEngine, GameEvent, GameMode, GameThrowInput } from './types';

function replay<C, P, E extends GameEvent>(engine: GameEngine<C, P, E>, rawConfig: unknown, playerIds: string[], throws: GameThrowInput[]) {
  const parsed = engine.parseConfig(rawConfig);
  if (!parsed.ok) throw new Error(parsed.error);
  return { config: parsed.config, state: engine.deriveState(parsed.config, playerIds, throws) };
}

export function deriveGameView(mode: GameMode, config: unknown, playerIds: string[], throws: GameThrowInput[]) {
  switch (mode) {
    case 'cricket': return { mode, ...replay(cricketEngine, config, playerIds, throws) };
    case 'killer': return { mode, ...replay(killerEngine, config, playerIds, throws) };
    case 'shanghai': return { mode, ...replay(shanghaiEngine, config, playerIds, throws) };
    case 'around_the_clock': return { mode, ...replay(aroundTheClockEngine, config, playerIds, throws) };
  }
}

export type GameView = ReturnType<typeof deriveGameView>;

export function gameTurnGuide(view: GameView) {
  const playerId = view.state.currentPlayerId;
  switch (view.mode) {
    case 'cricket':
      return {
        target: '15–20 + Bull',
        label: 'Numbers in play',
        instruction: view.config.variant === 'cut_throat'
          ? 'Close each number with three marks. Extra hits give points to open opponents. Lowest points wins.'
          : 'Close each number with three marks. Extra hits score until everyone closes it. Close all with the most points to win.',
        round: view.config.maxRounds ? `Round ${view.state.round} of ${view.config.maxRounds}` : `Round ${view.state.round}`,
      };
    case 'killer': {
      const player = playerId ? view.state.perPlayer[playerId] : null;
      const prefix = view.config.killerRequirement === 'double' ? 'D' : '';
      const opponents = Object.entries(view.state.perPlayer)
        .filter(([id, opponent]) => id !== playerId && !opponent.eliminated)
        .map(([, opponent]) => `${view.config.hitToKill === 'double' ? 'D' : ''}${opponent.number}`);
      return {
        target: player?.isKiller ? opponents.join(' · ') : player ? `${prefix}${player.number}` : 'Killer',
        label: player?.isKiller ? 'Target an opponent' : 'Become a killer',
        instruction: player?.isKiller
          ? `Hit an opponent's ${view.config.hitToKill === 'double' ? 'double' : 'number'} to take a life.${view.config.selfHitPenalty ? ' Avoid your own number.' : ''}`
          : `Hit your own ${view.config.killerRequirement === 'double' ? 'double' : 'number'} to become a killer. Last player standing wins.`,
        round: `Round ${view.state.round}`,
      };
    }
    case 'shanghai': {
      const target = shanghaiTargetForRound(view.config, view.state.round);
      return {
        target: String(target),
        label: 'Target this round',
        instruction: `Only ${target}s score. Hit S${target}, D${target} and T${target} in one turn to win with a Shanghai.`,
        round: view.state.round > view.config.rounds ? `Sudden death · Round ${view.state.round}` : `Round ${view.state.round} of ${view.config.rounds}`,
      };
    }
    case 'around_the_clock': {
      const player = playerId ? view.state.perPlayer[playerId] : null;
      const bull = player?.target === 25;
      return {
        target: bull ? (view.config.bullRequirement === 'double' ? 'DB' : 'Bull') : String(player?.target ?? 1),
        label: 'Next target',
        instruction: `${bull ? (view.config.bullRequirement === 'double' ? 'Hit the inner bull to finish.' : 'Hit either bull to finish.') : 'Hit your target to advance.'} ${view.config.skipOnDoubleTreble ? 'Doubles advance two steps, trebles three.' : 'Each hit advances one step.'}${view.config.fairFinish ? ' Everyone finishes the round; fewest darts wins.' : ''}`,
        round: `Round ${view.state.round}`,
      };
    }
  }
}
