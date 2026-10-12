"use client";

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { alignDailyTrends } from '@/lib/stats/alignTrends';
import { getPlayerColor } from '@/lib/stats/playerColors';
import type { PlayerStatsBundle } from '@/lib/stats/playerBundle';
import type { PlayerRow } from '@/lib/stats/types';
import type { PerPlayerStatsQuery } from '@/hooks/useMultiPlayerStats';

const Chart = dynamic(() => import('@/components/Chart'), { ssr: false });

type MetricKey = 'avgScore' | 'firstNine' | 'dartsPerLeg' | 'checkoutRate' | 'bustRate' | 't20Grouping';

const METRICS: Array<{ key: MetricKey; label: string; suffix?: string; decimals: number; lowerIsBetter?: boolean }> = [
  { key: 'avgScore', label: 'Average Score', decimals: 2 },
  { key: 'firstNine', label: 'First 9 Average', decimals: 2 },
  { key: 'dartsPerLeg', label: 'Darts per Leg (501-eq)', decimals: 1, lowerIsBetter: true },
  { key: 'checkoutRate', label: 'Checkout Rate', suffix: '%', decimals: 1 },
  { key: 'bustRate', label: 'Bust Rate', suffix: '%', decimals: 1, lowerIsBetter: true },
  { key: 't20Grouping', label: 'T20 Grouping (First 9)', suffix: '%', decimals: 1 },
];

interface CompareTrendChartProps {
  playerIds: string[];
  players: PlayerRow[];
  perPlayer: PerPlayerStatsQuery[];
}

/** The player's 7-day rolling series for `metric`, from their computed Trends tab. */
function metricTrend(metric: MetricKey, { trends }: PlayerStatsBundle): { categories: string[]; rolling: number[] } {
  switch (metric) {
    case 'avgScore': return { categories: trends.avgScore.categories, rolling: trends.avgScore.rolling };
    case 'firstNine': return { categories: trends.firstNine.categories, rolling: trends.firstNine.rolling };
    case 'dartsPerLeg': return { categories: trends.dartsPerLeg.all.categories, rolling: trends.dartsPerLeg.all.rolling };
    case 'checkoutRate': return { categories: trends.checkoutRate.categories, rolling: trends.checkoutRate.rolling };
    case 'bustRate': return { categories: trends.bustRate.categories, rolling: trends.bustRate.rolling };
    case 't20Grouping': return { categories: trends.t20Grouping.categories, rolling: trends.t20Grouping.rolling };
  }
}

export function CompareTrendChart({ playerIds, players, perPlayer }: CompareTrendChartProps) {
  const [metric, setMetric] = useState<MetricKey>('avgScore');
  const metricMeta = METRICS.find(m => m.key === metric)!;

  const playerById = useMemo(() => {
    const m = new Map<string, PlayerRow>();
    for (const p of players) m.set(p.id, p);
    return m;
  }, [players]);

  const series = useMemo(() => {
    const perPlayerTrend = perPlayer.map((q) => {
      if (q.status !== 'success' || !q.stats) return { categories: [] as string[], rolling: [] as number[] };
      return metricTrend(metric, q.stats);
    });

    const aligned = alignDailyTrends(
      perPlayerTrend.map(t => ({ categories: t.categories, values: t.rolling }))
    );

    return aligned.seriesData.map((data, i) => {
      const id = playerIds[i];
      const name = playerById.get(id)?.display_name ?? 'Unknown';
      return {
        type: 'spline' as const,
        name,
        data,
        color: getPlayerColor(i),
        lineWidth: 2.5,
        marker: { enabled: false },
        connectNulls: true,
      };
    });
  }, [metric, perPlayer, playerIds, playerById]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1">
            <CardTitle>Trend Comparison</CardTitle>
            <CardDescription>
              7-day rolling average{metricMeta.lowerIsBetter ? ' (lower is better)' : ''}
            </CardDescription>
          </div>
          <Select value={metric} onValueChange={(v) => setMetric(v as MetricKey)}>
            <SelectTrigger className="w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {METRICS.map(m => (
                <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        <Chart options={{
          title: { text: null },
          chart: { height: 420 },
          xAxis: {
            type: 'datetime',
            title: { text: 'Date' },
          },
          yAxis: {
            title: { text: metricMeta.label },
            ...(metric === 'checkoutRate' || metric === 'bustRate' || metric === 't20Grouping' ? { min: 0, max: 100 } : {}),
          },
          series,
          legend: { enabled: true },
          tooltip: {
            shared: true,
            valueDecimals: metricMeta.decimals,
            valueSuffix: metricMeta.suffix ?? '',
            xDateFormat: '%Y-%m-%d',
          },
        }} />
      </CardContent>
    </Card>
  );
}
