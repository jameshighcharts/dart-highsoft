/**
 * Pure, offline calibration analysis. This module deliberately has no database
 * or model-registry write path: a passing result is a recommendation for human
 * review, never permission to promote a model automatically.
 */

export const DARTIQ_CALIBRATION_EVALUATOR_VERSION = 'calibration-evaluator-v1';

export type DartIQCalibrationSlices = {
  finishRule: string;
  playerCount: number;
  scoreBand: string;
  checkoutState: string;
  actorConfidenceTier: string;
  cohort: string;
};

export type DartIQValidationWindow =
  | { method: 'held_out'; trainingCutoff: string }
  | { method: 'walk_forward'; fold: number; trainingCutoff: string };

export type DartIQCalibrationObservation = {
  id: string;
  matchId: string;
  outcomeKind: 'leg' | 'match';
  occurredAt: string;
  winnerPlayerId: string;
  probabilities: Readonly<Record<string, number>>;
  slices: DartIQCalibrationSlices;
  validation: DartIQValidationWindow;
};

export type DartIQCandidateObservation = Omit<DartIQCalibrationObservation, 'probabilities'> & {
  baselineProbabilities: Readonly<Record<string, number>>;
  candidateProbabilities: Readonly<Record<string, number>>;
};

export type DartIQPersistedCalibrationInput = {
  projectionEventId: string;
  matchId: string;
  outcomeKind: 'leg' | 'match';
  matchCreatedAt: string;
  historicalEvidenceCutoffAt: string;
  winnerPlayerId: string;
  probabilities: Readonly<Record<string, number>>;
  finishRule: string;
  playerCount: number;
  scoreBand: string;
  checkoutState: string;
  actorConfidenceTier: string;
  cohort: 'manual' | 'scolia';
  validation: DartIQValidationWindow;
};

export type DartIQReliabilityBucket = {
  lowerBound: number;
  upperBound: number;
  predictionCount: number;
  meanPredictedProbability: number;
  observedFrequency: number;
  calibrationGap: number;
};

export type DartIQCalibrationMetrics = {
  eventCount: number;
  matchCount: number;
  classPredictionCount: number;
  multiclassBrierScore: number;
  logLoss: number;
  expectedCalibrationError: number;
  maximumCalibrationError: number;
};

export type DartIQCalibrationSliceReport = {
  key: string;
  dimension: keyof DartIQCalibrationSlices;
  value: string;
  metrics: DartIQCalibrationMetrics;
};

export type DartIQCalibrationReport = {
  evaluatorVersion: typeof DARTIQ_CALIBRATION_EVALUATOR_VERSION;
  outcomeKind: DartIQCalibrationObservation['outcomeKind'];
  metrics: DartIQCalibrationMetrics;
  reliability: DartIQReliabilityBucket[];
  slices: DartIQCalibrationSliceReport[];
};

export type DartIQCandidateGates = {
  minimumEvents: number;
  minimumMatches: number;
  minimumEventsPerFold: number;
  minimumValidationFolds: number;
  minimumEventsPerSlice: number;
  minimumMatchesPerSlice: number;
  minimumQualifiedSliceDimensions: number;
  minimumBrierImprovement: number;
  maximumOverallLogLossRegression: number;
  maximumOverallCalibrationErrorRegression: number;
  maximumSliceBrierRegression: number;
  maximumSliceLogLossRegression: number;
};

export const DEFAULT_DARTIQ_CANDIDATE_GATES: DartIQCandidateGates = {
  minimumEvents: 500,
  minimumMatches: 50,
  minimumEventsPerFold: 100,
  minimumValidationFolds: 3,
  minimumEventsPerSlice: 100,
  minimumMatchesPerSlice: 20,
  minimumQualifiedSliceDimensions: 6,
  minimumBrierImprovement: 0.001,
  maximumOverallLogLossRegression: 0,
  maximumOverallCalibrationErrorRegression: 0.01,
  maximumSliceBrierRegression: 0.01,
  maximumSliceLogLossRegression: 0.02,
};

