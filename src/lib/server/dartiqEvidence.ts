import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  normalizeDartIQPlayerProfile,
  normalizeDartIQPopulationProfile,
  type DartIQPlayerHistoryProfile,
  type DartIQPlayerProfileRow,
  type DartIQPopulationProfile,
  type DartIQPopulationProfileRow,
} from '@/lib/dartiq/evidence';
import {
  normalizeDartIQOutcomeObservation,
  type DartIQOutcomeObservation,
  type DartIQOutcomeObservationRow,
} from '@/lib/dartiq/model/outcomes';

type FrozenRawEvidence = {
  profile: DartIQPlayerProfileRow | DartIQPopulationProfileRow | null;
  outcomes: DartIQOutcomeObservationRow[];
};

export type FrozenDartIQEvidence = {
  playerProfiles: DartIQPlayerHistoryProfile[];
  populationProfile?: DartIQPopulationProfile;
  playerOutcomes: Array<DartIQOutcomeObservation & { playerId: string }>;
  populationOutcomes: DartIQOutcomeObservation[];
};

export async function captureDartIQMatchEvidence(
  supabase: SupabaseClient,
  matchId: string
) {
  const { error } = await supabase.rpc('capture_dartiq_match_evidence', {
    p_match_id: matchId,
  });
  if (error) throw new Error(error.message);
}

export async function loadFrozenDartIQEvidence(
  supabase: SupabaseClient,
  matchId: string
): Promise<FrozenDartIQEvidence | null> {
  const [populationResult, playersResult] = await Promise.all([
    supabase
      .from('dartiq_population_evidence')
      .select('raw_evidence')
      .eq('match_id', matchId)
      .maybeSingle(),
    supabase
      .from('dartiq_player_evidence')
      .select('player_id, raw_evidence')
      .eq('match_id', matchId),
  ]);
  if (populationResult.error) throw new Error(populationResult.error.message);
  if (playersResult.error) throw new Error(playersResult.error.message);
  if (!populationResult.data) return null;

  const population = populationResult.data.raw_evidence as FrozenRawEvidence;
  const playerProfiles: DartIQPlayerHistoryProfile[] = [];
  const playerOutcomes: FrozenDartIQEvidence['playerOutcomes'] = [];
  for (const row of playersResult.data ?? []) {
    const evidence = row.raw_evidence as FrozenRawEvidence;
    if (evidence.profile) {
      playerProfiles.push(normalizeDartIQPlayerProfile(
        evidence.profile as DartIQPlayerProfileRow
      ));
    }
    for (const outcome of evidence.outcomes ?? []) {
      playerOutcomes.push({
        ...normalizeDartIQOutcomeObservation(outcome),
        playerId: row.player_id as string,
      });
    }
  }

  return {
    playerProfiles,
    populationProfile: population.profile
      ? normalizeDartIQPopulationProfile(population.profile as DartIQPopulationProfileRow)
      : undefined,
    playerOutcomes,
    populationOutcomes: (population.outcomes ?? []).map(normalizeDartIQOutcomeObservation),
  };
}
