'use client';

import { Radio } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { gameModeName } from '@/lib/games/labels';
import type { GameMode, GameSessionStatus } from '@/lib/games/types';

type GameHeaderProps = {
  mode: GameMode;
  status: GameSessionStatus;
  finished: boolean;
  round: number;
  /** Shanghai only: the current round's target number. */
  roundTarget?: number | null;
  currentPlayerName: string | null;
  scoliaBoardId: string | null;
  celebration?: string | null;
};

function statusLabel(status: GameSessionStatus, finished: boolean): { text: string; variant: 'default' | 'secondary' | 'outline' } {
  if (status === 'ended_early') return { text: 'Ended early', variant: 'outline' };
  if (status === 'completed' || finished) return { text: 'Finished', variant: 'secondary' };
  return { text: 'Live', variant: 'default' };
}

export function GameHeader({ mode, status, finished, round, roundTarget, currentPlayerName, scoliaBoardId, celebration }: GameHeaderProps) {
  const isActive = status === 'active' && !finished;
  const badge = statusLabel(status, finished);

  return (
    <div className="rounded-lg border bg-card p-3 md:p-4 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="text-sm">{gameModeName(mode)}</Badge>
        <Badge variant={badge.variant} className={isActive ? 'bg-emerald-600 text-white' : undefined}>
          {badge.text}
        </Badge>
        {scoliaBoardId && (
          <Badge variant="secondary" className="gap-1">
            <Radio className="size-3" />
            Scolia board
          </Badge>
        )}
        <span className="ml-auto text-sm text-muted-foreground tabular-nums">
          Round {round}
          {roundTarget ? ` · Target ${roundTarget}` : ''}
        </span>
      </div>
      {isActive && currentPlayerName && (
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Up now</div>
          <div className="text-3xl md:text-4xl font-bold leading-tight truncate">{currentPlayerName}</div>
        </div>
      )}
      {celebration && <div className="text-sm font-medium text-primary">{celebration}</div>}
    </div>
  );
}
