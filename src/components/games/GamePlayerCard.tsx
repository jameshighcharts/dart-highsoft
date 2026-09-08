import type { ReactNode } from 'react';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { ThrowSegmentBadges } from '@/components/ThrowSegmentBadges';
import type { GamePlayerData, GameThrowData } from '@/hooks/useGameData';
import { cn } from '@/lib/utils';

export type PlayerVisitProps = {
  throws?: GameThrowData[];
  turnIndex?: number;
};

type Props = PlayerVisitProps & {
  player: GamePlayerData;
  current: boolean;
  score: ReactNode;
  scoreLabel: string;
  detail: ReactNode;
  finished?: boolean;
  children?: ReactNode;
};

export function GamePlayerCard({ player, current, score, scoreLabel, detail, finished, children, throws = [], turnIndex }: Props) {
  const playerThrows = throws.filter((dart) => dart.player_id === player.player_id);
  const lastTurn = playerThrows.at(-1)?.turn_index;
  const visit = playerThrows.filter((dart) => dart.turn_index === (current ? turnIndex : lastTurn));
  return (
    <article
      aria-label={player.display_name}
      aria-current={current ? 'true' : undefined}
      className={cn(
        'scoreboard-tile relative flex min-w-0 flex-col gap-3 overflow-hidden rounded-2xl border p-4',
        current ? 'border-lime-300/80 bg-gradient-to-br from-lime-300/20 via-lime-300/5 to-transparent'
          : finished ? 'border-emerald-400/40 bg-emerald-400/5'
            : 'border-white/10 bg-gradient-to-br from-white/[0.06] to-white/[0.015]'
      )}
    >
      <span className="scoreboard-sweep" aria-hidden="true" />
      <div className="relative flex min-w-0 items-center gap-2.5">
        <PlayerAvatar player={{ id: player.player_id, display_name: player.display_name, avatar_url: player.avatar_url }} size="sm" />
        <h3 className="min-w-0 break-words text-lg font-bold leading-tight">{player.display_name}</h3>
      </div>
      <div className="flex items-end justify-between gap-2">
        <div>
          <div className={cn('text-6xl font-black leading-none tracking-tighter tabular-nums', current && 'text-lime-300', finished && 'text-emerald-300')}>{score}</div>
          <div className="mt-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{scoreLabel}</div>
        </div>
        {current && <span className="pb-1 text-[10px] font-bold uppercase tracking-widest text-lime-300">On throw</span>}
      </div>
      {children}
      <div className="mt-auto space-y-2 border-t border-white/10 pt-3">
        <div className="text-sm text-muted-foreground">{detail}</div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">{current ? 'This turn' : 'Last turn'}</span>
          <ThrowSegmentBadges throws={visit} highlightIncomplete={current} placeholder="·" />
        </div>
      </div>
    </article>
  );
}
