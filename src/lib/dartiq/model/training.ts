import {
  createBehavioralOutcomeModel,
  type DartIQOutcomeContext,
  type DartIQOutcomeModel,
  type DartIQOutcomeObservation,
} from './outcomes';

export const DARTIQ_TRAINING_VERSION = 'adaptive-scoring-v1';
export const DARTIQ_TRAINING_LIMITS = Object.freeze({ minimumMatches: 30, minimumDarts: 500, maximumDarts: 24000 });
const SECTORS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
const SEGMENTS = ['Miss', 'SB', 'DB', ...['S', 'D', 'T'].flatMap((ring) => SECTORS.map((n) => `${ring}${n}`))];

export type DartIQTrainingDart = DartIQOutcomeContext & {
  id: string; matchId: string; playerId: string; matchCreatedAt: string; completedAt: string;
  segment: string; x: number | null; y: number | null;
};
type SegmentCounts = Record<string, number>;
export type DartIQTrainedArtifact = {
  version: typeof DARTIQ_TRAINING_VERSION;
  trainedThrough: string;
  matchCount: number;
  dartCount: number;
  population: DartIQOutcomeObservation[];
  players: Record<string, DartIQOutcomeObservation[]>;
  geometry: Record<string, SegmentCounts>;
};
export type DartIQModelDeployment = {
  id: string;
  artifact: DartIQTrainedArtifact;
  geometryContexts: string[];
};

/** Scolia millimetres: positive y points up, unlike the decorative SVG board. */
export function landingSegment(x: number, y: number) {
  const radius = Math.hypot(x, y);
  if (radius > 170) return 'Miss';
  if (radius <= 6.35) return 'DB';
  if (radius <= 15.9) return 'SB';
  const angle = (Math.atan2(x, y) * 180 / Math.PI + 369) % 360;
  const sector = SECTORS[Math.floor(angle / 18)];
  return `${radius >= 162 ? 'D' : radius >= 99 && radius <= 107 ? 'T' : 'S'}${sector}`;
}

function outcome(segment: string) {
  if (segment === 'Miss') return { scoreDelta: 0, isDouble: false };
  if (segment === 'SB') return { scoreDelta: 25, isDouble: false };
  if (segment === 'DB') return { scoreDelta: 50, isDouble: true };
  return { scoreDelta: Number(segment.slice(1)) * (segment[0] === 'D' ? 2 : segment[0] === 'T' ? 3 : 1), isDouble: segment[0] === 'D' };
}

function validateDarts(rows: readonly DartIQTrainingDart[]) {
  if (rows.length > DARTIQ_TRAINING_LIMITS.maximumDarts) throw new Error('Training window exceeds bound');
  const ids = new Set<string>();
  const matches = new Map<string, string>();
  for (const row of rows) {
    if (ids.has(row.id) || !row.id || !row.playerId || !row.matchId || !SEGMENTS.includes(row.segment)
      || !Number.isInteger(row.currentScore) || row.currentScore < 1 || row.currentScore > 1001
      || ![1, 2, 3].includes(row.dartsLeft) || !['single_out', 'double_out'].includes(row.finishRule)
      || !Number.isFinite(Date.parse(row.matchCreatedAt)) || !Number.isFinite(Date.parse(row.completedAt))
      || Date.parse(row.completedAt) <= Date.parse(row.matchCreatedAt)) throw new Error('Invalid training dart');
    const times = `${row.matchCreatedAt}:${row.completedAt}`;
    if (matches.has(row.matchId) && matches.get(row.matchId) !== times) throw new Error('Inconsistent training match');
    matches.set(row.matchId, times);
    ids.add(row.id);
  }
}

function geometryKey(playerId: string, context: DartIQOutcomeContext) {
  return `${playerId}:${context.finishRule}:${context.dartsLeft}`;
}

/** Fit compact empirical transitions plus a multimodal, smoothed landing distribution.
 * No aim inference: initial geometry support is deliberately restricted to scores >170.
 */
