"use client";

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import type {
  DartIQPlayerHistoryProfile,
  DartIQPopulationProfile,
} from '@/lib/dartiq/evidence';
import type { FinishRule } from '@/utils/x01';
import type {
  DartIQOutcomeModel,
  DartIQOutcomeObservation,
} from '@/lib/dartiq/model/outcomes';
import { createBehavioralOutcomeModel } from '@/lib/dartiq/model/outcomes';

type DartIQProfilesResult = {
  playerProfiles: DartIQPlayerHistoryProfile[];
  populationProfile?: DartIQPopulationProfile;
  playerOutcomes: Array<DartIQOutcomeObservation & { playerId: string }>;
  populationOutcomes: DartIQOutcomeObservation[];
};

async function fetchDartIQEvidence(
  matchId: string,
  playerIds: string[]
): Promise<DartIQProfilesResult> {
  if (playerIds.length === 0) {
    return { playerProfiles: [], playerOutcomes: [], populationOutcomes: [] };
  }
  const response = await fetch(`/api/matches/${matchId}/dartiq/evidence`);
  if (response.status === 404) {
    return { playerProfiles: [], playerOutcomes: [], populationOutcomes: [] };
  }
  if (!response.ok) throw new Error('Could not load frozen DartIQ evidence');
  return response.json() as Promise<DartIQProfilesResult>;
}

export function useDartIQ(matchId: string, playerIds: string[], finishRule: FinishRule) {
  const playerIdsKey = playerIds.slice().sort().join(',');
  const query = useQuery({
    queryKey: ['dartiq-evidence', matchId, finishRule, playerIdsKey],
    queryFn: () => fetchDartIQEvidence(
      matchId,
      playerIdsKey.split(',').filter(Boolean)
    ),
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
  const outcomeModelsByPlayerId = useMemo<ReadonlyMap<string, DartIQOutcomeModel>>(() => {
    const personalByPlayer = new Map<string, DartIQOutcomeObservation[]>();
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
