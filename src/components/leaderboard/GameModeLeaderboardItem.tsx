import { PlayerAvatarById } from '@/components/PlayerAvatarById';
import type { GameMode } from '@/lib/games/types';
import { medal } from '@/utils/leaderboard';

export type GameModeLeaderboardEntry = {
  player_id: string;
  display_name: string;
  games_played: number;
  wins: number;
  win_rate: number | string;
  last_played_at?: string | null;
  // Cricket
  marks_per_round?: number | string | null;
  avg_points?: number | string | null;
  // Killer
  kills?: number | null;
  times_eliminated?: number | null;
  // Shanghai
  best_total?: number | null;
  avg_total?: number | string | null;
  shanghais?: number | null;
  // Around the Clock
  fewest_darts?: number | null;
  avg_darts?: number | string | null;
  completions?: number | null;
};

type GameModeLeaderboardItemProps = {
  entry: GameModeLeaderboardEntry;
  mode: GameMode;
  index: number;
};

function modeStat(entry: GameModeLeaderboardEntry, mode: GameMode): { value: string; label: string } {
  switch (mode) {
    case 'cricket':
      return { value: Number(entry.marks_per_round ?? 0).toFixed(2), label: 'MPR' };
    case 'killer': {
      const kills = entry.kills ?? 0;
      return { value: String(kills), label: kills === 1 ? 'kill' : 'kills' };
    }
    case 'shanghai':
      return { value: String(entry.best_total ?? 0), label: 'best' };
    case 'around_the_clock': {
      const darts = entry.fewest_darts;
      return { value: darts == null ? '—' : String(darts), label: 'darts' };
    }
  }
}

export function GameModeLeaderboardItem({ entry, mode, index }: GameModeLeaderboardItemProps) {
  const stat = modeStat(entry, mode);
  const winRate = Number(entry.win_rate ?? 0);
  return (
    <li className="flex items-center justify-between px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="w-8 text-lg text-center">{medal(index)}</span>
        <PlayerAvatarById playerId={entry.player_id} name={entry.display_name} size="sm" />
        <div>
          <div className="font-medium">{entry.display_name}</div>
          <div className="text-xs text-muted-foreground">
            {entry.wins}/{entry.games_played} wins &middot; {winRate.toFixed(0)}%
          </div>
        </div>
      </div>
      <div className="text-right">
        <div className="font-mono tabular-nums text-lg font-bold">{stat.value}</div>
        <div className="text-xs text-muted-foreground">{stat.label}</div>
      </div>
    </li>
  );
}
