import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { DARTIQ_TRAINING_VERSION, type DartIQModelDeployment } from '@/lib/dartiq/model/training';

import {
  normalizeDartIQPlayerProfile,
  normalizeDartIQPopulationProfile,
  type DartIQHistoricalFact,
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
  modelDeployment?: DartIQModelDeployment;
  profile: DartIQPlayerProfileRow | DartIQPopulationProfileRow | null;
  outcomes: DartIQOutcomeObservationRow[];
  historicalFacts?: DartIQHistoricalFact[];
  historicalFactsCutoffAt?: string;
};

export type FrozenDartIQEvidenceRows = {
  population: { raw_evidence: FrozenRawEvidence } | null;
  players: Array<{ player_id: string; raw_evidence: FrozenRawEvidence }>;
};

export type FrozenDartIQEvidence = {
  modelDeployment?: DartIQModelDeployment;
  playerProfiles: DartIQPlayerHistoryProfile[];
  populationProfile?: DartIQPopulationProfile;
  playerOutcomes: Array<DartIQOutcomeObservation & { playerId: string }>;
  populationOutcomes: DartIQOutcomeObservation[];
  historicalFacts: DartIQHistoricalFact[];
  historicalFactsCutoffAt: string | null;
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
  matchId: string,
  rows?: FrozenDartIQEvidenceRows,
): Promise<FrozenDartIQEvidence | null> {
  const [populationResult, playersResult] = rows ? [
    { data: rows.population, error: null },
    { data: rows.players, error: null },
  ] : await Promise.all([
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
    modelDeployment: population.modelDeployment?.artifact.version === DARTIQ_TRAINING_VERSION
      ? population.modelDeployment : undefined,
    playerProfiles,
    populationProfile: population.profile
      ? normalizeDartIQPopulationProfile(population.profile as DartIQPopulationProfileRow)
      : undefined,
    playerOutcomes,
    populationOutcomes: (population.outcomes ?? []).map(normalizeDartIQOutcomeObservation),
    historicalFacts: (population.historicalFacts ?? []).filter((fact) => (
      (fact.kind === 'player_history' || fact.kind === 'matchup_history')
      && typeof fact.subjectPlayerId === 'string'
      && (fact.counterpartPlayerId === null || typeof fact.counterpartPlayerId === 'string')
      && Number.isFinite(fact.support)
      && ['thin', 'supported', 'strong'].includes(fact.confidenceTier)
      && fact.evidence !== null
      && typeof fact.evidence === 'object'
      && !Array.isArray(fact.evidence)
    )),
    historicalFactsCutoffAt: typeof population.historicalFactsCutoffAt === 'string'
      ? population.historicalFactsCutoffAt
      : null,
  };
}
