"use client";

import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';
import { statsPlayerQuery, useLegacyStatsGlobal, type PlayerDetailData } from '@/hooks/useStatsData';
import type { TurnRow, ThrowRow, LegRow, MatchRow } from '@/lib/stats/types';

export type PerPlayerStatsQuery = {
  playerId: string;
  status: 'loading' | 'success' | 'error';
  turns: TurnRow[];
  throws: ThrowRow[];
  /** The legs and matches this player's stats read (scoped by the database, or the full history). */
  legs: LegRow[];
  matches: MatchRow[];
};

const EMPTY_LEGS: LegRow[] = [];
const EMPTY_MATCHES: MatchRow[] = [];

/**
 * Runs one React Query per player for turn/throw detail data.
 *
 * Query key matches `useStatsData`'s single-player query (`['stats','player',id]`)
 * so cache is shared — switching between Compare and Performance views for a
 * player already loaded is free.
 */
type QueryState = { data: PlayerDetailData | undefined; isLoading: boolean; isError: boolean };

/** useQueries keeps this combined result stable while no query changes (the function is stable too). */
const combineQueries = (results: QueryState[]): QueryState[] =>
  results.map(({ data, isLoading, isError }) => ({ data, isLoading, isError }));

const EMPTY_TURNS: TurnRow[] = [];
const EMPTY_THROWS: ThrowRow[] = [];

export function useMultiPlayerStats(playerIds: string[]): PerPlayerStatsQuery[] {
  const queries = useQueries({
    queries: playerIds.map((id) => statsPlayerQuery(id)),
    combine: combineQueries,
  });
  const legacy = useLegacyStatsGlobal(queries.some((q) => q.data?.scoped === null));
  const playerKey = playerIds.join(',');

  // Memoised so the Compare view's per-player computations (which scan every turn and dart) only
  // re-run when a player's data actually changes, not on every render.
  return useMemo(() => queries.map((q, i): PerPlayerStatsQuery => {
    const data = q.data;
    const usesLegacy = data?.scoped === null;
    return {
      playerId: playerKey.split(',')[i],
      status: q.isLoading || (usesLegacy && legacy.isLoading) ? 'loading' : q.isError || (usesLegacy && legacy.isError) ? 'error' : 'success',
      turns: data?.turns ?? EMPTY_TURNS,
      throws: data?.throws ?? EMPTY_THROWS,
      legs: data?.scoped?.legs ?? (usesLegacy ? legacy.data?.legs : undefined) ?? EMPTY_LEGS,
      matches: data?.scoped?.matches ?? (usesLegacy ? legacy.data?.matches : undefined) ?? EMPTY_MATCHES,
    };
  }), [queries, playerKey, legacy.data, legacy.isLoading, legacy.isError]);
}
