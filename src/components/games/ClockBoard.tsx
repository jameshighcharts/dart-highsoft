'use client';

import { Check } from 'lucide-react';

import { clockSequence } from '@/lib/games/engines/aroundTheClock';
import type { AroundTheClockConfig, AroundTheClockEvent, AroundTheClockPlayerState, GameState } from '@/lib/games/types';
import type { GamePlayerData } from '@/hooks/useGameData';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { cn } from '@/lib/utils';

type ClockBoardProps = {
  state: GameState<AroundTheClockPlayerState, AroundTheClockEvent>;
  players: GamePlayerData[];
  config: AroundTheClockConfig;
  currentPlayerId: string | null;
};

function targetLabel(target: number): string {
  return target === 25 ? 'Bull' : String(target);
}

export function ClockBoard({ state, players, config, currentPlayerId }: ClockBoardProps) {
  const sequence = clockSequence(config);

  return (
    <div className="space-y-2">
      {players.map((player) => {
        const ps = state.perPlayer[player.player_id];
        if (!ps) return null;
        const isCurrent = player.player_id === currentPlayerId;
        const targetIndex = ps.finished ? sequence.length : Math.max(0, sequence.indexOf(ps.target));
        return (
          <div
            key={player.player_id}
            className={cn(
              'rounded-lg border bg-card p-3 flex flex-col sm:flex-row sm:items-center gap-3',
              isCurrent && !ps.finished && 'border-primary ring-2 ring-primary/40'
            )}
          >
            <div className="flex items-center gap-3 sm:w-56 shrink-0">
              <div
                className={cn(
                  'flex size-14 items-center justify-center rounded-lg border text-2xl font-bold tabular-nums shrink-0',
                  ps.finished ? 'border-emerald-500 bg-emerald-500/15 text-emerald-400' : 'border-primary bg-primary/10'
                )}
                aria-label={ps.finished ? 'Finished' : `Target ${targetLabel(ps.target)}`}
              >
                {ps.finished ? <Check className="size-7" /> : targetLabel(ps.target)}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 font-medium">
                  <PlayerAvatar player={{ id: player.player_id, display_name: player.display_name, avatar_url: player.avatar_url }} size="sm" />
                  <span className="truncate">{player.display_name}</span>
                </div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  {ps.finished ? `Done in ${ps.dartsThrown} darts` : `${ps.dartsThrown} darts`}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-1 flex-1" aria-label="Progress">
              {sequence.map((value, index) => {
                const done = index < targetIndex;
                const active = !ps.finished && index === targetIndex;
                return (
                  <div
                    key={value}
                    title={targetLabel(value)}
                    className={cn(
                      'flex h-5 min-w-5 px-0.5 items-center justify-center rounded-sm border text-[10px] tabular-nums',
                      done && 'bg-primary border-primary text-primary-foreground',
                      active && 'border-primary text-primary font-bold',
                      !done && !active && 'border-muted-foreground/30 text-muted-foreground/60'
                    )}
                  >
                    {value === 25 ? 'B' : value}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
