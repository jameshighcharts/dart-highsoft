import 'server-only';

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DARTIQ_TRAINING_VERSION, trainDartIQArtifact, validateDartIQArtifact, monitorDartIQDeployment,
  type DartIQTrainingDart, type DartIQTrainedArtifact } from '@/lib/dartiq/model/training';
import {
  DARTIQ_CALIBRATION_EVALUATOR_VERSION,
  DARTIQ_CONTINUOUS_CONFIGURATION,
  DEFAULT_DARTIQ_CANDIDATE_GATES,
  evaluateDartIQContinuousWindow,
  evaluateDartIQFrozenCandidate,
  type DartIQFrozenCalibrationCandidate,
  type DartIQContinuousObservation,
} from '@/lib/dartiq/calibration';

/** Daily fitting/activation is independent of telemetry availability and never blocks scoring. */
export async function runDartIQTraining(supabase: SupabaseClient, windowEnd: string) {
  if (!Number.isFinite(Date.parse(windowEnd)) || Date.parse(windowEnd) > Date.now()) throw new Error('Invalid training window');
  const result = await supabase.rpc('load_dartiq_training_window', { p_window_end: windowEnd });
  if (result.error) throw new Error(result.error.message);
  type Stored = { id: string; version: string; created_at: string; activated_at: string; artifact: DartIQTrainedArtifact; geometry_contexts: string[] };
  const data = result.data as { generation: string; rows: DartIQTrainingDart[]; active: Stored | null; pending: Stored | null; previous: Stored | null } | null;
  if (!data || !Array.isArray(data.rows) || data.rows.length > 24000 || !/^\d+$/.test(data.generation)
    || data.rows.some((row) => Date.parse(row.completedAt) >= Date.parse(windowEnd))) throw new Error('Invalid training data');
  const sourceHash = createHash('sha256').update(JSON.stringify([DARTIQ_TRAINING_VERSION, data.rows])).digest('hex');
  const deployment = (row: Stored) => ({ id: row.id, artifact: row.artifact, geometryContexts: row.geometry_contexts });
  const monitoring = data.active ? monitorDartIQDeployment(deployment(data.active), data.active.activated_at, data.rows,
    data.previous ? deployment(data.previous) : null) : null;
  const validation = monitoring?.rollback ? monitoring : data.pending ? data.pending.version === DARTIQ_TRAINING_VERSION
    ? validateDartIQArtifact(data.pending.artifact, data.pending.created_at, data.rows,
      data.active ? { id: data.active.id, artifact: data.active.artifact, geometryContexts: data.active.geometry_contexts } : null)
    : { eligible: false, reason: 'unsupported_version' } : null;
  const artifact = data.pending || monitoring?.rollback ? null : trainDartIQArtifact(data.rows);
  if (!artifact && !validation) return { skipped: 'insufficient_data' };
  const saved = await supabase.rpc('commit_dartiq_training', { p_generation: data.generation,
    p_version: DARTIQ_TRAINING_VERSION, p_source_hash: sourceHash, p_artifact: artifact, p_validation: validation });
  if (saved.error) throw new Error(saved.error.message);
  return { committed: saved.data === true, validation };
}

/** Scheduled, bounded, observation-only work; never imported by live projection code. */
export async function runDartIQCalibration(supabase: SupabaseClient, modelVersionId: string, windowEnd: string) {
  if (!/^\d+$/.test(modelVersionId) || !Number.isFinite(Date.parse(windowEnd))) {
    throw new Error('Invalid DartIQ calibration job');
  }
  const evaluatorVersion = `${DARTIQ_CALIBRATION_EVALUATOR_VERSION}:${DARTIQ_CONTINUOUS_CONFIGURATION.version}`;
  const result = await supabase.rpc('load_dartiq_calibration_window', {
    p_model_version_id: modelVersionId,
    p_window_end: windowEnd,
    p_evaluator_version: evaluatorVersion,
  });
  if (result.error) throw new Error(result.error.message);
  const data = result.data as { modelVersionId: string; rows: DartIQContinuousObservation[]; candidate?: DartIQFrozenCalibrationCandidate | null } | null;
  if (!data || data.modelVersionId !== modelVersionId || !Array.isArray(data.rows) || data.rows.length > 8_000) {
    throw new Error('Invalid DartIQ calibration window');
  }
  const fingerprint = createHash('sha256').update(JSON.stringify({
    configuration: DARTIQ_CONTINUOUS_CONFIGURATION, gates: DEFAULT_DARTIQ_CANDIDATE_GATES, rows: data.rows,
    candidate: data.candidate ?? null,
  })).digest('hex');
  const existing = await supabase.from('dartiq_calibration_reports').select('id')
    .eq('model_version_id', modelVersionId).eq('evaluator_version', evaluatorVersion)
    .eq('source_fingerprint', fingerprint).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) return { skipped: 'unchanged' as const };

  const report = {
    ...evaluateDartIQContinuousWindow(data.rows),
    frozenCandidateFollowup: data.candidate ? evaluateDartIQFrozenCandidate(data.rows, data.candidate) : null,
  };
  const saved = await supabase.from('dartiq_calibration_reports').insert({
    model_version_id: modelVersionId, evaluator_version: evaluatorVersion,
    source_fingerprint: fingerprint, window_end: windowEnd,
    sampled_event_ids: data.rows.map((row) => row.id), report,
  });
  // Concurrent/retried dispatches are harmless; reports never overwrite a newer result.
  if (saved.error && saved.error.code !== '23505') throw new Error(saved.error.message);
  return { recommendation: report.recommendation };
}
