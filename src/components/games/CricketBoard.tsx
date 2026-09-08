'use client';

import { CRICKET_TARGETS } from '@/lib/games/types';
import type { CricketConfig, CricketEvent, CricketPlayerState, CricketTarget, GameState } from '@/lib/games/types';
import type { GamePlayerData } from '@/hooks/useGameData';
import { GamePlayerCard, type PlayerVisitProps } from './GamePlayerCard';
import { cn } from '@/lib/utils';

type CricketBoardProps = PlayerVisitProps & {
  state: GameState<CricketPlayerState, CricketEvent>;
  players: GamePlayerData[];
  config: CricketConfig;
  currentPlayerId: string | null;
};

function targetLabel(target: CricketTarget): string {
  return target === 25 ? 'Bull' : String(target);
}

/** Classic cricket marks: 1 = slash, 2 = cross, 3 = circled cross. */
export function CricketMark({ marks, className }: { marks: number; className?: string }) {
  if (marks <= 0) return <span data-testid="cricket-mark" data-marks={0} className={cn('text-muted-foreground/40', className)} aria-label="No marks">·</span>;
  const clamped = Math.min(marks, 3);
  return (
    <svg
      data-testid="cricket-mark"
      data-marks={clamped}
      viewBox="0 0 24 24"
      className={cn('size-6', className)}
      aria-label={clamped === 1 ? '1 mark' : clamped === 2 ? '2 marks' : 'Closed'}
      role="img"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
    >
      <line x1="6" y1="18" x2="18" y2="6" />
      {clamped >= 2 && <line x1="6" y1="6" x2="18" y2="18" />}
      {clamped >= 3 && <circle cx="12" cy="12" r="10" />}
    </svg>
  );
}

export function CricketBoard({ state, players, config, currentPlayerId, throws, turnIndex }: CricketBoardProps) {
  const cutThroat = config.variant === 'cut_throat';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-3">
        {players.map((player) => {
          const ps = state.perPlayer[player.player_id];
          const closed = CRICKET_TARGETS.filter((target) => (ps?.marks[target] ?? 0) >= 3).length;
          return <GamePlayerCard key={player.player_id} player={player} current={player.player_id === currentPlayerId}
            score={ps?.points ?? 0} scoreLabel={cutThroat ? 'Points · lowest wins' : 'Points'}
            detail={`${closed} of 7 numbers closed`} finished={state.winnerId === player.player_id}
            throws={throws} turnIndex={turnIndex} />;
        })}
      </div>
    <div className="rounded-2xl border border-white/10 bg-card overflow-x-auto" role="region" aria-label="Cricket marks" tabIndex={0}>
      <table className="w-full text-sm tabular-nums">
        <caption className="sr-only">Cricket marks. Three marks close a number.</caption>
        <thead>
          <tr className="border-b border-white/10">
            <th scope="col" className="w-16 px-2 py-2 text-left text-xs font-medium text-muted-foreground">
              {cutThroat ? 'Cut-throat' : 'Cricket'}
            </th>
            {players.map((player) => {
              const isCurrent = player.player_id === currentPlayerId;
              return (
                <th
                  key={player.player_id}
                  scope="col"
                  className={cn(
                    'px-2 py-2 text-center align-bottom',
                    isCurrent && 'bg-lime-300/10 border-b-2 border-b-lime-300'
                  )}
                >
                  <span className="block min-w-24 break-words">{player.display_name}</span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {CRICKET_TARGETS.map((target) => {
            const closedForAll = players.length > 0 && players.every((p) => (state.perPlayer[p.player_id]?.marks[target] ?? 0) >= 3);
            return (
              <tr key={target} className={cn('border-b border-white/10 last:border-b-0', closedForAll && 'opacity-40')}>
                <th scope="row" className="sticky left-0 z-10 bg-card px-3 py-2 text-left text-lg font-bold">{targetLabel(target)}</th>
                {players.map((player) => {
                  const marks = state.perPlayer[player.player_id]?.marks[target] ?? 0;
                  const isCurrent = player.player_id === currentPlayerId;
                  return (
                    <td
                      key={player.player_id}
                      data-testid={`cricket-cell-${player.player_id}-${target}`}
                      className={cn('px-2 py-1.5 text-center', isCurrent && 'bg-lime-300/10')}
                    >
                      <div className="flex items-center justify-center h-7">
                        <CricketMark marks={marks} className={marks >= 3 ? 'text-primary' : 'text-foreground'} />
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="px-2 py-1.5 text-xs text-muted-foreground border-t border-white/10">
        {cutThroat ? 'Points go to opponents. Lower is better.' : 'Close every number with the most points to win.'}
        {config.maxRounds ? ` Max ${config.maxRounds} rounds.` : ''}
      </div>
    </div>
    </div>
  );
}
