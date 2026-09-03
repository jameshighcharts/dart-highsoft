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
import type {
  PressureOutcomeModel,
  PressureOutcomeObservation,
  PressureOutcomeObservationRow,
} from '@/utils/pressureOutcomeModel';
import {
  createBehavioralOutcomeModel,
  normalizePressureOutcomeObservation,
} from '@/utils/pressureOutcomeModel';

type PressureProfilesResult = {
  playerProfiles: PressurePlayerHistoryProfile[];
  populationProfile?: PressurePopulationProfile;
  playerOutcomes: Array<PressureOutcomeObservation & { playerId: string }>;
  populationOutcomes: PressureOutcomeObservation[];
};

async function fetchPressureProfiles(
  playerIds: string[],
  finishRule: FinishRule
): Promise<PressureProfilesResult> {
  const supabase = await getSupabaseClient();
  const [playersResult, populationResult, playerOutcomesResult, populationOutcomesResult] = await Promise.all([
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
    supabase
      .from('player_pressure_outcomes')
      .select('*')
      .eq('finish_rule', finishRule)
      .in('player_id', playerIds),
    supabase
      .from('pressure_population_outcomes')
      .select('*')
      .eq('finish_rule', finishRule),
  ]);

  if (playersResult.error) throw playersResult.error;
  if (populationResult.error) throw populationResult.error;
  if (playerOutcomesResult.error) throw playerOutcomesResult.error;
  if (populationOutcomesResult.error) throw populationOutcomesResult.error;

  return {
    playerProfiles: ((playersResult.data ?? []) as PressurePlayerProfileRow[])
      .map(normalizePlayerPressureProfile),
    populationProfile: populationResult.data
      ? normalizePopulationPressureProfile(populationResult.data as PressurePopulationProfileRow)
      : undefined,
    playerOutcomes: ((playerOutcomesResult.data ?? []) as PressureOutcomeObservationRow[])
      .filter((row): row is PressureOutcomeObservationRow & { player_id: string } =>
        typeof row.player_id === 'string'
      )
      .map((row) => ({
        ...normalizePressureOutcomeObservation(row),
        playerId: row.player_id,
      })),
    populationOutcomes: ((populationOutcomesResult.data ?? []) as PressureOutcomeObservationRow[])
      .map(normalizePressureOutcomeObservation),
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
  const outcomeModelsByPlayerId = useMemo<ReadonlyMap<string, PressureOutcomeModel>>(() => {
    const personalByPlayer = new Map<string, PressureOutcomeObservation[]>();
    for (const observation of query.data?.playerOutcomes ?? []) {
      const existing = personalByPlayer.get(observation.playerId) ?? [];
      existing.push(observation);
      personalByPlayer.set(observation.playerId, existing);
    }
    return new Map(playerIdsKey.split(',').filter(Boolean).map((playerId) => [
      playerId,
      createBehavioralOutcomeModel({
        personal: personalByPlayer.get(playerId),
        population: query.data?.populationOutcomes,
      }),
    ]));
  }, [playerIdsKey, query.data?.playerOutcomes, query.data?.populationOutcomes]);

  return {
    profilesByPlayerId,
    populationProfile: query.data?.populationProfile,
    outcomeModelsByPlayerId,
    hasPersonalProfiles: profilesByPlayerId.size > 0,
    isLoading: query.isLoading,
  };
}
