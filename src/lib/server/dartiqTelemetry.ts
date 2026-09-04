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
const DEPLOYMENT_REVISION = process.env.VERCEL_GIT_COMMIT_SHA
  ?? process.env.RAILWAY_GIT_COMMIT_SHA
  ?? process.env.GITHUB_SHA
  ?? 'development';

type EvidenceRow = { id: number; player_id?: string; content_hash: string };
type LoadedMatchData = Awaited<ReturnType<typeof loadMatchData>>;

type DartIQTelemetryContext = {
  data: Omit<LoadedMatchData, 'match'> & { match: NonNullable<LoadedMatchData['match']> };
  evidence: NonNullable<Awaited<ReturnType<typeof loadFrozenDartIQEvidence>>>;
  populationEvidence: EvidenceRow;
  evidenceByPlayer: Map<string, EvidenceRow>;
  modelVersionId: number;
  playerIds: string[];
  models: Record<string, DartIQOutcomeModel>;
  timeline: DartIQDartEvent[];
  cohortByThrowId: Map<string, 'manual' | 'scolia'>;
};

function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function projectionFingerprint(event: DartIQDartEvent) {
  const vector = (state: DartIQDartEvent['before']) => state.projections.map((projection) => ({
    playerId: projection.id,
    leg: projection.legWinProbability,
    match: projection.matchWinProbability,
  }));
  return {
    before: vector(event.before),
    after: vector(event.after),
    fairEndingAfter: event.fairEndingAfter,
  };
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
  const implementationHash = hash({
    manifest: IMPLEMENTATION_MANIFEST,
    deploymentRevision: DEPLOYMENT_REVISION,
  });
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

async function loadDartIQTelemetryContext(
  supabase: SupabaseClient,
  matchId: string
): Promise<{ context: DartIQTelemetryContext | null; skipped: string | null }> {
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
  if (!data.match || !evidence || !populationEvidenceResult.data) {
    return { context: null, skipped: 'evidence_missing' };
  }

  const playerIds = data.players.map((player) => player.id);
  const evidenceByPlayer = new Map(
    ((playerEvidenceResult.data ?? []) as EvidenceRow[]).map((row) => [row.player_id!, row])
  );
  if (playerIds.some((playerId) => !evidenceByPlayer.has(playerId))) {
    return { context: null, skipped: 'player_evidence_missing' };
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
  const cohortByThrowId = new Map<string, 'manual' | 'scolia'>();
  for (const turns of Object.values(data.turnsByLeg as Record<string, TurnWithThrows[]>)) {
    for (const turn of turns) {
      for (const dart of turn.throws ?? []) {
        cohortByThrowId.set(dart.id, dart.scolia_event_id == null ? 'manual' : 'scolia');
      }
    }
  }

  return {
    skipped: null,
    context: {
      data: { ...data, match: data.match },
      evidence,
      populationEvidence: populationEvidenceResult.data as EvidenceRow,
      evidenceByPlayer,
      modelVersionId,
      playerIds,
      models,
      timeline,
      cohortByThrowId,
    },
  };
}

async function replaceResolutions(
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
  const resolutions = [
    { kind: 'leg', legId: input.legId, winnerPlayerId: input.legWinnerId },
    { kind: 'match', legId: null, winnerPlayerId: input.matchWinnerId },
  ] as const;
  for (const resolution of resolutions) {
    const replaced = await supabase.rpc('replace_dartiq_projection_resolution', {
      p_match_id: input.matchId,
      p_leg_id: resolution.legId,
      p_kind: resolution.kind,
      p_winner_player_id: resolution.winnerPlayerId,
      p_ended_early: input.endedEarly,
      p_resolved_at: input.resolvedAt,
    });
    if (replaced.error) throw new Error(replaced.error.message);
  }
}

function telemetryInputSnapshot(context: DartIQTelemetryContext, event: DartIQDartEvent) {
  return {
    scores: event.before.scores,
    legsWon: event.before.legsWon,
    currentPlayerId: event.before.currentPlayerId,
    currentVisitStartScore: event.before.currentVisitStartScore,
    dartsRemainingInTurn: event.before.dartsRemainingInTurn,
    fairEnding: event.fairEndingBefore,
    populationEvidenceHash: context.populationEvidence.content_hash,
    playerEvidenceHashes: Object.fromEntries(
      context.playerIds.map((playerId) => [
        playerId,
        context.evidenceByPlayer.get(playerId)!.content_hash,
      ])
    ),
  };
}

function liveProjectionPayload(
  context: DartIQTelemetryContext,
  event: DartIQDartEvent,
  capture: 'accepted_live' | 'correction_replay' = 'accepted_live'
) {
  const { data, models, playerIds } = context;
  const inputSnapshot = telemetryInputSnapshot(context, event);
  const computedAt = new Date().toISOString();
  const tiebreak = event.fairEndingBefore?.phase === 'tiebreak';
  const actorDistribution = tiebreak
    ? null
    : outcomeDistribution(models[event.playerId], event, event.playerId, data.match.finish);
  const revisionHash = hash({
    dartId: event.dartId,
    preStateHash: hash(inputSnapshot),
    segment: event.segment,
    scored: event.scored,
    busted: event.busted,
    checkedOut: event.checkedOut,
    projection: projectionFingerprint(event),
  });
  const eventRow = {
    schema_version: 1,
    match_id: data.match.id,
    leg_id: event.legId,
    throw_id: event.dartId,
    source_throw_id: event.dartId,
    model_version_id: context.modelVersionId,
    population_evidence_id: context.populationEvidence.id,
    acting_player_id: event.playerId,
    provenance: 'live',
    live_capture_status: capture === 'accepted_live' ? 'complete' : 'partial',
    live_capture_cause: capture === 'accepted_live' ? null : 'correction_replay',
    revision_hash: revisionHash,
    sequence: event.sequence,
    pre_state_hash: hash(inputSnapshot),
    input_snapshot: inputSnapshot,
    finish_rule: data.match.finish,
    player_count: playerIds.length,
    score_before: event.before.scores[event.playerId] ?? 0,
    score_band: scoreBand(event.before.scores[event.playerId] ?? 0, Boolean(tiebreak)),
    checkout_state: checkoutState(event, data.match.finish),
    confidence_tier: actorDistribution?.confidenceTier ?? 'fallback',
    cohort: context.cohortByThrowId.get(event.dartId) ?? 'manual',
    outcome_model_applicable: !tiebreak,
    approximation_modes: [...new Set([
      event.before.approximationMode,
      event.after.approximationMode,
    ].filter((mode) => mode !== 'standard'))],
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
  const playerProjections = playerIds.map((playerId) => {
    const before = event.before.projections.find((projection) => projection.id === playerId)!;
    const after = event.after.projections.find((projection) => projection.id === playerId)!;
    const distribution = tiebreak
      ? null
      : outcomeDistribution(models[playerId], event, playerId, data.match.finish);
    return {
      player_id: playerId,
      player_evidence_id: context.evidenceByPlayer.get(playerId)!.id,
      leg_probability_before: before.legWinProbability,
      leg_probability_after: after.legWinProbability,
      match_probability_before: before.matchWinProbability,
      match_probability_after: after.matchWinProbability,
      expected_finish_summary: tiebreak
        ? { applicable: false }
        : {
            applicable: true,
            expectedVisitsBefore: before.expectedVisitsRemaining,
            expectedVisitsAfter: after.expectedVisitsRemaining,
          },
      state_bucket: `${scoreBand(event.before.scores[playerId] ?? 0, Boolean(tiebreak))}:${event.before.dartsRemainingInTurn}`,
      confidence_tier: distribution?.confidenceTier ?? 'fallback',
      backoff_level: distribution
        ? `${distribution.stateBackoffLevel}:${distribution.outcomeBackoffLevel}`
        : 'not_applicable',
    };
  });
  return { eventRow, playerProjections };
}

async function captureLiveProjection(
  supabase: SupabaseClient,
  context: DartIQTelemetryContext,
  event: DartIQDartEvent
) {
  const payload = liveProjectionPayload(context, event);
  const captured = await supabase.rpc('capture_dartiq_live_projection_event', {
    p_event: payload.eventRow,
    p_player_projections: payload.playerProjections,
  });
  if (captured.error) throw new Error(captured.error.message);
}

async function refreshResolvedLiveProjection(
  supabase: SupabaseClient,
  context: DartIQTelemetryContext,
  event: DartIQDartEvent
) {
  const active = await supabase
    .from('dartiq_projection_events')
    .select('id')
    .eq('match_id', context.data.match.id)
    .eq('source_throw_id', event.dartId)
    .eq('model_version_id', context.modelVersionId)
    .eq('provenance', 'live')
    .is('superseded_at', null)
    .maybeSingle();
  if (active.error) throw new Error(active.error.message);
  if (active.data) await captureLiveProjection(supabase, context, event);
}

/** Freezes the before/after projection associated with one accepted live dart. */
export async function persistDartIQLiveThrow(
  supabase: SupabaseClient,
  matchId: string,
  throwId: string
) {
  const loaded = await loadDartIQTelemetryContext(supabase, matchId);
  if (!loaded.context) return { persisted: false, skipped: loaded.skipped };
  const event = loaded.context.timeline.find((candidate) => candidate.dartId === throwId);
  if (!event) return { persisted: false, skipped: 'throw_not_found' };
  await captureLiveProjection(supabase, loaded.context, event);
  const refreshed = await supabase.rpc('refresh_dartiq_projection_divergences', {
    p_match_id: matchId,
    p_leg_id: event.legId,
    p_model_version_id: loaded.context.modelVersionId,
  });
  if (refreshed.error) throw new Error(refreshed.error.message);
  return { persisted: true, skipped: null };
}

/** Re-captures the canonical prefix after an edit so changed downstream states get new revisions. */
export async function persistDartIQLiveReplay(
  supabase: SupabaseClient,
  matchId: string,
  legId: string
) {
  const loaded = await loadDartIQTelemetryContext(supabase, matchId);
  if (!loaded.context) return { persisted: 0, skipped: loaded.skipped };
  const events = loaded.context.timeline.filter((event) => event.legId === legId);
  if (events.length > 0) {
    const payloads = events.map((event) => ({
      event,
      payload: liveProjectionPayload(loaded.context!, event, 'correction_replay'),
    }));
    const replacedAt = new Date().toISOString();
    const replaced = await supabase.rpc('replace_dartiq_leg_projection_events', {
      p_match_id: matchId,
      p_leg_id: legId,
      p_model_version_id: loaded.context.modelVersionId,
      p_provenance: 'live',
      p_revision_hash: hash(payloads.map(({ payload }) => payload.eventRow.revision_hash)),
      p_replaced_at: replacedAt,
      p_events: payloads.map(({ payload }) => payload.eventRow),
      p_player_projections: payloads.flatMap(({ event, payload }) =>
        payload.playerProjections.map((projection) => ({
          source_throw_id: event.dartId,
          ...projection,
        }))
      ),
    });
    if (replaced.error) throw new Error(replaced.error.message);

    const refreshed = await supabase.rpc('refresh_dartiq_projection_divergences', {
      p_match_id: matchId,
      p_leg_id: legId,
      p_model_version_id: loaded.context.modelVersionId,
    });
    if (refreshed.error) throw new Error(refreshed.error.message);
  }
  return { persisted: events.length, skipped: null };
}

export async function supersedeDartIQLiveThrow(
  supabase: SupabaseClient,
  matchId: string,
  throwId: string
) {
  const superseded = await supabase
    .from('dartiq_projection_events')
    .update({ superseded_at: new Date().toISOString() })
    .eq('match_id', matchId)
    .eq('source_throw_id', throwId)
    .eq('provenance', 'live')
    .is('superseded_at', null);
  if (superseded.error) throw new Error(superseded.error.message);
}

/**
 * Reconstruct and persist one completed leg as a small number of batch writes.
 * These rows remain explicitly labelled as reconstructed leg-completion
 * evidence even when corresponding live rows exist for divergence checks.
 */
export async function persistDartIQCompletedLeg(
  supabase: SupabaseClient,
  matchId: string,
  legId: string
) {
  const loaded = await loadDartIQTelemetryContext(supabase, matchId);
  if (!loaded.context) return { persisted: 0, skipped: loaded.skipped };
  const {
    data,
    populationEvidence,
    evidenceByPlayer,
    cohortByThrowId,
    modelVersionId,
    playerIds,
    models,
    timeline,
  } = loaded.context;
  const events = timeline.filter((event) => event.legId === legId);
  if (events.length === 0) return { persisted: 0, skipped: 'no_darts' };

  const inputSnapshotFor = (event: DartIQDartEvent) => telemetryInputSnapshot(loaded.context!, event);

  const revisionHash = hash(events.map((event) => ({
    dartId: event.dartId,
    preStateHash: hash(inputSnapshotFor(event)),
    segment: event.segment,
    scored: event.scored,
    busted: event.busted,
    checkedOut: event.checkedOut,
    projection: projectionFingerprint(event),
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
      population_evidence_id: populationEvidence.id,
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
      cohort: cohortByThrowId.get(event.dartId) ?? 'manual',
      outcome_model_applicable: !tiebreak,
      approximation_modes: [...new Set([
        event.before.approximationMode,
        event.after.approximationMode,
      ].filter((mode) => mode !== 'standard'))],
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
            expectedVisitsBefore: before.expectedVisitsRemaining,
            expectedVisitsAfter: after.expectedVisitsRemaining,
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

  const resolvingEvent = events.at(-1);
  if (resolvingEvent) {
    await refreshResolvedLiveProjection(supabase, loaded.context, resolvingEvent);
  }

  const divergence = await supabase.rpc('refresh_dartiq_projection_divergences', {
    p_match_id: matchId,
    p_leg_id: legId,
    p_model_version_id: modelVersionId,
  });
  if (divergence.error) throw new Error(divergence.error.message);

  const leg = data.legs.find((candidate) => candidate.id === legId);
  await replaceResolutions(supabase, {
    matchId,
    legId,
    legWinnerId: leg?.winner_player_id ?? null,
    matchWinnerId: data.match.winner_player_id ?? null,
    endedEarly: Boolean(data.match.ended_early),
    resolvedAt: computedAt,
  });
  return { persisted: events.length, skipped: null };
}
