"use client";

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { getSupabaseClient } from '@/lib/supabaseClient';
import type {
  PressurePlayerHistoryProfile,
  PressurePopulationProfile,
} from '@/utils/pressureProfiles';
import type { FinishRule } from '@/utils/x01';

type PlayerProfileRow = {
  player_id: string;
  finish_rule: FinishRule;
  matches_played: number | string | null;
  visits: number | string | null;
  darts_thrown: number | string | null;
  scoring_points: number | string | null;
  three_dart_average: number | string | null;
  busts: number | string | null;
  bust_rate: number | string | null;
  checkout_opportunities: number | string | null;
  checkouts: number | string | null;
  checkout_rate: number | string | null;
};

type PopulationProfileRow = Omit<PlayerProfileRow, 'player_id' | 'matches_played'> & {
  player_match_samples: number | string | null;
};

function numeric(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeBase(row: PlayerProfileRow | PopulationProfileRow) {
  return {
    finishRule: row.finish_rule,
    visits: numeric(row.visits),
    dartsThrown: numeric(row.darts_thrown),
    scoringPoints: numeric(row.scoring_points),
    threeDartAverage: numeric(row.three_dart_average),
    busts: numeric(row.busts),
    bustRate: numeric(row.bust_rate),
    checkoutOpportunities: numeric(row.checkout_opportunities),
    checkouts: numeric(row.checkouts),
    checkoutRate: numeric(row.checkout_rate),
  };
}

export function normalizePlayerPressureProfile(row: PlayerProfileRow): PressurePlayerHistoryProfile {
  return {
    playerId: row.player_id,
    matchesPlayed: numeric(row.matches_played),
    ...normalizeBase(row),
  };
}

export function normalizePopulationPressureProfile(
  row: PopulationProfileRow
): PressurePopulationProfile {
  return {
    matchesPlayed: numeric(row.player_match_samples),
    ...normalizeBase(row),
  };
}

type PressureProfilesResult = {
  playerProfiles: PressurePlayerHistoryProfile[];
  populationProfile?: PressurePopulationProfile;
};

async function fetchPressureProfiles(
  playerIds: string[],
  finishRule: FinishRule
): Promise<PressureProfilesResult> {
  const supabase = await getSupabaseClient();
  const [playersResult, populationResult] = await Promise.all([
    supabase
      .from('player_pressure_profiles')
      .select('*')
      .eq('finish_rule', finishRule)
      .in('player_id', playerIds),
    supabase
      .from('pressure_population_profiles')
      .select('*')
      .eq('finish_rule', finishRule)
      .maybeSingle(),
  ]);

  if (playersResult.error) throw playersResult.error;
  if (populationResult.error) throw populationResult.error;

  return {
    playerProfiles: ((playersResult.data ?? []) as PlayerProfileRow[])
      .map(normalizePlayerPressureProfile),
    populationProfile: populationResult.data
      ? normalizePopulationPressureProfile(populationResult.data as PopulationProfileRow)
      : undefined,
  };
}

export function usePressureProfiles(playerIds: string[], finishRule: FinishRule) {
  const playerIdsKey = playerIds.slice().sort().join(',');
  const query = useQuery({
    queryKey: ['pressure-profiles', finishRule, playerIdsKey],
    queryFn: () => fetchPressureProfiles(playerIdsKey.split(',').filter(Boolean), finishRule),
    enabled: playerIds.length > 0,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const profilesByPlayerId = useMemo(
    () => new Map(
      (query.data?.playerProfiles ?? []).map((profile) => [profile.playerId, profile])
    ),
    [query.data?.playerProfiles]
  );

  return {
    profilesByPlayerId,
    populationProfile: query.data?.populationProfile,
    hasPersonalProfiles: profilesByPlayerId.size > 0,
    isLoading: query.isLoading,
  };
}
