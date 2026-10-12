"use client";

import { useMemo, useState } from 'react';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { fetchShared } from '@/lib/shared/fetchShared';
import { computePlayerStatsBundle, loadPlayerStatsBundle, type PlayerStatsBundle } from '@/lib/stats/playerBundle';
import {
  fetchLegacyStatsGlobal,
  fetchStatsGlobalData,
  gamesPerDayFrom,
  overallStatsFrom,
  overviewFromLegacy,
  type StatsOverview,
} from '@/lib/stats/remote';
import type { DataLimitWarnings, PlayerRow, SummaryRow } from '@/lib/stats/types';

// --- Queries ---

/** Players, the summary view and the global totals: small and bounded, so it is restored on reload. */
export const statsGlobalQuery = () => queryOptions({
  queryKey: ['stats', 'global'],
  queryFn: () => fetchShared('stats-global', {}, fetchStatsGlobalData),
  meta: { persist: true },
});

/**
 * Everything the page shows for one player, computed on the server from their turns and darts:
 * tens of kilobytes of results (under 100 KB for a year of play) instead of the rows, so it is
 * restored on reload too. Shared with the Compare view's per-player queries.
 */
export const statsPlayerQuery = (playerId: string) => queryOptions({
  queryKey: ['stats', 'player', playerId],
  queryFn: (): Promise<PlayerStatsBundle> =>
    fetchShared('stats-player', { player: playerId }, () => loadPlayerStatsBundle(playerId)),
  enabled: !!playerId,
  meta: { persist: true },
  // Dropping players nobody has looked at for a while also drops them from storage, which holds
  // about 5 MB: browsing through every player shouldn't fill it.
  gcTime: 10 * 60_000,
});

/** The full history, only fetched while the stats functions are not deployed yet. Never persisted. */
const legacyStatsGlobalQuery = () => queryOptions({
  queryKey: ['stats', 'legacy-global'],
  queryFn: fetchLegacyStatsGlobal,
  gcTime: 10 * 60_000,
});

const EMPTY_SUMMARY: SummaryRow[] = [];
const EMPTY_PLAYERS: PlayerRow[] = [];
const NO_ROWS = { turns: [], throws: [], legs: [], matches: [], segments: [], adjacency: [] };
const EMPTY_OVERVIEW: StatsOverview = {
  totalMatches: 0, completedMatches: 0, totalLegs: 0, totalTurns: 0, totalThrows: 0, firstMatchAt: null, lastMatchAt: null,
};

// --- Hook ---

export function useStatsData() {
  const [selectedPlayer, setSelectedPlayer] = useState<string>('');
  const [activeView, setActiveView] = useState<'traditional' | 'elo' | 'compare'>('traditional');
  const [warningDismissed, setWarningDismissed] = useState(false);

  const globalQuery = useQuery(statsGlobalQuery());
  const playerQuery = useQuery(statsPlayerQuery(selectedPlayer));
  // The overview totals come from the full history until `stats_overview()` is deployed.
  const needsLegacy = globalQuery.data?.overview === null;
  const legacyQuery = useQuery({ ...legacyStatsGlobalQuery(), enabled: needsLegacy });
  const legacy = needsLegacy ? legacyQuery.data : undefined;

  const summary = globalQuery.data?.summary ?? EMPTY_SUMMARY;
  const players = globalQuery.data?.players ?? EMPTY_PLAYERS;
  // While a player loads, their tabs show zeros under the loading overlay, as before.
  const emptyPlayerStats = useMemo(
    () => (selectedPlayer ? computePlayerStatsBundle(selectedPlayer, NO_ROWS) : null),
    [selectedPlayer],
  );
  const playerStats = selectedPlayer ? playerQuery.data ?? emptyPlayerStats : null;

  const overview = useMemo(
    () => globalQuery.data?.overview ?? (legacy ? overviewFromLegacy(legacy) : EMPTY_OVERVIEW),
    [globalQuery.data, legacy],
  );
  const overallStats = useMemo(() => overallStatsFrom(overview), [overview]);
  const gamesPerDay = useMemo(() => gamesPerDayFrom(overview), [overview]);

  // Only the legacy paths truncate (at 100,000 rows); the stats functions return everything.
  const dataLimitWarnings: DataLimitWarnings = useMemo(() => {
    const THRESHOLD = 95000;
    const truncated = playerStats?.truncated;
    const legsWarning = (legacy?.legs.length ?? 0) >= THRESHOLD || !!truncated?.legs;
    const matchesWarning = (legacy?.matches.length ?? 0) >= THRESHOLD || !!truncated?.matches;
    const turnsWarning = !!truncated?.turns;

    return {
      anyWarning: legsWarning || matchesWarning || turnsWarning,
      message: [
        legsWarning && 'leg data',
        matchesWarning && 'match data',
        turnsWarning && 'player turn data'
      ].filter(Boolean).join(', ')
    };
  }, [legacy, playerStats]);

  const topAvgPlayers = useMemo(() => {
    return [...summary]
      .sort((a, b) => b.avg_per_turn - a.avg_per_turn)
      .slice(0, 8);
  }, [summary]);

  // Reset warning when player changes
  const handleSelectPlayer = (playerId: string) => {
    setWarningDismissed(false);
    setSelectedPlayer(playerId);
  };

  return {
    summary,
    players,
    selectedPlayer,
    setSelectedPlayer: handleSelectPlayer,
    loading: globalQuery.isLoading || (needsLegacy && legacyQuery.isLoading),
    // Only while there is nothing to show: a background refresh of cached data does not block the page.
    playerLoading: playerQuery.isPending && !!selectedPlayer,
    activeView,
    setActiveView,
    warningDismissed,
    setWarningDismissed,
    overallStats,
    gamesPerDay,
    dataLimitWarnings,
    topAvgPlayers,
    playerStats,
  };
}
