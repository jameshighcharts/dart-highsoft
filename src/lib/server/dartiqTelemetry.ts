import 'server-only';

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import { hasCheckoutRoute } from '@/lib/dartiq/checkout';
import {
  createBehavioralOutcomeModel,
  DARTIQ_OUTCOME_CONFIGURATION,
  DARTIQ_OUTCOME_MODEL_VERSION,
  type DartIQOutcomeModel,
} from '@/lib/dartiq/model/outcomes';
import { DARTIQ_PROJECTION_CONFIGURATION } from '@/lib/dartiq/projection';
import { reconstructDartIQTimeline, type DartIQDartEvent } from '@/lib/dartiq/replay';
import { loadMatchData } from '@/lib/match/loadMatchData';
import type { FinishRule } from '@/utils/x01';
import type { TurnWithThrows } from '@/lib/match/types';
import { loadFrozenDartIQEvidence } from './dartiqEvidence';

const MODEL_KEY = 'dartiq';
const IMPLEMENTATION_MANIFEST = Object.freeze({
  outcome: DARTIQ_OUTCOME_MODEL_VERSION,
  visit: 'behavioral-visit-1',
  race: 'ordered-visit-race-1',
  match: 'alternating-starter-1',
  fairEnding: 'identity-joiners-1',
});
const MODEL_CONFIGURATION = Object.freeze({
  outcome: DARTIQ_OUTCOME_CONFIGURATION,
  projection: DARTIQ_PROJECTION_CONFIGURATION,
});

type EvidenceRow = { id: number; player_id?: string; content_hash: string };

function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function scoreBand(score: number, tiebreak: boolean) {
  if (tiebreak) return 'tiebreak';
  if (score <= 0) return 'finished';
  if (score <= 40) return '1_40';
  if (score <= 60) return '41_60';
  if (score <= 100) return '61_100';
  if (score <= 170) return '101_170';
  if (score <= 230) return '171_230';
  return '231_plus';
}

function checkoutState(event: DartIQDartEvent, finishRule: FinishRule) {
  const phase = event.fairEndingBefore?.phase;
  if (phase === 'resolved') return 'resolved';
  if (phase === 'tiebreak') return 'tiebreak';
  if (phase === 'completing_round') return 'waiting';
  const score = event.before.scores[event.playerId] ?? 0;
  if (hasCheckoutRoute(score, 3, finishRule)) return 'available';
  if (score <= 170) return 'bogey';
  return 'none';
}

function outcomeDistribution(
  model: DartIQOutcomeModel,
  event: DartIQDartEvent,
  playerId: string,
  finishRule: FinishRule
) {
  const dartsLeft = playerId === event.playerId
    ? Math.min(3, Math.max(1, event.before.dartsRemainingInTurn)) as 1 | 2 | 3
    : 3;
  return model.distribution({
    currentScore: event.before.scores[playerId] ?? 0,
    dartsLeft,
    finishRule,
  });
}

async function loadModelVersionId(supabase: SupabaseClient) {
  const implementationHash = hash(IMPLEMENTATION_MANIFEST);
  const configurationHash = hash(MODEL_CONFIGURATION);
  const existing = await supabase
    .from('dartiq_model_versions')
    .select('id')
    .eq('implementation_hash', implementationHash)
    .eq('configuration_hash', configurationHash)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) return existing.data.id as number;

  const inserted = await supabase
    .from('dartiq_model_versions')
    .insert({
      model_key: MODEL_KEY,
      implementation_hash: implementationHash,
      configuration: MODEL_CONFIGURATION,
      configuration_hash: configurationHash,
      outcome_model_version: DARTIQ_OUTCOME_MODEL_VERSION,
      evidence_schema_version: 1,
    })
    .select('id')
    .single();
  if (inserted.error || !inserted.data) {
    // A concurrent finalizer may have inserted the immutable row first.
    const raced = await supabase
      .from('dartiq_model_versions')
      .select('id')
      .eq('implementation_hash', implementationHash)
      .eq('configuration_hash', configurationHash)
      .single();
    if (raced.error || !raced.data) throw new Error(inserted.error?.message ?? raced.error?.message);
    return raced.data.id as number;
  }
  return inserted.data.id as number;
}

