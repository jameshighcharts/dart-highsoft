'use client';

import Link from 'next/link';
import { ArrowLeft, Eye, Radio } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { gameModeName } from '@/lib/games/labels';
import type { GameMode, GameSessionStatus } from '@/lib/games/types';

type GameHeaderProps = {
  gameId: string;
  mode: GameMode;
  status: GameSessionStatus;
  finished: boolean;
  roundLabel: string;
  spectator: boolean;
  scoliaBoardId: string | null;
};

export function GameHeader({ gameId, mode, status, finished, roundLabel, spectator, scoliaBoardId }: GameHeaderProps) {
  const active = status === 'active' && !finished;
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-xl font-bold tracking-tight md:text-2xl">{gameModeName(mode)}</h1>
        <Badge variant="outline" className={active ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : 'border-white/15'}>
          {status === 'ended_early' ? 'Ended early' : active ? 'In progress' : 'Finished'}
        </Badge>
        <span className="text-sm tabular-nums text-muted-foreground">{roundLabel}</span>
        {scoliaBoardId && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Radio className="size-3" />Scolia</span>}
      </div>
      <Button variant="outline" size="sm" asChild className="min-h-10 border-white/15">
        <Link href={`/game/${gameId}${spectator ? '' : '?spectator=true'}`}>
          {spectator ? <ArrowLeft className="size-4" /> : <Eye className="size-4" />}
          {spectator ? 'Exit spectator view' : 'Spectator view'}
        </Link>
      </Button>
    </header>
  );
}
