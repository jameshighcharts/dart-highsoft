'use client';

import { Sparkles } from 'lucide-react';

import { shanghaiTargetForRound } from '@/lib/games/engines/shanghai';
import type { GameState, ShanghaiConfig, ShanghaiEvent, ShanghaiPlayerState } from '@/lib/games/types';
import type { GamePlayerData } from '@/hooks/useGameData';
import { GamePlayerCard, type PlayerVisitProps } from './GamePlayerCard';
import { cn } from '@/lib/utils';

type ShanghaiBoardProps = PlayerVisitProps & {
  state: GameState<ShanghaiPlayerState, ShanghaiEvent>;
  players: GamePlayerData[];
  config: ShanghaiConfig;
  currentPlayerId: string | null;
};

export function ShanghaiBoard({ state, players, config, currentPlayerId, throws, turnIndex }: ShanghaiBoardProps) {
  let lastRound = config.rounds;
  if (!state.finished) lastRound = Math.max(lastRound, state.round);
  for (const player of players) {
    const scores = state.perPlayer[player.player_id]?.roundScores ?? {};
    for (const key of Object.keys(scores)) lastRound = Math.max(lastRound, Number(key));
  }
  const rounds = Array.from({ length: lastRound }, (_, index) => index + 1);
  const currentRound = currentPlayerId ? state.round : null;
  const shanghaiHit = state.lastEvent?.shanghai === true;
  const shanghaiBy = shanghaiHit ? players.find((p) => p.player_id === state.lastEvent?.playerId)?.display_name : null;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-3">
        {players.map((player) => {
          const ps = state.perPlayer[player.player_id];
          const roundScore = ps?.roundScores[state.round] ?? 0;
          return <GamePlayerCard key={player.player_id} player={player} current={player.player_id === currentPlayerId}
            score={ps?.total ?? 0} scoreLabel="Total points" finished={state.winnerId === player.player_id}
            detail={!currentPlayerId ? 'Final total' : ps?.inContention ? `This round: ${roundScore} ${roundScore === 1 ? 'point' : 'points'}` : 'Out of sudden death'}
            throws={throws} turnIndex={turnIndex} />;
        })}
      </div>
      {shanghaiHit && <div className="flex items-center gap-2 text-amber-300"><Sparkles className="size-5" />Shanghai! {shanghaiBy} wins.</div>}

      <div className="max-h-80 overflow-auto rounded-2xl border border-white/10 bg-card" role="region" aria-label="Shanghai round scores" tabIndex={0}>
        <table className="w-full text-sm tabular-nums">
          <caption className="sr-only">Points scored by round and player</caption>
          <thead className="sticky top-0 z-20 bg-card">
            <tr className="border-b border-white/10">
              <th className="w-24 px-2 py-2 text-left text-xs font-medium text-muted-foreground">Round</th>
              {players.map((player) => {
                const isCurrent = player.player_id === currentPlayerId;
                return (
                  <th scope="col"
                    key={player.player_id}
                    className={cn('px-2 py-2 text-center align-bottom', isCurrent && 'bg-lime-300/10 border-b-2 border-b-lime-300')}
                  >
                    <span className="block min-w-24 break-words">{player.display_name}</span>
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
                <tr key={round} className={cn('border-b border-white/10 last:border-b-0', isCurrentRound && 'bg-lime-300/10')}>
                  <th scope="row" className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-normal text-muted-foreground">
                    <span className={cn('font-semibold', isCurrentRound && 'text-foreground')}>{round}</span>
                    <span className="ml-1 text-xs">on {shanghaiTargetForRound(config, round)}</span>
                    {suddenDeath && <span className="ml-1 text-xs text-amber-400">SD</span>}
                  </th>
                  {players.map((player) => {
                    const score = state.perPlayer[player.player_id]?.roundScores[round];
                    const isCurrent = player.player_id === currentPlayerId;
                    return (
                      <td key={player.player_id} className={cn('px-2 py-1.5 text-center', isCurrent && 'bg-lime-300/5')}>
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