export function trainDartIQArtifact(rows: readonly DartIQTrainingDart[]): DartIQTrainedArtifact | null {
  validateDarts(rows);
  const matchCount = new Set(rows.map((row) => row.matchId)).size;
  if (matchCount < DARTIQ_TRAINING_LIMITS.minimumMatches || rows.length < DARTIQ_TRAINING_LIMITS.minimumDarts) return null;
  const counts = new Map<string, DartIQOutcomeObservation & { playerId: string }>();
  const geometry: DartIQTrainedArtifact['geometry'] = {};
  for (const row of rows) {
    const observed = outcome(row.segment);
    const key = `${row.playerId}:${row.finishRule}:${row.currentScore}:${row.dartsLeft}:${observed.scoreDelta}:${observed.isDouble}`;
    const previous = counts.get(key);
    if (previous) previous.count++;
    else counts.set(key, { playerId: row.playerId, finishRule: row.finishRule, currentScore: row.currentScore, dartsLeft: row.dartsLeft, ...observed, count: 1 });
    if (row.currentScore <= 170 || row.x === null || row.y === null || !Number.isFinite(row.x) || !Number.isFinite(row.y)
      || Math.hypot(row.x, row.y) > 250 || landingSegment(row.x, row.y) !== row.segment) continue;
    // Compact deterministic 5mm smoothing kernel; each impact contributes exactly one unit.
    // Aggregation keeps inference independent of the number of historical impacts.
    const distribution = geometry[geometryKey(row.playerId, row)] ??= {};
    for (const [dx, dy, weight] of [[0, 0, 0.5], [-5, 0, 0.125], [5, 0, 0.125], [0, -5, 0.125], [0, 5, 0.125]]) {
      const segment = landingSegment(row.x + dx, row.y + dy);
      distribution[segment] = (distribution[segment] ?? 0) + weight;
    }
  }
  const players: DartIQTrainedArtifact['players'] = {};
  const populationCounts = new Map<string, DartIQOutcomeObservation>();
  for (const { playerId, ...row } of counts.values()) {
    (players[playerId] ??= []).push(row);
    const key = `${row.finishRule}:${row.currentScore}:${row.dartsLeft}:${row.scoreDelta}:${row.isDouble}`;
    const previous = populationCounts.get(key);
    if (previous) previous.count += row.count;
    else populationCounts.set(key, { ...row });
  }
  return {
    version: DARTIQ_TRAINING_VERSION, trainedThrough: new Date(Math.max(...rows.map((row) => Date.parse(row.completedAt)))).toISOString(),
    matchCount, dartCount: rows.length, players, population: [...populationCounts.values()], geometry,
  };
}

function geometrySegments(artifact: DartIQTrainedArtifact, playerId: string, context: DartIQOutcomeContext) {
  if (context.currentScore <= 170) return null;
  const personal = artifact.geometry[geometryKey(playerId, context)];
  if (!personal) return null;
  const personalSize = Object.values(personal).reduce((sum, n) => sum + n, 0);
  if (personalSize < 100) return null;
  // Broad nonzero prior protects log-loss; actual support still controls eligibility.
  const total = personalSize + 10;
  return SEGMENTS.map((segment) => ({ segment, probability: ((personal[segment] ?? 0) + 10 / SEGMENTS.length) / total }));
}

