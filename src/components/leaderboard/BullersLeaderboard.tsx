import { PlayerAvatarById } from '@/components/PlayerAvatarById';
import { medal } from '@/utils/leaderboard';
import { LeaderboardSection } from './LeaderboardSection';

export type BullerEntry = {
  player_id: string;
  display_name: string;
  measured_darts: number;
  misses: number;
  bull_offs: number;
  average_inches: number | string;
};

export function BullersLeaderboard({ entries, loading, error }: {
  entries: BullerEntry[]; loading: boolean; error: boolean;
}) {
  return <LeaderboardSection title="Top 10 Bullers" isEmpty={entries.length === 0}
    emptyMessage={loading ? 'Loading bullers…' : error ? 'Could not load bullers. Please refresh to retry.' : 'No measured bull-off darts yet.'}
    emptySubMessage={!loading && !error ? 'Play a match with Bull-off enabled to get on the board.' : undefined}>
    {entries.length > 0 && <li className="flex justify-between gap-3 px-3 py-2 text-xs text-muted-foreground"><span>Closest on average wins</span><span>Avg inches ↓</span></li>}
    {entries.map((entry, index) => <li key={entry.player_id} className="flex items-center justify-between gap-3 px-3 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="w-8 shrink-0 text-center text-lg">{medal(index)}</span>
        <PlayerAvatarById playerId={entry.player_id} name={entry.display_name} size="sm" />
        <div className="min-w-0"><div className="truncate font-medium">{entry.display_name}</div>
          <div className="text-xs text-muted-foreground">{entry.measured_darts} measured {entry.measured_darts === 1 ? 'dart' : 'darts'} · {entry.misses} {entry.misses === 1 ? 'miss' : 'misses'}</div>
        </div>
      </div>
      <span className="shrink-0 font-mono text-2xl font-bold tabular-nums text-cyan-400" aria-label={`${Number(entry.average_inches).toFixed(2)} inches average`}>{Number(entry.average_inches).toFixed(2)}″</span>
    </li>)}
    {entries.length > 0 && <li className="px-3 py-2 text-xs text-muted-foreground">Completed bull-offs · rethrows included · misses excluded from average</li>}
  </LeaderboardSection>;
}
