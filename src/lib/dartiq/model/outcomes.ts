import type { FinishRule } from '@/utils/x01';

export const DARTIQ_OUTCOME_MODEL_VERSION = 'behavioral-v1' as const;

export type DartIQDartsLeft = 1 | 2 | 3;

export type DartIQOutcomeContext = {
  currentScore: number;
  dartsLeft: DartIQDartsLeft;
  finishRule: FinishRule;
};

export type DartIQDartOutcome = {
  scoreDelta: number;
  isDouble: boolean;
  probability: number;
};

export type DartIQOutcomeObservation = DartIQOutcomeContext & {
  scoreDelta: number;
  isDouble: boolean;
  count: number;
};

export type DartIQOutcomeObservationRow = {
  player_id?: string;
  finish_rule: FinishRule;
  current_score: number | string;
  darts_left: number | string;
  score_delta: number | string;
  is_double: boolean;
  outcome_count: number | string;
};

export type DartIQOutcomeBackoffLevel =
  | 'fallback'
  | 'population_global'
  | 'population_score_class'
  | 'population_exact'
  | 'player_global'
  | 'player_score_class'
  | 'player_exact';

export type DartIQOutcomeDistribution = {
  outcomes: DartIQDartOutcome[];
  stateBackoffLevel: DartIQOutcomeBackoffLevel;
  outcomeBackoffLevel: 'family' | 'exact';
  confidenceTier: 'fallback' | 'population' | 'player_sparse' | 'player_established';
  sampleSize: number;
};

export type DartIQOutcomeModel = {
  version: typeof DARTIQ_OUTCOME_MODEL_VERSION;
  distribution(context: DartIQOutcomeContext): DartIQOutcomeDistribution;
};

type WeightedOutcome = Omit<DartIQDartOutcome, 'probability'> & { weight: number };

type BehavioralOutcomeModelInput = {
  personal?: DartIQOutcomeObservation[];
  population?: DartIQOutcomeObservation[];
  priorStrength?: number;
  exactOutcomeThreshold?: number;
};

const DEFAULT_PRIOR_STRENGTH = 24;
const DEFAULT_EXACT_OUTCOME_THRESHOLD = 40;

export function normalizeDartIQOutcomeObservation(
  row: DartIQOutcomeObservationRow
): DartIQOutcomeObservation {
  const dartsLeft = Math.min(3, Math.max(1, Number(row.darts_left))) as DartIQDartsLeft;
  return {
    currentScore: Math.max(0, Number(row.current_score)),
    dartsLeft,
    finishRule: row.finish_rule,
    scoreDelta: Math.max(0, Number(row.score_delta)),
    isDouble: row.is_double,
    count: Math.max(0, Number(row.outcome_count)),
  };
}

function outcomeKey(outcome: Pick<DartIQDartOutcome, 'scoreDelta' | 'isDouble'>) {
  return `${outcome.scoreDelta}:${outcome.isDouble ? 1 : 0}`;
}

function scoreClass(score: number) {
  if (score <= 0) return 'finished';
  if (score <= 40) return '1_40';
  if (score <= 60) return '41_60';
  if (score <= 100) return '61_100';
  if (score <= 170) return '101_170';
  if (score <= 230) return '171_230';
  return '231_plus';
}

function outcomeFamily(outcome: Pick<DartIQDartOutcome, 'scoreDelta' | 'isDouble'>) {
  if (outcome.isDouble) return `double_${outcome.scoreDelta}`;
  if (outcome.scoreDelta === 0) return 'miss';
  if (outcome.scoreDelta <= 20) return 'non_double_1_20';
  if (outcome.scoreDelta <= 40) return 'non_double_21_40';
  return 'non_double_41_60';
}

function normalizeWeights(outcomes: WeightedOutcome[]): DartIQDartOutcome[] {
  const total = outcomes.reduce((sum, outcome) => sum + outcome.weight, 0);
  if (!(total > 0)) return [{ scoreDelta: 0, isDouble: false, probability: 1 }];
  return outcomes
    .filter((outcome) => outcome.weight > 0)
    .map(({ weight, ...outcome }) => ({ ...outcome, probability: weight / total }));
}