export type DartIQCandidateGateFailure = {
  code:
    | 'insufficient_events'
    | 'insufficient_matches'
    | 'insufficient_walk_forward_folds'
    | 'insufficient_fold_events'
    | 'insufficient_slice_coverage'
    | 'brier_improvement_not_met'
    | 'overall_log_loss_regression'
    | 'overall_calibration_regression'
    | 'slice_brier_regression'
    | 'slice_log_loss_regression';
  detail: string;
  sliceKey?: string;
};

export type DartIQCandidateComparison = {
  evaluatorVersion: typeof DARTIQ_CALIBRATION_EVALUATOR_VERSION;
  validationMethod: DartIQValidationWindow['method'];
  recommendation: 'recommend_for_review' | 'reject' | 'insufficient_data';
  baseline: DartIQCalibrationReport;
  candidate: DartIQCalibrationReport;
  qualifiedSliceCount: number;
  insufficientSliceKeys: string[];
  failures: DartIQCandidateGateFailure[];
};

const PROBABILITY_TOLERANCE = 1e-6;
const LOG_LOSS_EPSILON = 1e-15;
const SLICE_DIMENSIONS: (keyof DartIQCalibrationSlices)[] = [
  'finishRule',
  'playerCount',
  'scoreBand',
  'checkoutState',
  'actorConfidenceTier',
  'cohort',
];

/**
 * Lossless boundary from persisted telemetry to the pure evaluator. Match
 * creation time is the event clock for validation; projection `computed_at`
 * is intentionally absent because reconstructed rows are computed after play.
 */
export function calibrationObservationFromPersisted(
  input: DartIQPersistedCalibrationInput
): DartIQCalibrationObservation {
  const matchCreatedAt = finiteDate(input.matchCreatedAt, 'matchCreatedAt');
  const evidenceCutoff = finiteDate(
    input.historicalEvidenceCutoffAt,
    'historicalEvidenceCutoffAt'
  );
  if (evidenceCutoff > matchCreatedAt) {
    throw new Error('historical evidence cutoff cannot follow match creation');
  }
  return {
    id: input.projectionEventId,
    matchId: input.matchId,
    outcomeKind: input.outcomeKind,
    occurredAt: input.matchCreatedAt,
    winnerPlayerId: input.winnerPlayerId,
    probabilities: input.probabilities,
    slices: {
      finishRule: input.finishRule,
      playerCount: input.playerCount,
      scoreBand: input.scoreBand,
      checkoutState: input.checkoutState,
      actorConfidenceTier: input.actorConfidenceTier,
      cohort: input.cohort,
    },
    validation: input.validation,
  };
}

