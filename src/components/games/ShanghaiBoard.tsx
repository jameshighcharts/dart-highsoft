'use client';

import { Sparkles } from 'lucide-react';

import { shanghaiTargetForRound } from '@/lib/games/engines/shanghai';
import type { GameState, ShanghaiConfig, ShanghaiEvent, ShanghaiPlayerState } from '@/lib/games/types';
import type { GamePlayerData } from '@/hooks/useGameData';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { cn } from '@/lib/utils';

type ShanghaiBoardProps = {
  state: GameState<ShanghaiPlayerState, ShanghaiEvent>;
  players: GamePlayerData[];
  config: ShanghaiConfig;
  currentPlayerId: string | null;
};

export function ShanghaiBoard({ state, players, config, currentPlayerId }: ShanghaiBoardProps) {
  let lastRound = config.rounds;
  if (!state.finished) lastRound = Math.max(lastRound, state.round);
  for (const player of players) {
    const scores = state.perPlayer[player.player_id]?.roundScores ?? {};
    for (const key of Object.keys(scores)) lastRound = Math.max(lastRound, Number(key));
  }
  const rounds = Array.from({ length: lastRound }, (_, index) => index + 1);
  const currentRound = state.finished ? null : state.round;
  const currentTarget = currentRound ? shanghaiTargetForRound(config, currentRound) : null;
  const shanghaiHit = state.lastEvent?.shanghai === true;
  const shanghaiBy = shanghaiHit ? players.find((p) => p.player_id === state.lastEvent?.playerId)?.display_name : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {currentTarget !== null && (
          <div className="inline-flex items-center gap-2 rounded-lg border border-primary bg-primary/10 px-4 py-2">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Target</span>
            <span className="text-3xl font-bold tabular-nums leading-none">{currentTarget}</span>
          </div>
        )}
        {shanghaiHit && (
          <div className="inline-flex items-center gap-2 rounded-lg border border-amber-500 bg-amber-500/15 px-4 py-2 font-bold text-amber-400">
            <Sparkles className="size-5" />
            SHANGHAI!{shanghaiBy ? ` ${shanghaiBy} wins.` : ''}
          </div>
        )}
      </div>

      <div className="rounded-lg border bg-card overflow-x-auto">
        <table className="w-full min-w-[320px] text-sm tabular-nums">
          <thead>
            <tr className="border-b">
              <th className="w-24 px-2 py-2 text-left text-xs font-medium text-muted-foreground">Round</th>
              {players.map((player) => {
                const ps = state.perPlayer[player.player_id];
                const isCurrent = player.player_id === currentPlayerId;
                return (
                  <th
                    key={player.player_id}
                    className={cn('px-2 py-2 text-center align-bottom', isCurrent && 'bg-accent/40 border-b-2 border-b-primary')}
                  >
                    <div className="inline-flex items-center gap-2 max-w-[9rem] font-medium">
                      <PlayerAvatar player={{ id: player.player_id, display_name: player.display_name, avatar_url: player.avatar_url }} size="sm" />
                      <span className="truncate">{player.display_name}</span>
                    </div>
                    <div className={cn('text-xl font-bold leading-tight', ps && !ps.inContention && 'text-muted-foreground line-through')}>
                      {ps?.total ?? 0}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rounds.map((round) => {
              const isCurrentRound = round === currentRound;
              const suddenDeath = round > config.rounds;
              return (
                <tr key={round} className={cn('border-b last:border-b-0', isCurrentRound && 'bg-primary/10')}>
                  <td className="px-2 py-1.5 text-muted-foreground">
                    <span className={cn('font-semibold', isCurrentRound && 'text-foreground')}>{round}</span>
                    <span className="ml-1 text-xs">on {shanghaiTargetForRound(config, round)}</span>
                    {suddenDeath && <span className="ml-1 text-xs text-amber-400">SD</span>}
                  </td>
                  {players.map((player) => {
                    const score = state.perPlayer[player.player_id]?.roundScores[round];
                    const isCurrent = player.player_id === currentPlayerId;
                    return (
                      <td key={player.player_id} className={cn('px-2 py-1.5 text-center', isCurrent && 'bg-accent/30')}>
                        {score === undefined ? <span className="text-muted-foreground/40">-</span> : score}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