function createFallbackPrior(context: DartIQOutcomeContext) {
  const weights = new Map<string, WeightedOutcome>();
  const add = (scoreDelta: number, isDouble: boolean, weight: number) => {
    const key = outcomeKey({ scoreDelta, isDouble });
    const existing = weights.get(key);
    weights.set(key, {
      scoreDelta,
      isDouble,
      weight: (existing?.weight ?? 0) + weight,
    });
  };

  add(0, false, 0.08);
  for (let value = 1; value <= 20; value += 1) {
    add(value, false, 0.54 / 20);
    add(value * 2, true, 0.06 / 20);
    add(value * 3, false, 0.24 / 20);
  }
  add(25, false, 0.05);
  add(50, true, 0.03);

  // Conservative cold-start behavior at an immediately finishable score.
  // This is a broad state-conditioned prior, not an inferred target or a
  // normative route. Real population/player state evidence replaces it.
  if (context.finishRule === 'double_out') {
    if (context.currentScore >= 2 && context.currentScore <= 40 && context.currentScore % 2 === 0) {
      add(context.currentScore, true, 0.42);
    } else if (context.currentScore === 50) {
      add(50, true, 0.2);
    }
  } else if (context.currentScore >= 1 && context.currentScore <= 20) {
    add(context.currentScore, false, 0.9);
  } else if (
    context.currentScore >= 3
    && context.currentScore <= 60
    && context.currentScore % 3 === 0
  ) {
    add(context.currentScore, false, 0.3);
  }
  return normalizeWeights([...weights.values()]);
}

function aggregate(observations: DartIQOutcomeObservation[]) {
  const counts = new Map<string, WeightedOutcome>();
  let total = 0;
  for (const observation of observations) {
    const count = Number.isFinite(observation.count) ? Math.max(0, observation.count) : 0;
    if (count === 0) continue;
    const key = outcomeKey(observation);
    const existing = counts.get(key);
    counts.set(key, {
      scoreDelta: observation.scoreDelta,
      isDouble: observation.isDouble,
      weight: (existing?.weight ?? 0) + count,
    });
    total += count;
  }
  return { counts, total };
}

function exactPosterior(
  prior: DartIQDartOutcome[],
  observations: DartIQOutcomeObservation[],
  priorStrength: number
) {
  const { counts, total } = aggregate(observations);
  const keys = new Set([...prior.map(outcomeKey), ...counts.keys()]);
  const priorByKey = new Map(prior.map((outcome) => [outcomeKey(outcome), outcome]));
  return normalizeWeights([...keys].map((key) => {
    const observed = counts.get(key);
    const fallback = priorByKey.get(key);
    return {
      scoreDelta: observed?.scoreDelta ?? fallback?.scoreDelta ?? 0,
      isDouble: observed?.isDouble ?? fallback?.isDouble ?? false,
      weight: (observed?.weight ?? 0) + (fallback?.probability ?? 0) * priorStrength,
    };
  })).map((outcome) => ({ ...outcome, probability: outcome.probability / Math.max(1, total + priorStrength) * (total + priorStrength) }));
}

function familyPosterior(
  prior: DartIQDartOutcome[],
  observations: DartIQOutcomeObservation[],
  priorStrength: number
) {
  const { counts, total } = aggregate(observations);
  const observedFamilies = new Map<string, number>();
  for (const outcome of counts.values()) {
    const family = outcomeFamily(outcome);
    observedFamilies.set(family, (observedFamilies.get(family) ?? 0) + outcome.weight);
  }
  const priorFamilies = new Map<string, number>();
  for (const outcome of prior) {
    const family = outcomeFamily(outcome);
    priorFamilies.set(family, (priorFamilies.get(family) ?? 0) + outcome.probability);
  }

  const denominator = total + priorStrength;
  return prior.map((outcome) => {
    const family = outcomeFamily(outcome);
    const priorFamily = priorFamilies.get(family) ?? 0;
    const familyProbability = denominator > 0
      ? ((observedFamilies.get(family) ?? 0) + priorFamily * priorStrength) / denominator
      : priorFamily;
    const withinFamily = priorFamily > 0 ? outcome.probability / priorFamily : 0;
    return { ...outcome, probability: familyProbability * withinFamily };
  });
}