function finiteDate(value: string, label: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${label} must be a valid timestamp`);
  return timestamp;
}

function validateObservation(observation: DartIQCalibrationObservation) {
  if (!observation.id || !observation.matchId) {
    throw new Error('calibration observations require stable event and match identifiers');
  }
  const occurredAt = finiteDate(observation.occurredAt, `${observation.id}.occurredAt`);
  const cutoff = finiteDate(
    observation.validation.trainingCutoff,
    `${observation.id}.validation.trainingCutoff`
  );
  if (occurredAt <= cutoff) {
    throw new Error(`${observation.id} is not out-of-sample: occurrence must follow training cutoff`);
  }
  if (
    observation.validation.method === 'walk_forward'
    && (!Number.isInteger(observation.validation.fold) || observation.validation.fold < 1)
  ) {
    throw new Error(`${observation.id}.validation.fold must be a positive integer`);
  }

  const entries = Object.entries(observation.probabilities);
  if (entries.length < 2) throw new Error(`${observation.id} must contain at least two players`);
  if (entries.length !== observation.slices.playerCount) {
    throw new Error(`${observation.id} player-count slice does not match its probability vector`);
  }
  if (!Object.hasOwn(observation.probabilities, observation.winnerPlayerId)) {
    throw new Error(`${observation.id} winner is absent from its probability vector`);
  }
  let total = 0;
  for (const [playerId, probability] of entries) {
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
      throw new Error(`${observation.id}.${playerId} is not a probability`);
    }
    total += probability;
  }
  if (Math.abs(total - 1) > PROBABILITY_TOLERANCE) {
    throw new Error(`${observation.id} probability vector sums to ${total}, not one`);
  }
}

function metricsFor(
  observations: readonly DartIQCalibrationObservation[],
  reliabilityBucketCount: number
): DartIQCalibrationMetrics {
  if (observations.length === 0) {
    return {
      eventCount: 0,
      matchCount: 0,
      classPredictionCount: 0,
      multiclassBrierScore: 0,
      logLoss: 0,
      expectedCalibrationError: 0,
      maximumCalibrationError: 0,
    };
  }

  let brier = 0;
  let logLoss = 0;
  const bucketTotals = Array.from({ length: reliabilityBucketCount }, () => ({
    probability: 0,
    outcome: 0,
    count: 0,
  }));

  for (const observation of observations) {
    const winnerProbability = observation.probabilities[observation.winnerPlayerId];
    logLoss -= Math.log(Math.max(LOG_LOSS_EPSILON, winnerProbability));
    for (const [playerId, probability] of Object.entries(observation.probabilities)) {
      const outcome = playerId === observation.winnerPlayerId ? 1 : 0;
      brier += (probability - outcome) ** 2;
      const bucketIndex = Math.min(
        reliabilityBucketCount - 1,
        Math.floor(probability * reliabilityBucketCount)
      );
      const bucket = bucketTotals[bucketIndex];
      bucket.probability += probability;
      bucket.outcome += outcome;
      bucket.count += 1;
    }
  }

  const classPredictionCount = bucketTotals.reduce((sum, bucket) => sum + bucket.count, 0);
  let expectedCalibrationError = 0;
  let maximumCalibrationError = 0;
  for (const bucket of bucketTotals) {
    if (bucket.count === 0) continue;
    const gap = Math.abs(bucket.probability / bucket.count - bucket.outcome / bucket.count);
    expectedCalibrationError += gap * bucket.count / classPredictionCount;
    maximumCalibrationError = Math.max(maximumCalibrationError, gap);
  }

  return {
    eventCount: observations.length,
    matchCount: new Set(observations.map((observation) => observation.matchId)).size,
    classPredictionCount,
    multiclassBrierScore: brier / observations.length,
    logLoss: logLoss / observations.length,
    expectedCalibrationError,
    maximumCalibrationError,
  };
}

function reliabilityFor(
  observations: readonly DartIQCalibrationObservation[],
  bucketCount: number
): DartIQReliabilityBucket[] {
  return Array.from({ length: bucketCount }, (_, index) => {
    const probabilities: number[] = [];
    let outcomes = 0;
    for (const observation of observations) {
      for (const [playerId, probability] of Object.entries(observation.probabilities)) {
        const bucketIndex = Math.min(bucketCount - 1, Math.floor(probability * bucketCount));
        if (bucketIndex !== index) continue;
        probabilities.push(probability);
        outcomes += playerId === observation.winnerPlayerId ? 1 : 0;
      }
    }
    const predictionCount = probabilities.length;
    const meanPredictedProbability = predictionCount === 0
      ? 0
      : probabilities.reduce((sum, value) => sum + value, 0) / predictionCount;
    const observedFrequency = predictionCount === 0 ? 0 : outcomes / predictionCount;
    return {
      lowerBound: index / bucketCount,
      upperBound: (index + 1) / bucketCount,
      predictionCount,
      meanPredictedProbability,
      observedFrequency,
      calibrationGap: Math.abs(meanPredictedProbability - observedFrequency),
    };
  });
}

function sliceKey(dimension: keyof DartIQCalibrationSlices, value: string | number) {
  return `${dimension}=${String(value)}`;
}

export function evaluateDartIQCalibration(
  observations: readonly DartIQCalibrationObservation[],
  options: { reliabilityBucketCount?: number } = {}
): DartIQCalibrationReport {
  const reliabilityBucketCount = options.reliabilityBucketCount ?? 10;
  if (!Number.isInteger(reliabilityBucketCount) || reliabilityBucketCount < 2) {
    throw new Error('reliabilityBucketCount must be an integer of at least two');
  }
  observations.forEach(validateObservation);
  const outcomeKinds = new Set(observations.map((observation) => observation.outcomeKind));
  if (outcomeKinds.size > 1) throw new Error('calibration report cannot mix leg and match outcomes');

  const sliceGroups = new Map<string, {
    dimension: keyof DartIQCalibrationSlices;
    value: string;
    observations: DartIQCalibrationObservation[];
  }>();
  for (const observation of observations) {
    for (const dimension of SLICE_DIMENSIONS) {
      const value = String(observation.slices[dimension]);
      const key = sliceKey(dimension, value);
      const group = sliceGroups.get(key) ?? { dimension, value, observations: [] };
      group.observations.push(observation);
      sliceGroups.set(key, group);
    }
  }

  return {
    evaluatorVersion: DARTIQ_CALIBRATION_EVALUATOR_VERSION,
    outcomeKind: observations[0]?.outcomeKind ?? 'leg',
    metrics: metricsFor(observations, reliabilityBucketCount),
    reliability: reliabilityFor(observations, reliabilityBucketCount),
    slices: [...sliceGroups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, group]) => ({
        key,
        dimension: group.dimension,
        value: group.value,
        metrics: metricsFor(group.observations, reliabilityBucketCount),
      })),
  };
}

function candidateAsObservations(
  rows: readonly DartIQCandidateObservation[],
  kind: 'baseline' | 'candidate'
): DartIQCalibrationObservation[] {
  return rows.map((row) => ({
    id: row.id,
    matchId: row.matchId,
    outcomeKind: row.outcomeKind,
    occurredAt: row.occurredAt,
    winnerPlayerId: row.winnerPlayerId,
    probabilities: kind === 'baseline' ? row.baselineProbabilities : row.candidateProbabilities,
    slices: row.slices,
    validation: row.validation,
  }));
}

export function compareDartIQCalibrationCandidate(
  rows: readonly DartIQCandidateObservation[],
  gateOverrides: Partial<DartIQCandidateGates> = {}
): DartIQCandidateComparison {
  if (rows.length === 0) throw new Error('candidate comparison requires observations');
  const ids = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.id)) throw new Error(`duplicate candidate observation ${row.id}`);
    ids.add(row.id);
    const baselinePlayers = Object.keys(row.baselineProbabilities).sort();
    const candidatePlayers = Object.keys(row.candidateProbabilities).sort();
    if (
      baselinePlayers.length !== candidatePlayers.length
      || baselinePlayers.some((playerId, index) => playerId !== candidatePlayers[index])
    ) {
      throw new Error(`${row.id} baseline and candidate player vectors do not align`);
    }
  }
  const gates = { ...DEFAULT_DARTIQ_CANDIDATE_GATES, ...gateOverrides };
  const methods = new Set(rows.map((row) => row.validation.method));
  if (methods.size !== 1) throw new Error('candidate comparison cannot mix validation methods');
  const validationMethod = rows[0].validation.method;
  if (validationMethod === 'held_out') {
    const cutoffs = new Set(rows.map((row) => row.validation.trainingCutoff));
    if (cutoffs.size !== 1) throw new Error('held-out comparison requires one frozen training cutoff');
  }
  const baseline = evaluateDartIQCalibration(candidateAsObservations(rows, 'baseline'));
  const candidate = evaluateDartIQCalibration(candidateAsObservations(rows, 'candidate'));
  const failures: DartIQCandidateGateFailure[] = [];

  if (rows.length < gates.minimumEvents) {
    failures.push({
      code: 'insufficient_events',
      detail: `${rows.length} events is below the predeclared minimum of ${gates.minimumEvents}`,
    });
  }
  if (baseline.metrics.matchCount < gates.minimumMatches) {
    failures.push({
      code: 'insufficient_matches',
      detail: `${baseline.metrics.matchCount} matches is below the predeclared minimum of ${gates.minimumMatches}`,
    });
  }

  if (validationMethod === 'walk_forward') {
    const foldCounts = new Map<number, number>();
    for (const row of rows) {
      if (row.validation.method !== 'walk_forward') continue;
      foldCounts.set(row.validation.fold, (foldCounts.get(row.validation.fold) ?? 0) + 1);
    }
    if (foldCounts.size < gates.minimumValidationFolds) {
      failures.push({
        code: 'insufficient_walk_forward_folds',
        detail: `${foldCounts.size} folds is below the minimum of ${gates.minimumValidationFolds}`,
      });
    }
    for (const [fold, count] of foldCounts) {
      if (count < gates.minimumEventsPerFold) {
        failures.push({
          code: 'insufficient_fold_events',
          detail: `fold ${fold} has ${count} events; ${gates.minimumEventsPerFold} required`,
        });
      }
    }
  }

  const brierImprovement = baseline.metrics.multiclassBrierScore
    - candidate.metrics.multiclassBrierScore;
  if (brierImprovement < gates.minimumBrierImprovement) {
    failures.push({
      code: 'brier_improvement_not_met',
      detail: `Brier improvement ${brierImprovement} is below ${gates.minimumBrierImprovement}`,
    });
  }
  const overallLogLossRegression = candidate.metrics.logLoss - baseline.metrics.logLoss;
  if (overallLogLossRegression > gates.maximumOverallLogLossRegression) {
    failures.push({
      code: 'overall_log_loss_regression',
      detail: `log-loss regression ${overallLogLossRegression} exceeds ${gates.maximumOverallLogLossRegression}`,
    });
  }
  const calibrationRegression = candidate.metrics.expectedCalibrationError
    - baseline.metrics.expectedCalibrationError;
  if (calibrationRegression > gates.maximumOverallCalibrationErrorRegression) {
    failures.push({
      code: 'overall_calibration_regression',
      detail: `calibration-error regression ${calibrationRegression} exceeds ${gates.maximumOverallCalibrationErrorRegression}`,
    });
  }

  const baselineSlices = new Map(baseline.slices.map((slice) => [slice.key, slice]));
  const insufficientSliceKeys: string[] = [];
  let qualifiedSliceCount = 0;
  const qualifiedSliceDimensions = new Set<keyof DartIQCalibrationSlices>();
  for (const candidateSlice of candidate.slices) {
    const baselineSlice = baselineSlices.get(candidateSlice.key);
    if (!baselineSlice) continue;
    if (
      candidateSlice.metrics.eventCount < gates.minimumEventsPerSlice
      || candidateSlice.metrics.matchCount < gates.minimumMatchesPerSlice
    ) {
      insufficientSliceKeys.push(candidateSlice.key);
      continue;
    }
    qualifiedSliceCount += 1;
    qualifiedSliceDimensions.add(candidateSlice.dimension);
    const sliceBrierRegression = candidateSlice.metrics.multiclassBrierScore
      - baselineSlice.metrics.multiclassBrierScore;
    if (sliceBrierRegression > gates.maximumSliceBrierRegression) {
      failures.push({
        code: 'slice_brier_regression',
        detail: `Brier regression ${sliceBrierRegression} exceeds ${gates.maximumSliceBrierRegression}`,
        sliceKey: candidateSlice.key,
      });
    }
    const sliceLogLossRegression = candidateSlice.metrics.logLoss - baselineSlice.metrics.logLoss;
    if (sliceLogLossRegression > gates.maximumSliceLogLossRegression) {
      failures.push({
        code: 'slice_log_loss_regression',
        detail: `log-loss regression ${sliceLogLossRegression} exceeds ${gates.maximumSliceLogLossRegression}`,
        sliceKey: candidateSlice.key,
      });
    }
  }
  if (qualifiedSliceDimensions.size < gates.minimumQualifiedSliceDimensions) {
    failures.push({
      code: 'insufficient_slice_coverage',
      detail: `${qualifiedSliceDimensions.size} qualified slice dimensions is below ${gates.minimumQualifiedSliceDimensions}`,
    });
  }

  const insufficient = failures.some((failure) => failure.code.startsWith('insufficient_'));
  return {
    evaluatorVersion: DARTIQ_CALIBRATION_EVALUATOR_VERSION,
    validationMethod,
    recommendation: insufficient
      ? 'insufficient_data'
      : failures.length > 0
        ? 'reject'
        : 'recommend_for_review',
    baseline,
    candidate,
    qualifiedSliceCount,
    insufficientSliceKeys,
    failures,
  };
}
