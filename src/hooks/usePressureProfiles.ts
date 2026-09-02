"use client";

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { getSupabaseClient } from '@/lib/supabaseClient';
import type {
  PressurePlayerHistoryProfile,
  PressurePlayerProfileRow,
  PressurePopulationProfile,
  PressurePopulationProfileRow,
} from '@/utils/pressureProfiles';
import {
  normalizePlayerPressureProfile,
  normalizePopulationPressureProfile,
} from '@/utils/pressureProfiles';
export {
  normalizePlayerPressureProfile,
  normalizePopulationPressureProfile,
} from '@/utils/pressureProfiles';
import type { FinishRule } from '@/utils/x01';

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
    playerProfiles: ((playersResult.data ?? []) as PressurePlayerProfileRow[])
      .map(normalizePlayerPressureProfile),
    populationProfile: populationResult.data
      ? normalizePopulationPressureProfile(populationResult.data as PressurePopulationProfileRow)
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
