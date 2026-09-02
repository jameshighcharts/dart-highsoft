import type { FinishRule } from '@/utils/x01';

export type PressureHistoryProfile = {
  finishRule: FinishRule;
  matchesPlayed: number;
  visits: number;
  dartsThrown: number;
  scoringPoints: number;
  threeDartAverage: number;
  busts: number;
  bustRate: number;
  checkoutOpportunities: number;
  checkouts: number;
  checkoutRate: number;
};

export type PressurePlayerHistoryProfile = PressureHistoryProfile & {
  playerId: string;
};

export type PressurePopulationProfile = PressureHistoryProfile;

export type PressureSkillModel = {
  threeDartAverage: number;
  checkoutRate: number;
  populationCheckoutRate: number;
  bustRate: number;
  historicalDarts: number;
  profileConfidence: number;
  profileSource: 'fallback' | 'population' | 'personal';
};

const FALLBACK_AVERAGE = 45;
const FALLBACK_CHECKOUT_RATE = 0.12;
const FALLBACK_BUST_RATE = 0.04;

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function blend(prior: number, observed: number, confidence: number) {
  return prior + (observed - prior) * clamp(confidence);
}

function finiteOr(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Produces a stable empirical prior using hierarchical shrinkage:
 * player → installation population → conservative cold-start fallback.
 * Confidence saturates, but every historical sample remains represented in
 * each aggregate's observed rate/average.
 */
export function createPressureSkillModel(
  personal?: PressurePlayerHistoryProfile,
  population?: PressurePopulationProfile
): PressureSkillModel {
  const populationDarts = Math.max(0, population?.dartsThrown ?? 0);
  const populationVisits = Math.max(0, population?.visits ?? 0);
  const populationCheckoutOpportunities = Math.max(0, population?.checkoutOpportunities ?? 0);
  const populationAverageConfidence = populationDarts / (populationDarts + 300);
  const populationRateConfidence = populationVisits / (populationVisits + 100);
  const populationCheckoutConfidence = populationCheckoutOpportunities
    / (populationCheckoutOpportunities + 60);

  const populationAverage = blend(
    FALLBACK_AVERAGE,
    finiteOr(population?.threeDartAverage ?? FALLBACK_AVERAGE, FALLBACK_AVERAGE),
    populationAverageConfidence
  );
  const populationCheckoutRate = blend(
    FALLBACK_CHECKOUT_RATE,
    finiteOr(population?.checkoutRate ?? FALLBACK_CHECKOUT_RATE, FALLBACK_CHECKOUT_RATE),
    populationCheckoutConfidence
  );
  const populationBustRate = blend(
    FALLBACK_BUST_RATE,
    finiteOr(population?.bustRate ?? FALLBACK_BUST_RATE, FALLBACK_BUST_RATE),
    populationRateConfidence
  );

  const personalDarts = Math.max(0, personal?.dartsThrown ?? 0);
  const personalVisits = Math.max(0, personal?.visits ?? 0);
  const personalCheckoutOpportunities = Math.max(0, personal?.checkoutOpportunities ?? 0);
  const averageConfidence = personalDarts / (personalDarts + 120);
  const bustConfidence = personalVisits / (personalVisits + 50);
  const checkoutConfidence = personalCheckoutOpportunities
    / (personalCheckoutOpportunities + 30);

  const hasPopulation = populationDarts > 0 || populationVisits > 0;
  const hasPersonal = personalDarts > 0 || personalVisits > 0;

  return {
    threeDartAverage: blend(
      populationAverage,
      finiteOr(personal?.threeDartAverage ?? populationAverage, populationAverage),
      averageConfidence
    ),
    checkoutRate: blend(
      populationCheckoutRate,
      finiteOr(personal?.checkoutRate ?? populationCheckoutRate, populationCheckoutRate),
      checkoutConfidence
    ),
    populationCheckoutRate,
    bustRate: blend(
      populationBustRate,
      finiteOr(personal?.bustRate ?? populationBustRate, populationBustRate),
      bustConfidence
    ),
    historicalDarts: personalDarts,
    profileConfidence: Math.max(averageConfidence, checkoutConfidence, bustConfidence),
    profileSource: hasPersonal ? 'personal' : hasPopulation ? 'population' : 'fallback',
  };
}
