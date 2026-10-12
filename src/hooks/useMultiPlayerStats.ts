"use client";

import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';
import { statsPlayerQuery } from '@/hooks/useStatsData';
import type { PlayerStatsBundle } from '@/lib/stats/playerBundle';

export type PerPlayerStatsQuery = {
  playerId: string;
  status: 'loading' | 'success' | 'error';
  /** The player's computed statistics, once loaded. */
  stats: PlayerStatsBundle | null;
};

type QueryState = { data: PlayerStatsBundle | undefined; isLoading: boolean; isError: boolean };

/** useQueries keeps this combined result stable while no query changes (the function is stable too). */
const combineQueries = (results: QueryState[]): QueryState[] =>
  results.map(({ data, isLoading, isError }) => ({ data, isLoading, isError }));

/**
 * Runs one React Query per player for their computed statistics.
 *
 * Query key matches `useStatsData`'s single-player query (`['stats','player',id]`)
 * so cache is shared — switching between Compare and Performance views for a
 * player already loaded is free.
 */
export function useMultiPlayerStats(playerIds: string[]): PerPlayerStatsQuery[] {
  const queries = useQueries({
    queries: playerIds.map((id) => statsPlayerQuery(id)),
    combine: combineQueries,
  });
  const playerKey = playerIds.join(',');

  return useMemo(() => queries.map((q, i): PerPlayerStatsQuery => ({
    playerId: playerKey.split(',')[i],
    status: q.isLoading ? 'loading' : q.isError ? 'error' : 'success',
    stats: q.data ?? null,
  })), [queries, playerKey]);
}