/** Shared UI/report/worker runtime. An absent artifact retains the existing behavioural path. */
export function createAdaptiveDartIQModel(input: {
  playerId: string; deployment?: DartIQModelDeployment | null;
  personal?: DartIQOutcomeObservation[]; population?: DartIQOutcomeObservation[];
}): DartIQOutcomeModel {
  const deployment = input.deployment;
  if (!deployment || deployment.artifact.version !== DARTIQ_TRAINING_VERSION) return createBehavioralOutcomeModel(input);
  const artifact = deployment.artifact;
  const behavioral = createBehavioralOutcomeModel({ personal: artifact.players[input.playerId], population: artifact.population });
  const cache = new Map<string, ReturnType<DartIQOutcomeModel['distribution']>>();
  const spatialCache = new Map<string, ReturnType<typeof geometrySegments>>();
  const spatialFor = (context: DartIQOutcomeContext) => {
    if (context.currentScore <= 170) return null;
    const key = geometryKey(input.playerId, context);
    if (!deployment.geometryContexts.includes(key)) return null;
    if (!spatialCache.has(key)) spatialCache.set(key, geometrySegments(artifact, input.playerId, context));
    return spatialCache.get(key) ?? null;
  };
  return {
    version: behavioral.version,
    distribution(context) {
      const key = `${context.finishRule}:${context.currentScore}:${context.dartsLeft}`;
      const cached = cache.get(key);
      if (cached) return cached;
      const base = behavioral.distribution(context);
      const spatial = spatialFor(context);
      if (!spatial) return base;
      const combined = new Map(base.outcomes.map((row) => [`${row.scoreDelta}:${row.isDouble}`, { ...row, probability: row.probability * 0.5 }]));
      for (const row of spatial) {
        const hit = outcome(row.segment);
        const id = `${hit.scoreDelta}:${hit.isDouble}`;
        const previous = combined.get(id);
        if (previous) previous.probability += row.probability * 0.5;
        else combined.set(id, { ...hit, probability: row.probability * 0.5 });
      }
      const result = { ...base, outcomes: [...combined.values()] };
      cache.set(key, result);
      return result;
    },
    predictLanding(context) {
      const segments = spatialFor(context);
      return segments ? { artifactId: deployment.id, validation: 'passed', confidence: 'high', segments } : null;
    },
  };
}

type Loss = { count: number; matches: number; brier: number; logLoss: number };
function loss(rows: readonly DartIQTrainingDart[], models: Map<string, DartIQOutcomeModel>, landing = false): Loss {
  const matches = new Map<string, { count: number; brier: number; logLoss: number }>();
  for (const row of rows) {
    const model = models.get(row.playerId)!;
    const distribution = model.distribution(row).outcomes;
    const observed = outcome(row.segment);
    let actual = distribution.find((p) => p.scoreDelta === observed.scoreDelta && p.isDouble === observed.isDouble)?.probability ?? 0;
    let squared = distribution.reduce((sum, p) => sum + p.probability ** 2, 0);
    if (landing) {
      const segments = model.predictLanding?.(row)?.segments ?? SEGMENTS.map((segment) => {
        const hit = outcome(segment);
        const probability = distribution.find((p) => p.scoreDelta === hit.scoreDelta && p.isDouble === hit.isDouble)?.probability ?? 0;
        const aliases = SEGMENTS.filter((other) => { const value = outcome(other); return value.scoreDelta === hit.scoreDelta && value.isDouble === hit.isDouble; }).length;
        return { segment, probability: probability / aliases };
      });
      actual = segments.find((p) => p.segment === row.segment)?.probability ?? 0;
      squared = segments.reduce((sum, p) => sum + p.probability ** 2, 0);
    }
    const brier = squared - 2 * actual + 1;
    const match = matches.get(row.matchId) ?? { count: 0, brier: 0, logLoss: 0 };
    match.count++; match.brier += brier; match.logLoss -= Math.log(Math.max(1e-15, actual));
    matches.set(row.matchId, match);
  }
  const values = [...matches.values()];
  return { count: rows.length, matches: matches.size,
    brier: values.reduce((sum, row) => sum + row.brier / row.count, 0) / Math.max(1, matches.size),
    logLoss: values.reduce((sum, row) => sum + row.logLoss / row.count, 0) / Math.max(1, matches.size) };
}

