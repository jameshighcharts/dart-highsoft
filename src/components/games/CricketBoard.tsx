'use client';

import { CRICKET_TARGETS } from '@/lib/games/types';
import type { CricketConfig, CricketEvent, CricketPlayerState, CricketTarget, GameState } from '@/lib/games/types';
import type { GamePlayerData } from '@/hooks/useGameData';
import { cn } from '@/lib/utils';

type CricketBoardProps = {
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
  if (marks <= 0) return <span data-testid="cricket-mark" data-marks={0} className={className} aria-label="No marks" />;
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

export function CricketBoard({ state, players, config, currentPlayerId }: CricketBoardProps) {
  const cutThroat = config.variant === 'cut_throat';

  return (
    <div className="rounded-lg border bg-card overflow-x-auto">
      <table className="w-full min-w-[320px] text-sm tabular-nums">
        <thead>
          <tr className="border-b">
            <th className="w-16 px-2 py-2 text-left text-xs font-medium text-muted-foreground">
              {cutThroat ? 'Cut-throat' : 'Cricket'}
            </th>
            {players.map((player) => {
              const ps = state.perPlayer[player.player_id];
              const isCurrent = player.player_id === currentPlayerId;
              return (
                <th
                  key={player.player_id}
                  className={cn(
                    'px-2 py-2 text-center align-bottom',
                    isCurrent && 'bg-accent/40 border-b-2 border-b-primary'
                  )}
                >
                  <div className="truncate max-w-[9rem] mx-auto font-medium">{player.display_name}</div>
                  <div className="text-xl font-bold leading-tight">{ps?.points ?? 0}</div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {CRICKET_TARGETS.map((target) => {
            const closedForAll = players.length > 0 && players.every((p) => (state.perPlayer[p.player_id]?.marks[target] ?? 0) >= 3);
            return (
              <tr key={target} className={cn('border-b last:border-b-0', closedForAll && 'opacity-40')}>
                <td className="px-2 py-1.5 font-semibold text-muted-foreground">{targetLabel(target)}</td>
                {players.map((player) => {
                  const marks = state.perPlayer[player.player_id]?.marks[target] ?? 0;
                  const isCurrent = player.player_id === currentPlayerId;
                  return (
                    <td
                      key={player.player_id}
                      data-testid={`cricket-cell-${player.player_id}-${target}`}
                      className={cn('px-2 py-1.5 text-center', isCurrent && 'bg-accent/40')}
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
      <div className="px-2 py-1.5 text-xs text-muted-foreground border-t">
        {cutThroat ? 'Points go to opponents. Lower is better.' : 'Close every number with the most points to win.'}
        {config.maxRounds ? ` Max ${config.maxRounds} rounds.` : ''}
      </div>
    </div>
  );
}
