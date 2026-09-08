'use client';

import { Check } from 'lucide-react';

import { clockSequence } from '@/lib/games/engines/aroundTheClock';
import type { AroundTheClockConfig, AroundTheClockEvent, AroundTheClockPlayerState, GameState } from '@/lib/games/types';
import type { GamePlayerData } from '@/hooks/useGameData';
import { GamePlayerCard, type PlayerVisitProps } from './GamePlayerCard';
import { cn } from '@/lib/utils';

type ClockBoardProps = PlayerVisitProps & {
  state: GameState<AroundTheClockPlayerState, AroundTheClockEvent>;
  players: GamePlayerData[];
  config: AroundTheClockConfig;
  currentPlayerId: string | null;
};

function targetLabel(target: number): string {
  return target === 25 ? 'Bull' : String(target);
}

export function ClockBoard({ state, players, config, currentPlayerId, throws, turnIndex }: ClockBoardProps) {
  const sequence = clockSequence(config);

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-3">
      {players.map((player) => {
        const ps = state.perPlayer[player.player_id];
        if (!ps) return null;
        const isCurrent = player.player_id === currentPlayerId;
        const targetIndex = ps.finished ? sequence.length : Math.max(0, sequence.indexOf(ps.target));
        return (
          <GamePlayerCard key={player.player_id} player={player} current={isCurrent && !ps.finished}
            score={ps.finished ? <Check className="size-14" aria-label="Finished" /> : targetLabel(ps.target)}
            scoreLabel={ps.finished ? 'Finished' : 'Next target'} finished={ps.finished}
            detail={`${targetIndex} of ${sequence.length} targets · ${ps.dartsThrown} ${ps.dartsThrown === 1 ? 'dart' : 'darts'}`}
            throws={throws} turnIndex={turnIndex}>
            <div className="flex flex-wrap gap-1" aria-label={`${player.display_name} progress`}>
              {sequence.map((value, index) => (
                <span key={value} aria-label={`${targetLabel(value)}: ${index < targetIndex ? 'complete' : index === targetIndex ? 'next target' : 'remaining'}`}
                  className={cn('flex size-6 items-center justify-center rounded text-xs tabular-nums',
                    index < targetIndex ? 'bg-lime-300/20 text-lime-300' : index === targetIndex ? 'bg-lime-300 font-bold text-slate-950' : 'bg-white/5 text-muted-foreground')}>
                  {value === 25 ? 'B' : value}
                </span>
              ))}
            </div>
          </GamePlayerCard>
        );
      })}
    </div>
  );
}
