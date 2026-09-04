'use client';

import { Trophy } from 'lucide-react';

import type { GamePlayerData } from '@/hooks/useGameData';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { clockSequence } from '@/lib/games/engines/aroundTheClock';
import type {
  AroundTheClockConfig,
  AroundTheClockPlayerState,
  CricketPlayerState,
  GameMode,
  GameSessionStatus,
  GameState,
  KillerPlayerState,
  ShanghaiPlayerState,
} from '@/lib/games/types';
import { CRICKET_TARGETS } from '@/lib/games/types';
import { cn } from '@/lib/utils';

type GameResultsProps = {
  mode: GameMode;
  status: GameSessionStatus;
  config: Record<string, unknown>;
  state: GameState;
  players: GamePlayerData[];
  winnerId: string | null;
  children?: React.ReactNode;
};

function summaryFor(mode: GameMode, config: Record<string, unknown>, playerState: unknown): string {
  if (!playerState) return '';
  switch (mode) {
    case 'cricket': {
      const ps = playerState as CricketPlayerState;
      const closed = CRICKET_TARGETS.filter((t) => (ps.marks[t] ?? 0) >= 3).length;
      return `${ps.points} pts · ${closed}/${CRICKET_TARGETS.length} closed`;
    }
    case 'killer': {
      const ps = playerState as KillerPlayerState;
      const kills = `${ps.kills} ${ps.kills === 1 ? 'kill' : 'kills'}`;
      if (ps.eliminated) return `Eliminated #${ps.eliminatedOrder ?? '?'} · ${kills}`;
      return `${ps.lives} ${ps.lives === 1 ? 'life' : 'lives'} left · ${kills}`;
    }
    case 'shanghai': {
      const ps = playerState as ShanghaiPlayerState;
      return `${ps.total} pts`;
    }
    case 'around_the_clock': {
      const ps = playerState as AroundTheClockPlayerState;
      if (ps.finished) return `Finished · ${ps.dartsThrown} darts`;
      const sequence = clockSequence(config as unknown as AroundTheClockConfig);
      const reached = Math.max(0, sequence.indexOf(ps.target));
      return `On ${ps.target === 25 ? 'Bull' : ps.target} (${reached}/${sequence.length}) · ${ps.dartsThrown} darts`;
    }
    default:
      return '';
  }
}

export function GameResults({ mode, status, config, state, players, winnerId, children }: GameResultsProps) {
  const endedEarly = status === 'ended_early';
  const playerOf = (id: string) => players.find((p) => p.player_id === id);
  const nameOf = (id: string) => playerOf(id)?.display_name ?? 'Unknown';
  const avatarOf = (id: string) => ({ id, display_name: nameOf(id), avatar_url: playerOf(id)?.avatar_url });
  const ranked = state.standings.length > 0 ? state.standings : players.map((p) => p.player_id);
  const winner = !endedEarly && winnerId ? nameOf(winnerId) : null;

  return (
    <div className="rounded-lg border bg-card p-4 space-y-4">
      <div className="flex items-center gap-3">
        <Trophy className={cn('size-8', winner ? 'text-amber-400' : 'text-muted-foreground')} />
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            {endedEarly ? 'Game ended early' : 'Winner'}
          </div>
          <div className="text-2xl font-bold leading-tight">{endedEarly ? 'No winner' : winner ?? 'Draw'}</div>
        </div>
      </div>

      <ol className="divide-y rounded-md border">
        {ranked.map((playerId, index) => (
          <li key={playerId} className="flex items-center gap-3 px-3 py-2">
            <span className="w-6 text-sm text-muted-foreground tabular-nums">{index + 1}.</span>
            <span className={cn('flex-1 min-w-0 inline-flex items-center gap-2', playerId === winnerId && !endedEarly && 'font-semibold')}>
              <PlayerAvatar player={avatarOf(playerId)} size="sm" />
              <span className="truncate">{nameOf(playerId)}</span>
            </span>
            <span className="text-sm text-muted-foreground tabular-nums">{summaryFor(mode, config, state.perPlayer[playerId])}</span>
          </li>
        ))}
      </ol>

      {children}
    </div>
  );
}
