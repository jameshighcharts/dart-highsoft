import type { SegmentResult } from '@/utils/dartboard';
import { estimateExpectedDartsRemaining } from '@/utils/pressureEngine';
import { applyThrow, type FinishRule } from '@/utils/x01';

export type SetupQualityGrade = 'checkout' | 'optimal' | 'good' | 'neutral' | 'poor' | 'bust';

export type PressureCheckoutAssessment = {
  checkoutProbabilityBefore: number;
  checkoutProbabilityAfter: number;
  nextVisitCheckoutProbability: number;
  bestAvailableLeaveValue: number;
  actualLeaveValue: number;
  setupQuality: number;
  setupGrade: SetupQualityGrade;
  bestSegment: string | null;
  createdBogey: boolean;
  avoidedBogey: boolean;
};

export type DartSetupInput = {
  scoreBefore: number;
  scoreAfter: number;
  dartsRemainingBefore: number;
  segment: string;
  threeDartAverage: number;
  finishRule: FinishRule;
  busted: boolean;
  checkedOut: boolean;
  checkoutRate?: number;
  populationCheckoutRate?: number;
  bustRate?: number;
};

export type PressureCheckoutSkill = Pick<
  DartSetupInput,
  'checkoutRate' | 'populationCheckoutRate'
>;

const BOARD_SEGMENTS: SegmentResult[] = [
  ...Array.from({ length: 20 }, (_, index) => ({
    kind: 'Single' as const,
    value: index + 1,
    scored: index + 1,
    label: `S${index + 1}`,
  })),
  ...Array.from({ length: 20 }, (_, index) => ({
    kind: 'Double' as const,
    value: index + 1,
    scored: (index + 1) * 2,
    label: `D${index + 1}`,
  })),
  ...Array.from({ length: 20 }, (_, index) => ({
    kind: 'Triple' as const,
    value: index + 1,
    scored: (index + 1) * 3,
    label: `T${index + 1}`,
  })),
  { kind: 'OuterBull', scored: 25, label: 'SB' },
  { kind: 'InnerBull', scored: 50, label: 'DB' },
];

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function targetHitProbability(
  segment: SegmentResult,
  threeDartAverage: number,
  checkoutSkill?: PressureCheckoutSkill
) {
  const skill = clamp((threeDartAverage - 25) / 75);
  // Checkout conversion is a visit-level signal, not direct double accuracy,
  // so use only a conservative relative modifier around the population rate.
  const checkoutModifier = clamp(
    (checkoutSkill?.checkoutRate ?? 0.12)
      - (checkoutSkill?.populationCheckoutRate ?? 0.12),
    -0.15,
    0.15
  );
  switch (segment.kind) {
    case 'Single':
      return 0.58 + skill * 0.3;
    case 'Double':
      return clamp(0.09 + skill * 0.33 + checkoutModifier * 0.5);
    case 'Triple':
      return 0.07 + skill * 0.31;
    case 'OuterBull':
      return 0.24 + skill * 0.3;
    case 'InnerBull':
      return clamp(0.04 + skill * 0.18 + checkoutModifier * 0.25);
    case 'Miss':
      return 0;
  }
}

