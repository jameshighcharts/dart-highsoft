'use client';

import { useEffect, useState } from 'react';

import { Card, CardContent } from '@/components/ui/card';
import { getSupabaseClient } from '@/lib/supabaseClient';

type Summary = {
  matches: number;
  wins: number;
  avgPerTurn: number | null;
  last10: number[];
  legsWon: number;
};

export function ProfileSummaryCard({ playerId }: { playerId: string }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = await getSupabaseClient();
        const [participations, summaryRow, form, legs] = await Promise.all([
          supabase.from('match_players').select('match_id, matches!inner(id, ended_early, winner_player_id)').eq('player_id', playerId),
          supabase.from('player_summary').select('wins, avg_per_turn').eq('player_id', playerId).maybeSingle(),
          supabase.from('player_recent_form').select('last_10_results').eq('player_id', playerId).maybeSingle(),
          supabase.from('legs').select('id', { count: 'exact', head: true }).eq('winner_player_id', playerId),
        ]);
        if (participations.error) throw new Error(participations.error.message);
        if (summaryRow.error) throw new Error(summaryRow.error.message);
        if (form.error) throw new Error(form.error.message);
        if (legs.error) throw new Error(legs.error.message);

        const rows = (participations.data ?? []) as Array<{ matches: { ended_early: boolean | null; winner_player_id: string | null } | { ended_early: boolean | null; winner_player_id: string | null }[] | null }>;
        let matches = 0;
        let wins = 0;
        for (const row of rows) {
          const match = Array.isArray(row.matches) ? row.matches[0] : row.matches;
          if (!match || match.ended_early || !match.winner_player_id) continue;
          matches += 1;
          if (match.winner_player_id === playerId) wins += 1;
        }
        if (cancelled) return;
        setSummary({
          matches,
          wins: summaryRow.data ? Number(summaryRow.data.wins ?? wins) : wins,
          avgPerTurn: summaryRow.data?.avg_per_turn != null ? Number(summaryRow.data.avg_per_turn) : null,
          last10: (form.data?.last_10_results as number[] | undefined) ?? [],
          legsWon: legs.count ?? 0,
        });
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Failed to load stats');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [playerId]);

  if (error) return <p className="text-sm text-muted-foreground">Stats unavailable: {error}</p>;
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
