"use client";

import { useQueries } from '@tanstack/react-query';
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
export function useMultiPlayerStats(playerIds: string[]): PerPlayerStatsQuery[] {
  const queries = useQueries({
    queries: playerIds.map((id) => statsPlayerQuery(id)),
  });
  const details = queries.map((q) => q.data as PlayerDetailData | undefined);
  const legacy = useLegacyStatsGlobal(details.some((data) => data?.scoped === null));

  return queries.map((q, i): PerPlayerStatsQuery => {
    const data = details[i];
    const usesLegacy = data?.scoped === null;
    return {
      playerId: playerIds[i],
      status: q.isLoading || (usesLegacy && legacy.isLoading) ? 'loading' : q.isError || (usesLegacy && legacy.isError) ? 'error' : 'success',
      turns: data?.turns ?? [],
      throws: data?.throws ?? [],
      legs: data?.scoped?.legs ?? (usesLegacy ? legacy.data?.legs : undefined) ?? EMPTY_LEGS,
      matches: data?.scoped?.matches ?? (usesLegacy ? legacy.data?.matches : undefined) ?? EMPTY_MATCHES,
    };
  });
}