function createCheckoutProbabilityCalculator(
  threeDartAverage: number,
  finishRule: FinishRule,
  checkoutSkill?: PressureCheckoutSkill
) {
  const memo = new Map<string, number>();

  function solve(scoreRemaining: number, dartsRemaining: number): number {
    if (scoreRemaining === 0) return 1;
    if (scoreRemaining < 0 || dartsRemaining <= 0) return 0;
    if (scoreRemaining > dartsRemaining * 60) return 0;
    if (finishRule === 'double_out' && scoreRemaining === 1) return 0;
    const key = `${scoreRemaining}:${dartsRemaining}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;

    let best = 0;
    for (const segment of BOARD_SEGMENTS) {
      const outcome = applyThrow(scoreRemaining, segment, finishRule);
      if (outcome.busted) continue;
      const hitProbability = targetHitProbability(segment, threeDartAverage, checkoutSkill);
      const routeProbability = outcome.finished
        ? hitProbability
        : hitProbability * solve(outcome.newScore, dartsRemaining - 1);
      best = Math.max(best, routeProbability);
    }

    memo.set(key, best);
    return best;
  }

  return solve;
}

/** Estimated chance of completing an exact planned route in the available darts. */
export function estimateCheckoutProbability(
  scoreRemaining: number,
  dartsRemaining: number,
  threeDartAverage: number,
  finishRule: FinishRule,
  checkoutSkill?: PressureCheckoutSkill
) {
  return createCheckoutProbabilityCalculator(threeDartAverage, finishRule, checkoutSkill)(
    scoreRemaining,
    Math.max(0, Math.min(3, dartsRemaining))
  );
}

export function isBogeyLeave(scoreRemaining: number, finishRule: FinishRule) {
  if (finishRule !== 'double_out' || scoreRemaining < 2 || scoreRemaining > 170) return false;
  return !hasCheckoutRoute(scoreRemaining, 3, finishRule);
}

const checkoutRouteMemo = new Map<string, boolean>();

function hasCheckoutRoute(
  scoreRemaining: number,
  dartsRemaining: number,
  finishRule: FinishRule
): boolean {
  if (scoreRemaining === 0) return true;
  if (scoreRemaining < 0 || dartsRemaining <= 0) return false;
  if (scoreRemaining > dartsRemaining * 60) return false;
  if (finishRule === 'double_out' && scoreRemaining === 1) return false;
  const key = `${finishRule}:${scoreRemaining}:${dartsRemaining}`;
  const cached = checkoutRouteMemo.get(key);
  if (cached !== undefined) return cached;

  for (const segment of BOARD_SEGMENTS) {
    const outcome = applyThrow(scoreRemaining, segment, finishRule);
    if (outcome.busted) continue;
    if (outcome.finished || hasCheckoutRoute(outcome.newScore, dartsRemaining - 1, finishRule)) {
      checkoutRouteMemo.set(key, true);
      return true;
    }
  }

  checkoutRouteMemo.set(key, false);
  return false;
}

function leaveValue(
  scoreRemaining: number,
  dartsThisVisit: number,
  threeDartAverage: number,
  finishRule: FinishRule,
  checkoutProbability: ReturnType<typeof createCheckoutProbabilityCalculator>,
  skill?: PressureCheckoutSkill & { bustRate?: number }
) {
  if (scoreRemaining === 0) return 1;
  const currentVisitChance = checkoutProbability(scoreRemaining, dartsThisVisit);
  const nextVisitChance = checkoutProbability(scoreRemaining, 3);
  const expectedDarts = estimateExpectedDartsRemaining(
    scoreRemaining,
    threeDartAverage,
    finishRule,
    skill
  );
  const travelReadiness = clamp(3 / Math.max(3, expectedDarts));
  const bogeyPenalty = isBogeyLeave(scoreRemaining, finishRule) ? 0.82 : 1;
  return clamp(
    (currentVisitChance + (1 - currentVisitChance) * nextVisitChance * 0.45 + travelReadiness * 0.12)
      * bogeyPenalty
  );
}

/**
 * Grades the actual dart against every legal non-busting segment from the same
 * pre-dart state. This rewards route quality rather than raw points scored.
 */
export function evaluateDartSetup(input: DartSetupInput): PressureCheckoutAssessment {
  const dartsBefore = Math.max(1, Math.min(3, input.dartsRemainingBefore));
  const dartsAfter = input.busted || input.checkedOut ? 0 : dartsBefore - 1;
  const checkoutProbability = createCheckoutProbabilityCalculator(
    input.threeDartAverage,
    input.finishRule,
    input
  );
  const checkoutProbabilityBefore = checkoutProbability(input.scoreBefore, dartsBefore);
  const checkoutProbabilityAfter = checkoutProbability(input.scoreAfter, dartsAfter);
  const nextVisitCheckoutProbability = checkoutProbability(input.scoreAfter, 3);
  const beforeBogey = isBogeyLeave(input.scoreBefore, input.finishRule);
  const afterBogey = !input.busted && !input.checkedOut
    && isBogeyLeave(input.scoreAfter, input.finishRule);

  let bestAvailableLeaveValue = 0;
  let bestSegment: string | null = null;
  let aBogeyWasAvailable = false;
  for (const segment of BOARD_SEGMENTS) {
    const outcome = applyThrow(input.scoreBefore, segment, input.finishRule);
    if (outcome.busted) continue;
    aBogeyWasAvailable ||= isBogeyLeave(outcome.newScore, input.finishRule);
    const value = leaveValue(
      outcome.newScore,
      outcome.finished ? 0 : dartsBefore - 1,
      input.threeDartAverage,
      input.finishRule,
      checkoutProbability,
      input
    );
    if (value > bestAvailableLeaveValue) {
      bestAvailableLeaveValue = value;
      bestSegment = segment.label;
    }
  }

  const actualLeaveValue = input.busted
    ? 0
    : leaveValue(
        input.scoreAfter,
        dartsAfter,
        input.threeDartAverage,
        input.finishRule,
        checkoutProbability,
        input
      );
  const setupQuality = input.busted
    ? 0
    : bestAvailableLeaveValue > 0
      ? clamp(actualLeaveValue / bestAvailableLeaveValue)
      : 1;

  let setupGrade: SetupQualityGrade;
  if (input.busted) setupGrade = 'bust';
  else if (input.checkedOut) setupGrade = 'checkout';
  else if (setupQuality >= 0.95) setupGrade = 'optimal';
  else if (setupQuality >= 0.8) setupGrade = 'good';
  else if (setupQuality >= 0.55) setupGrade = 'neutral';
  else setupGrade = 'poor';

  return {
    checkoutProbabilityBefore,
    checkoutProbabilityAfter,
    nextVisitCheckoutProbability,
    bestAvailableLeaveValue,
    actualLeaveValue,
    setupQuality,
    setupGrade,
    bestSegment,
    createdBogey: !beforeBogey && afterBogey,
    avoidedBogey: !afterBogey && aBogeyWasAvailable,
  };
}