function updatePosterior(
  prior: DartIQDartOutcome[],
  observations: DartIQOutcomeObservation[],
  priorStrength: number,
  exactOutcomeThreshold: number
) {
  const sampleSize = observations.reduce(
    (sum, observation) => sum + Math.max(0, observation.count),
    0
  );
  if (sampleSize === 0) return { outcomes: prior, sampleSize, outcomeBackoffLevel: 'family' as const };
  const exact = sampleSize >= exactOutcomeThreshold;
  return {
    outcomes: exact
      ? exactPosterior(prior, observations, priorStrength)
      : familyPosterior(prior, observations, priorStrength),
    sampleSize,
    outcomeBackoffLevel: exact ? 'exact' as const : 'family' as const,
  };
}

export function createBehavioralOutcomeModel(
  input: BehavioralOutcomeModelInput = {}
): DartIQOutcomeModel {
  const personal = input.personal ?? [];
  const population = input.population ?? [];
  const priorStrength = Math.max(1, input.priorStrength ?? DEFAULT_PRIOR_STRENGTH);
  const exactOutcomeThreshold = Math.max(
    1,
    input.exactOutcomeThreshold ?? DEFAULT_EXACT_OUTCOME_THRESHOLD
  );
  const distributionCache = new Map<string, DartIQOutcomeDistribution>();

  return {
    version: DARTIQ_OUTCOME_MODEL_VERSION,
    distribution(context) {
      const cacheKey = `${context.finishRule}:${context.currentScore}:${context.dartsLeft}`;
      const cached = distributionCache.get(cacheKey);
      if (cached) return cached;
      const sameRule = (observation: DartIQOutcomeObservation) =>
        observation.finishRule === context.finishRule;
      const sameClassAndDarts = (observation: DartIQOutcomeObservation) =>
        sameRule(observation)
        && scoreClass(observation.currentScore) === scoreClass(context.currentScore)
        && observation.dartsLeft === context.dartsLeft;
      const exactState = (observation: DartIQOutcomeObservation) =>
        sameRule(observation)
        && observation.currentScore === context.currentScore
        && observation.dartsLeft === context.dartsLeft;

      const layers: Array<{
        level: DartIQOutcomeBackoffLevel;
        observations: DartIQOutcomeObservation[];
      }> = [
        { level: 'population_global', observations: population.filter(sameRule) },
        { level: 'population_score_class', observations: population.filter(sameClassAndDarts) },
        { level: 'population_exact', observations: population.filter(exactState) },
        { level: 'player_global', observations: personal.filter(sameRule) },
        { level: 'player_score_class', observations: personal.filter(sameClassAndDarts) },
        { level: 'player_exact', observations: personal.filter(exactState) },
      ];

      let outcomes = createFallbackPrior(context);
      let stateBackoffLevel: DartIQOutcomeBackoffLevel = 'fallback';
      let outcomeBackoffLevel: 'family' | 'exact' = 'family';
      let appliedSamples = 0;
      for (const layer of layers) {
        const updated = updatePosterior(
          outcomes,
          layer.observations,
          priorStrength,
          exactOutcomeThreshold
        );
        if (updated.sampleSize === 0) continue;
        outcomes = updated.outcomes;
        appliedSamples += updated.sampleSize;
        stateBackoffLevel = layer.level;
        outcomeBackoffLevel = updated.outcomeBackoffLevel;
      }

      const personalSamples = personal
        .filter(sameRule)
        .reduce((sum, observation) => sum + Math.max(0, observation.count), 0);
      const populationSamples = population
        .filter(sameRule)
        .reduce((sum, observation) => sum + Math.max(0, observation.count), 0);
      const confidenceTier = personalSamples >= 120
        ? 'player_established'
        : personalSamples > 0
          ? 'player_sparse'
          : populationSamples > 0
            ? 'population'
            : 'fallback';

      const result: DartIQOutcomeDistribution = {
        outcomes,
        stateBackoffLevel,
        outcomeBackoffLevel,
        confidenceTier,
        sampleSize: appliedSamples,
      };
      distributionCache.set(cacheKey, result);
      return result;
    },
  };
}