async function persistResolutions(
  supabase: SupabaseClient,
  input: {
    matchId: string;
    legId: string;
    legWinnerId: string | null;
    matchWinnerId: string | null;
    endedEarly: boolean;
    resolvedAt: string;
  }
) {
  const desired = [
    input.legWinnerId ? { kind: 'leg', leg_id: input.legId, winner_player_id: input.legWinnerId } : null,
    input.matchWinnerId ? { kind: 'match', leg_id: null, winner_player_id: input.matchWinnerId } : null,
  ].filter(Boolean) as Array<{ kind: 'leg' | 'match'; leg_id: string | null; winner_player_id: string }>;

  for (const resolution of desired) {
    let query = supabase
      .from('dartiq_projection_resolutions')
      .select('id, winner_player_id')
      .eq('match_id', input.matchId)
      .eq('kind', resolution.kind)
      .is('superseded_at', null);
    query = resolution.leg_id ? query.eq('leg_id', resolution.leg_id) : query.is('leg_id', null);
    const active = await query.maybeSingle();
    if (active.error) throw new Error(active.error.message);
    if (active.data?.winner_player_id === resolution.winner_player_id) continue;
    if (active.data) {
      const superseded = await supabase
        .from('dartiq_projection_resolutions')
        .update({ superseded_at: input.resolvedAt })
        .eq('id', active.data.id);
      if (superseded.error) throw new Error(superseded.error.message);
    }
    const inserted = await supabase.from('dartiq_projection_resolutions').insert({
      match_id: input.matchId,
      leg_id: resolution.leg_id,
      kind: resolution.kind,
      winner_player_id: resolution.winner_player_id,
      ended_early: input.endedEarly,
      resolved_at: input.resolvedAt,
    });
    if (inserted.error) throw new Error(inserted.error.message);
  }
}

/**
 * Reconstruct and persist one completed leg as a small number of batch writes.
 * Live capture is explicitly labelled unsupported because this evidence is
 * reconstructed at leg completion rather than captured by a live tracker.
 */