/** Follow-up outcomes cannot alter fitted parameters. A player needs their own geometry validation. */
export function validateDartIQArtifact(artifact: DartIQTrainedArtifact, frozenAt: string,
  rows: readonly DartIQTrainingDart[], incumbent: DartIQModelDeployment | null) {
  validateDarts(rows);
  const cutoff = Date.parse(frozenAt);
  if (!Number.isFinite(cutoff) || Date.parse(artifact.trainedThrough) > cutoff) throw new Error('Invalid artifact cutoff');
  const eligible = rows.filter((row) => Date.parse(row.matchCreatedAt) > cutoff);
  const playerIds = [...new Set(eligible.map((row) => row.playerId))];
  const candidate = new Map(playerIds.map((playerId) => [playerId, createAdaptiveDartIQModel({ playerId,
    deployment: { id: 'candidate', artifact, geometryContexts: [] } })]));
  const baseline = new Map(playerIds.map((playerId) => [playerId, createAdaptiveDartIQModel({ playerId, deployment: incumbent,
    personal: artifact.players[playerId], population: artifact.population })]));
  const baselineLoss = loss(eligible, baseline);
  const candidateLoss = loss(eligible, candidate);
  const supported = eligible.length >= 500 && baselineLoss.matches >= 30;
  const passes = (before: Loss, after: Loss) => after.brier <= before.brier - 0.001 && after.logLoss <= before.logLoss;
  const geometryContexts: string[] = [];
  for (const key of new Set(eligible.map((row) => geometryKey(row.playerId, row)))) {
    const personal = eligible.filter((row) => geometryKey(row.playerId, row) === key && row.currentScore > 170
      && row.x !== null && row.y !== null && Number.isFinite(row.x) && Number.isFinite(row.y)
      && landingSegment(row.x, row.y) === row.segment);
    if (personal.length < 100 || new Set(personal.map((row) => row.matchId)).size < 20) continue;
    const playerId = personal[0].playerId;
    const spatial = new Map([[playerId, createAdaptiveDartIQModel({ playerId,
      deployment: { id: 'candidate', artifact, geometryContexts: [key] } })]]);
    if (passes(loss(personal, candidate), loss(personal, spatial))
      && passes(loss(personal, candidate, true), loss(personal, spatial, true))) geometryContexts.push(key);
  }
  const combined = new Map(playerIds.map((playerId) => [playerId, createAdaptiveDartIQModel({ playerId,
    deployment: { id: 'candidate', artifact, geometryContexts } })]));
  const combinedLoss = loss(eligible, combined);
  // First fitted behavioural snapshot can qualify on non-regression against the same
  // historical counts. Replacements and geometry must demonstrate improvement.
  const qualifies = incumbent ? passes(baselineLoss, combinedLoss)
    : combinedLoss.brier <= baselineLoss.brier && combinedLoss.logLoss <= baselineLoss.logLoss;
  const regressedPlayers = playerIds.filter((playerId) => {
    const personal = eligible.filter((row) => row.playerId === playerId);
    if (personal.length < 100 || new Set(personal.map((row) => row.matchId)).size < 20) return false;
    const before = loss(personal, baseline);
    const after = loss(personal, combined);
    return after.brier > before.brier + 0.01 || after.logLoss > before.logLoss + 0.02;
  });
  return { eligible: supported && qualifies && regressedPlayers.length === 0, geometryContexts, regressedPlayers,
    baseline: baselineLoss, behavioral: candidateLoss, combined: combinedLoss,
    predictionKind: 'next_dart_outcome' as const, matchWinCalibrationProven: false as const };
}

/** Monitor fixed deployed parameters against their predecessor; never refit on monitoring outcomes. */
export function monitorDartIQDeployment(active: DartIQModelDeployment, activatedAt: string,
  rows: readonly DartIQTrainingDart[], previous: DartIQModelDeployment | null) {
  validateDarts(rows);
  const cutoff = Date.parse(activatedAt);
  if (!Number.isFinite(cutoff)) throw new Error('Invalid activation timestamp');
  const eligible = rows.filter((row) => Date.parse(row.matchCreatedAt) > cutoff);
  const ids = [...new Set(eligible.map((row) => row.playerId))];
  const deployed = new Map(ids.map((playerId) => [playerId, createAdaptiveDartIQModel({ playerId, deployment: active })]));
  const baseline = new Map(ids.map((playerId) => [playerId, createAdaptiveDartIQModel({ playerId, deployment: previous,
    personal: active.artifact.players[playerId], population: active.artifact.population })]));
  const before = loss(eligible, baseline);
  const after = loss(eligible, deployed);
  const supported = before.count >= 500 && before.matches >= 30;
  return { rollback: supported && (after.brier > before.brier + 0.01 || after.logLoss > before.logLoss + 0.02), baseline: before, active: after };
}
