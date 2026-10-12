"use client";

import { useMemo, useState } from 'react';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { computePlayerCoreStats } from '@/lib/stats/computations';
import {
  fetchLegacyStatsGlobal,
  fetchPlayerDetailData,
  fetchStatsGlobalData,
  gamesPerDayFrom,
  overallStatsFrom,
  overviewFromLegacy,
  type PlayerDetailData,
  type StatsOverview,
} from '@/lib/stats/remote';
import type {
  PlayerCoreStats, DataLimitWarnings, LegRow, MatchRow, PlayerSegmentRow, PlayerAdjacencyRow, PlayerRow, SummaryRow, TurnRow, ThrowRow,
} from '@/lib/stats/types';

export { fetchPlayerDetailData, type PlayerDetailData };

// --- Queries ---

/** Players, the summary view and the global totals: small and bounded, so it is restored on reload. */
export const statsGlobalQuery = () => queryOptions({
  queryKey: ['stats', 'global'],
  queryFn: fetchStatsGlobalData,
  meta: { persist: true },
});

/** One player's turns, darts, legs and matches. Shared with the Compare view's per-player queries. */
export const statsPlayerQuery = (playerId: string) => queryOptions({
  queryKey: ['stats', 'player', playerId],
  queryFn: () => fetchPlayerDetailData(playerId),
  enabled: !!playerId,
  staleTime: 5 * 60_000,
});

/** The full history, only fetched while the stats functions are not deployed yet. Never persisted. */
const legacyStatsGlobalQuery = () => queryOptions({
  queryKey: ['stats', 'legacy-global'],
  queryFn: fetchLegacyStatsGlobal,
});

/** The full history while the database has no stats functions yet; nothing otherwise. */
export function useLegacyStatsGlobal(needed: boolean) {
  return useQuery({ ...legacyStatsGlobalQuery(), enabled: needed });
}

const EMPTY_SUMMARY: SummaryRow[] = [];
const EMPTY_PLAYERS: PlayerRow[] = [];
const EMPTY_TURNS: TurnRow[] = [];
const EMPTY_THROWS: ThrowRow[] = [];
const EMPTY_LEGS: LegRow[] = [];
const EMPTY_MATCHES: MatchRow[] = [];
const EMPTY_SEGMENTS: PlayerSegmentRow[] = [];
const EMPTY_ADJACENCY: PlayerAdjacencyRow[] = [];
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
  const needsLegacy = globalQuery.data?.overview === null || playerQuery.data?.scoped === null;
  const legacyQuery = useLegacyStatsGlobal(needsLegacy);
  const legacy = needsLegacy ? legacyQuery.data : undefined;

  const summary = globalQuery.data?.summary ?? EMPTY_SUMMARY;
  const players = globalQuery.data?.players ?? EMPTY_PLAYERS;
  const turns = playerQuery.data?.turns ?? EMPTY_TURNS;
  const throws = playerQuery.data?.throws ?? EMPTY_THROWS;
  const scoped = playerQuery.data?.scoped;
  // The selected player's legs and matches: scoped by the database, or the full history (legacy).
  const legs = scoped?.legs ?? legacy?.legs ?? EMPTY_LEGS;
  const matches = scoped?.matches ?? legacy?.matches ?? EMPTY_MATCHES;
  const playerSegments = scoped?.segments ?? legacy?.playerSegments ?? EMPTY_SEGMENTS;
  const playerAdjacency = scoped?.adjacency ?? legacy?.playerAdjacency ?? EMPTY_ADJACENCY;

  const overview = useMemo(
    () => globalQuery.data?.overview ?? (legacy ? overviewFromLegacy(legacy) : EMPTY_OVERVIEW),
    [globalQuery.data, legacy],
  );
  const overallStats = useMemo(() => overallStatsFrom(overview), [overview]);
  const gamesPerDay = useMemo(() => gamesPerDayFrom(overview), [overview]);

  // Only the legacy path truncates (at 100,000 rows); the stats functions return everything.
  const dataLimitWarnings: DataLimitWarnings = useMemo(() => {
    const THRESHOLD = 95000;
    const legsWarning = (legacy?.legs.length ?? 0) >= THRESHOLD;
    const matchesWarning = (legacy?.matches.length ?? 0) >= THRESHOLD;
    const turnsWarning = selectedPlayer && scoped === null ? turns.length >= THRESHOLD : false;

    return {
      anyWarning: legsWarning || matchesWarning || turnsWarning,
      message: [
        legsWarning && 'leg data',
        matchesWarning && 'match data',
        turnsWarning && 'player turn data'
      ].filter(Boolean).join(', ')
    };
  }, [legacy, scoped, turns.length, selectedPlayer]);

  const topAvgPlayers = useMemo(() => {
    return [...summary]
      .sort((a, b) => b.avg_per_turn - a.avg_per_turn)
      .slice(0, 8);
  }, [summary]);

  const playerCoreStats: PlayerCoreStats | null = useMemo(() => {
    if (!selectedPlayer) return null;
    return computePlayerCoreStats(selectedPlayer, turns, throws, legs, matches);
  }, [selectedPlayer, turns, throws, legs, matches]);

  // Reset warning when player changes
  const handleSelectPlayer = (playerId: string) => {
    setWarningDismissed(false);
    setSelectedPlayer(playerId);
  };

  return {
    summary,
    players,
    legs,
    matches,
    playerSegments,
    playerAdjacency,
    selectedPlayer,
    setSelectedPlayer: handleSelectPlayer,
    loading: globalQuery.isLoading || (needsLegacy && legacyQuery.isLoading),
    playerLoading: (playerQuery.isFetching || (needsLegacy && legacyQuery.isFetching)) && !!selectedPlayer,
    activeView,
    setActiveView,
    warningDismissed,
    setWarningDismissed,
    overallStats,
    gamesPerDay,
    dataLimitWarnings,
    topAvgPlayers,
    playerCoreStats,
  };
}
