'use client';

import { Heart, Skull, Target } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import type { GameState, KillerConfig, KillerEvent, KillerPlayerState } from '@/lib/games/types';
import type { GamePlayerData } from '@/hooks/useGameData';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { cn } from '@/lib/utils';

type KillerBoardProps = {
  state: GameState<KillerPlayerState, KillerEvent>;
  players: GamePlayerData[];
  config: KillerConfig;
  currentPlayerId: string | null;
};

function hintFor(ps: KillerPlayerState, config: KillerConfig): string {
  if (ps.eliminated) return 'Out of the game';
  if (!ps.isKiller) {
    return config.killerRequirement === 'double'
      ? `Hit D${ps.number} to become a killer`
      : `Hit ${ps.number} to become a killer`;
  }
  return config.hitToKill === 'double' ? "Hit an opponent's double" : "Hit an opponent's number";
}

export function KillerBoard({ state, players, config, currentPlayerId }: KillerBoardProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {players.map((player) => {
        const ps = state.perPlayer[player.player_id];
        if (!ps) return null;
        const isCurrent = player.player_id === currentPlayerId;
        return (
          <div
            key={player.player_id}
            className={cn(
              'rounded-lg border bg-card p-3 flex flex-col gap-2 transition-colors',
              isCurrent && !ps.eliminated && 'border-primary ring-2 ring-primary/40',
              ps.eliminated && 'opacity-50 grayscale'
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="text-4xl font-bold tabular-nums leading-none">{ps.number}</div>
              <div className="flex flex-col items-end gap-1">
                {ps.isKiller && !ps.eliminated && (
                  <Badge variant="destructive" className="gap-1">
                    <Target className="size-3" />
                    KILLER
                  </Badge>
                )}
                {ps.eliminated && (
                  <Badge variant="outline" className="gap-1">
                    <Skull className="size-3" />
                    Out
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 font-medium">
              <PlayerAvatar player={{ id: player.player_id, display_name: player.display_name, avatar_url: player.avatar_url }} size="sm" />
              <span className="truncate">{player.display_name}</span>
            </div>
            <div className="flex items-center gap-1" aria-label={`${ps.lives} of ${config.lives} lives`}>
              {Array.from({ length: config.lives }, (_, index) => {
                const alive = index < ps.lives;
                return (
                  <Heart
                    key={index}
                    className={cn('size-4', alive ? 'fill-red-500 text-red-500' : 'text-muted-foreground/50')}
                  />
                );
              })}
              {ps.kills > 0 && (
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                  {ps.kills} {ps.kills === 1 ? 'kill' : 'kills'}
                </span>
              )}
            </div>
            {isCurrent && !state.finished && (
              <div className="text-xs text-primary">{hintFor(ps, config)}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
