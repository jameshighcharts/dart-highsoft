'use client';

import { Heart, Skull, Target } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import type { GameState, KillerConfig, KillerEvent, KillerPlayerState } from '@/lib/games/types';
import type { GamePlayerData } from '@/hooks/useGameData';
import { GamePlayerCard, type PlayerVisitProps } from './GamePlayerCard';
import { cn } from '@/lib/utils';

type KillerBoardProps = PlayerVisitProps & {
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

export function KillerBoard({ state, players, config, currentPlayerId, throws, turnIndex }: KillerBoardProps) {
  return (
    <div className={cn('grid gap-3', players.length === 4 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))]')}>
      {players.map((player) => {
        const ps = state.perPlayer[player.player_id];
        if (!ps) return null;
        const isCurrent = player.player_id === currentPlayerId;
        return (
          <GamePlayerCard key={player.player_id} player={player} current={isCurrent && !ps.eliminated}
            score={ps.number} scoreLabel="Assigned number" finished={state.winnerId === player.player_id}
            detail={ps.eliminated ? 'Eliminated' : `${ps.lives} ${ps.lives === 1 ? 'life' : 'lives'} left · ${ps.kills} kills`}
            throws={throws} turnIndex={turnIndex}>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex gap-1" aria-label={`${ps.lives} of ${config.lives} lives`}>
                {Array.from({ length: config.lives }, (_, index) => <Heart key={index} aria-hidden="true"
                  className={cn('size-5', index < ps.lives ? 'fill-rose-400 text-rose-400' : 'text-muted-foreground/40')} />)}
              </div>
              {ps.eliminated ? <Badge variant="outline"><Skull className="mr-1 size-3" />Out</Badge>
                : ps.isKiller ? <Badge className="bg-rose-400/15 text-rose-300"><Target className="mr-1 size-3" />Killer</Badge>
                : <Badge variant="secondary">Not a killer yet</Badge>}
            </div>
            {isCurrent && <p className="text-sm text-lime-300">{hintFor(ps, config)}</p>}
          </GamePlayerCard>
        );
      })}
    </div>
  );
}
