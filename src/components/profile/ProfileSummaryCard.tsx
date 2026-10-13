'use client';

import { useQuery } from '@tanstack/react-query';

import { Card, CardContent } from '@/components/ui/card';
import { profileSummaryQuery } from '@/lib/queries/profile';

export function ProfileSummaryCard({ playerId }: { playerId: string }) {
  // From the browser's saved cache at once on a revisit, refreshed in the background.
  const { data: summary, error } = useQuery(profileSummaryQuery(playerId));

  if (error && !summary) return <p className="text-sm text-muted-foreground">Stats unavailable: {error.message}</p>;
  if (!summary) return <p className="text-sm text-muted-foreground">Loading stats…</p>;

  const winRate = summary.matches > 0 ? Math.round((summary.wins / summary.matches) * 100) : null;
  const tiles: Array<{ label: string; value: string }> = [
    { label: 'Matches', value: String(summary.matches) },
    { label: 'Wins', value: String(summary.wins) },
    { label: 'Win rate', value: winRate === null ? '–' : `${winRate}%` },
    { label: 'Avg / turn', value: summary.avgPerTurn === null ? '–' : summary.avgPerTurn.toFixed(1) },
    { label: 'Legs won', value: String(summary.legsWon) },
  ];

  return (
    <Card>
      <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        {tiles.map((tile) => (
          <div key={tile.label}>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{tile.label}</div>
            <div className="text-2xl font-semibold tabular-nums">{tile.value}</div>
          </div>
        ))}
        {summary.last10.length > 0 ? (
          <div className="col-span-2 sm:col-span-5">
            <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Last {summary.last10.length}</div>
            <div className="flex gap-1">
              {summary.last10.map((result, index) => (
                <span
                  key={index}
                  title={result === 1 ? 'Win' : 'Loss'}
                  className={`flex size-6 items-center justify-center rounded text-[10px] font-semibold ${result === 1 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}
                >
                  {result === 1 ? 'W' : 'L'}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