export async function persistDartIQCompletedLeg(
  supabase: SupabaseClient,
  matchId: string,
  legId: string
) {
  const [data, evidence, populationEvidenceResult, playerEvidenceResult, modelVersionId] =
    await Promise.all([
      loadMatchData(supabase, matchId, { includeTurnsByLegThrows: true }),
      loadFrozenDartIQEvidence(supabase, matchId),
      supabase
        .from('dartiq_population_evidence')
        .select('id, content_hash')
        .eq('match_id', matchId)
        .maybeSingle(),
      supabase
        .from('dartiq_player_evidence')
        .select('id, player_id, content_hash')
        .eq('match_id', matchId),
      loadModelVersionId(supabase),
    ]);
  if (populationEvidenceResult.error) throw new Error(populationEvidenceResult.error.message);
  if (playerEvidenceResult.error) throw new Error(playerEvidenceResult.error.message);
  if (!data.match || !evidence || !populationEvidenceResult.data) return { persisted: 0, skipped: 'evidence_missing' };

  const playerIds = data.players.map((player) => player.id);
  const evidenceByPlayer = new Map(
    ((playerEvidenceResult.data ?? []) as EvidenceRow[]).map((row) => [row.player_id!, row])
  );
  if (playerIds.some((playerId) => !evidenceByPlayer.has(playerId))) {
    return { persisted: 0, skipped: 'player_evidence_missing' };
  }
  const personalOutcomes = new Map<string, typeof evidence.populationOutcomes>();
  for (const observation of evidence.playerOutcomes) {
    const values = personalOutcomes.get(observation.playerId) ?? [];
    values.push(observation);
    personalOutcomes.set(observation.playerId, values);
  }
  const models = Object.fromEntries(playerIds.map((playerId) => [
    playerId,
    createBehavioralOutcomeModel({
      personal: personalOutcomes.get(playerId),
      population: evidence.populationOutcomes,
    }),
  ]));
  const timeline = reconstructDartIQTimeline({
    playerIds,
    legs: data.legs,
    turnsByLeg: data.turnsByLeg as Record<string, TurnWithThrows[]>,
    startScore: Number(data.match.start_score),
    finishRule: data.match.finish,
    legsToWin: data.match.legs_to_win,
    playerProfiles: Object.fromEntries(evidence.playerProfiles.map((profile) => [profile.playerId, profile])),
    populationProfile: evidence.populationProfile,
    outcomeModels: models,
    fairEnding: Boolean(data.match.fair_ending),
  });
  const events = timeline.filter((event) => event.legId === legId);
  if (events.length === 0) return { persisted: 0, skipped: 'no_darts' };

  const inputSnapshotFor = (event: DartIQDartEvent) => ({
    scores: event.before.scores,
    legsWon: event.before.legsWon,
    currentPlayerId: event.before.currentPlayerId,
    dartsRemainingInTurn: event.before.dartsRemainingInTurn,
    fairEnding: event.fairEndingBefore,
    populationEvidenceHash: (populationEvidenceResult.data as EvidenceRow).content_hash,
    playerEvidenceHashes: Object.fromEntries(
      playerIds.map((playerId) => [playerId, evidenceByPlayer.get(playerId)!.content_hash])
    ),
  });

  const revisionHash = hash(events.map((event) => ({
    dartId: event.dartId,
    preStateHash: hash(inputSnapshotFor(event)),
    segment: event.segment,
    scored: event.scored,
    busted: event.busted,
    checkedOut: event.checkedOut,
  })));
  const computedAt = new Date().toISOString();

  const eventRows = events.map((event) => {
    const actorModel = models[event.playerId];
    const tiebreak = event.fairEndingBefore?.phase === 'tiebreak';
    const actorDistribution = tiebreak
      ? null
      : outcomeDistribution(actorModel, event, event.playerId, data.match!.finish);
    const inputSnapshot = inputSnapshotFor(event);
    return {
      schema_version: 1,
      match_id: matchId,
      leg_id: legId,
      throw_id: event.dartId,
      source_throw_id: event.dartId,
      model_version_id: modelVersionId,
      population_evidence_id: (populationEvidenceResult.data as EvidenceRow).id,
      acting_player_id: event.playerId,
      provenance: 'reconstructed',
      live_capture_status: 'not_supported',
      live_capture_cause: 'completed_leg_reconstruction',
      sequence: event.sequence,
      pre_state_hash: hash(inputSnapshot),
      input_snapshot: inputSnapshot,
      finish_rule: data.match!.finish,
      player_count: playerIds.length,
      score_before: event.before.scores[event.playerId] ?? 0,
      score_band: scoreBand(event.before.scores[event.playerId] ?? 0, Boolean(tiebreak)),
      checkout_state: checkoutState(event, data.match!.finish),
      confidence_tier: actorDistribution?.confidenceTier ?? 'fallback',
      outcome_model_applicable: !tiebreak,
      approximation_modes: event.fairEndingBefore?.approximationMode === 'fair-ending-weighted'
        ? ['fair-ending-weighted']
        : [],
      actual_score_delta: event.scored,
      actual_is_double: event.segment === 'DB' || event.segment.startsWith('D'),
      busted: event.busted,
      actual_outcome: {
        segment: event.segment,
        scored: event.scored,
        turnScoreAfter: event.turnScoreAfter,
        busted: event.busted,
        checkedOut: event.checkedOut,
      },
      computed_at: computedAt,
    };
  });
  const playerValues = events.flatMap((event) => playerIds.map((playerId) => {
    const before = event.before.projections.find((projection) => projection.id === playerId)!;
    const after = event.after.projections.find((projection) => projection.id === playerId)!;
    const tiebreak = event.fairEndingBefore?.phase === 'tiebreak';
    const distribution = tiebreak
      ? null
      : outcomeDistribution(models[playerId], event, playerId, data.match!.finish);
    return {
      source_throw_id: event.dartId,
      player_id: playerId,
      player_evidence_id: evidenceByPlayer.get(playerId)!.id,
      leg_probability_before: before.legWinProbability,
      leg_probability_after: after.legWinProbability,
      match_probability_before: before.matchWinProbability,
      match_probability_after: after.matchWinProbability,
      expected_finish_summary: tiebreak
        ? { applicable: false }
        : {
            applicable: true,
            expectedDartsBefore: before.expectedDartsRemaining,
            expectedDartsAfter: after.expectedDartsRemaining,
          },
      state_bucket: `${scoreBand(event.before.scores[playerId] ?? 0, event.fairEndingBefore?.phase === 'tiebreak')}:${event.before.dartsRemainingInTurn}`,
      confidence_tier: distribution?.confidenceTier ?? 'fallback',
      backoff_level: distribution
        ? `${distribution.stateBackoffLevel}:${distribution.outcomeBackoffLevel}`
        : 'not_applicable',
    };
  }));

  const replaced = await supabase.rpc('replace_dartiq_leg_projection_events', {
    p_match_id: matchId,
    p_leg_id: legId,
    p_model_version_id: modelVersionId,
    p_provenance: 'reconstructed',
    p_revision_hash: revisionHash,
    p_replaced_at: computedAt,
    p_events: eventRows,
    p_player_projections: playerValues,
  });
  if (replaced.error) throw new Error(replaced.error.message);

  const leg = data.legs.find((candidate) => candidate.id === legId);
  await persistResolutions(supabase, {
    matchId,
    legId,
    legWinnerId: leg?.winner_player_id ?? null,
    matchWinnerId: data.match.winner_player_id ?? null,
    endedEarly: Boolean(data.match.ended_early),
    resolvedAt: computedAt,
  });
  return { persisted: events.length, skipped: null };
}
