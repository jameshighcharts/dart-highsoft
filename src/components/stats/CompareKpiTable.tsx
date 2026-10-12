"use client";

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { CompareRow as Row } from '@/lib/stats/playerBundle';
import { getPlayerColor } from '@/lib/stats/playerColors';
import type { PlayerRow } from '@/lib/stats/types';
import type { PerPlayerStatsQuery } from '@/hooks/useMultiPlayerStats';

interface CompareKpiTableProps {
  playerIds: string[];
  players: PlayerRow[];
  perPlayer: PerPlayerStatsQuery[];
}

const COLUMNS: Array<{ key: keyof Row; label: string; suffix?: string; decimals?: number; higherIsBetter: boolean }> = [
  { key: 'gamesPlayed', label: 'Games', higherIsBetter: true },
  { key: 'gameWinRate', label: 'Match Win', suffix: '%', higherIsBetter: true },
  { key: 'legWinRate', label: 'Leg Win', suffix: '%', higherIsBetter: true },
  { key: 'avgScore', label: 'Avg', decimals: 2, higherIsBetter: true },
  { key: 'avgScore30', label: 'Avg 30d', decimals: 2, higherIsBetter: true },
  { key: 'first9', label: 'First 9', decimals: 2, higherIsBetter: true },
  { key: 'first9_30', label: 'First 9 30d', decimals: 2, higherIsBetter: true },
  { key: 't20Grouping', label: 'T20 Group', suffix: '%', decimals: 1, higherIsBetter: true },
  { key: 't20Grouping30', label: 'T20 Group 30d', suffix: '%', decimals: 1, higherIsBetter: true },
  { key: 'checkoutRate', label: 'Checkout', suffix: '%', higherIsBetter: true },
  { key: 'bustRate', label: 'Bust', suffix: '%', higherIsBetter: false },
  { key: 'dartsPerLeg', label: 'Darts/Leg', decimals: 1, higherIsBetter: false },
  { key: 'count180', label: '180s', higherIsBetter: true },
  { key: 'highestCheckout', label: 'Top Out', higherIsBetter: true },
];

function formatValue(value: number, col: (typeof COLUMNS)[number]): string {
  const d = col.decimals ?? 0;
  const fixed = d > 0 ? value.toFixed(d) : String(Math.round(value));
  return `${fixed}${col.suffix ?? ''}`;
}

function PlayerRowComponent({
  playerName,
  color,
  row,
  bestByKey,
}: {
  playerName: string;
  color: string;
  row: Row | null;
  bestByKey: Partial<Record<keyof Row, string>>;
}) {
  // `bestByKey` maps column key -> winning player name. The row highlights its
  // cell if it owns that winning name. We pass name rather than id because the
  // parent builds this map without needing to know about row identity.
  return (
    <tr className="border-t">
      <td className="py-2 px-3 font-medium whitespace-nowrap">
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
          {playerName}
        </div>
      </td>
      {COLUMNS.map(col => (
        <td key={col.key} className="py-2 px-3 text-right tabular-nums">
          {row === null ? (
            <span className="inline-block w-12 h-4 bg-muted animate-pulse rounded" />
          ) : (
            <span className={bestByKey[col.key] === playerName ? 'font-bold text-foreground' : 'text-muted-foreground'}>
              {formatValue(row[col.key], col)}
            </span>
          )}
        </td>
      ))}
    </tr>
  );
}

export function CompareKpiTable({ playerIds, players, perPlayer }: CompareKpiTableProps) {
  const playerById = useMemo(() => {
    const m = new Map<string, PlayerRow>();
    for (const p of players) m.set(p.id, p);
    return m;
  }, [players]);

  // Each player's row is computed with the rest of their statistics (see `PlayerStatsBundle`).
  const rows = useMemo(() => {
    return perPlayer.map((q): Row | null => (q.status === 'success' ? q.stats?.compare ?? null : null));
  }, [perPlayer]);

  // Winner per column (handles ties by taking the first).
  const bestByKey = useMemo(() => {
    const out: Partial<Record<keyof Row, string>> = {};
    for (const col of COLUMNS) {
      let bestIdx = -1;
      let bestVal = col.higherIsBetter ? -Infinity : Infinity;
      rows.forEach((row, i) => {
        if (!row) return;
        const v = row[col.key];
        if ((col.higherIsBetter && v > bestVal) || (!col.higherIsBetter && v < bestVal)) {
          bestVal = v;
          bestIdx = i;
        }
      });
      if (bestIdx >= 0) {
        const winnerId = playerIds[bestIdx];
        out[col.key] = playerById.get(winnerId)?.display_name ?? '';
      }
    }
    return out;
  }, [rows, playerIds, playerById]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Head to Head</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="py-2 px-3 text-left">Player</th>
                {COLUMNS.map(col => (
                  <th key={col.key} className="py-2 px-3 text-right whitespace-nowrap">{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {playerIds.map((id, i) => {
                const player = playerById.get(id);
                if (!player) return null;
                return (
                  <PlayerRowComponent
                    key={id}
                    playerName={player.display_name}
                    color={getPlayerColor(i)}
                    row={rows[i]}
                    bestByKey={bestByKey}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
