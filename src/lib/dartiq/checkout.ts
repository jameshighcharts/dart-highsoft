import type { DartIQOutcomeModel } from './model/outcomes';
import { createBehavioralOutcomeModel } from './model/outcomes';
import { solveDartIQVisit } from './model/visit';
import type { SegmentResult } from '@/utils/dartboard';
import { applyThrow, type FinishRule } from '@/utils/x01';

export type DartIQCheckoutAssessment = {
  checkoutProbabilityBefore: number;
  checkoutProbabilityAfter: number;
  nextVisitCheckoutProbability: number;
  leaveProbabilityChange: number;
  createdBogey: boolean;
  avoidedBogey: boolean;
};

export type DartSetupInput = {
  visitStartScore: number;
  scoreBefore: number;
  scoreAfter: number;
  dartsRemainingBefore: number;
  finishRule: FinishRule;
  busted: boolean;
  checkedOut: boolean;
  outcomeModel?: DartIQOutcomeModel;
};

export type CheckoutProbabilityInput = {
  visitStartScore: number;
  scoreRemaining: number;
  dartsRemaining: number;
  finishRule: FinishRule;
  outcomeModel?: DartIQOutcomeModel;
};

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

const fallbackOutcomeModel = createBehavioralOutcomeModel();

/**
 * Behavioral chance of finishing from the live visit state. This sums every
 * observed outcome path, including misses and recoverable leaves; it does not
 * infer an intended target or choose an ideal route for the player.
 */
export function estimateCheckoutProbability(input: CheckoutProbabilityInput) {
  if (input.scoreRemaining <= 0) return 1;
  const dartsLeft = Math.max(0, Math.min(3, input.dartsRemaining));
  if (dartsLeft === 0) return 0;
  return solveDartIQVisit(input.outcomeModel ?? fallbackOutcomeModel, {
    visitStartScore: input.visitStartScore,
    currentScore: input.scoreRemaining,
    dartsLeft: dartsLeft as 1 | 2 | 3,
    finishRule: input.finishRule,
  }).get(0) ?? 0;
}

export function isBogeyLeave(scoreRemaining: number, finishRule: FinishRule) {
  if (finishRule !== 'double_out' || scoreRemaining < 2 || scoreRemaining > 170) return false;
  return !hasCheckoutRoute(scoreRemaining, 3, finishRule);
}

const checkoutRouteMemo = new Map<string, boolean>();

export function hasCheckoutRoute(
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

/** Describes what the dart changed without claiming which target was intended. */
export function evaluateDartSetup(input: DartSetupInput): DartIQCheckoutAssessment {
  const dartsBefore = Math.max(1, Math.min(3, input.dartsRemainingBefore));
  const dartsAfter = input.busted || input.checkedOut ? 0 : dartsBefore - 1;
  const effectiveScoreAfter = input.busted ? input.visitStartScore : input.scoreAfter;
  const checkoutProbabilityBefore = estimateCheckoutProbability({
    visitStartScore: input.visitStartScore,
    scoreRemaining: input.scoreBefore,
    dartsRemaining: dartsBefore,
    finishRule: input.finishRule,
    outcomeModel: input.outcomeModel,
  });
  const checkoutProbabilityAfter = input.checkedOut
    ? 1
    : estimateCheckoutProbability({
        visitStartScore: input.visitStartScore,
        scoreRemaining: effectiveScoreAfter,
        dartsRemaining: dartsAfter,
        finishRule: input.finishRule,
        outcomeModel: input.outcomeModel,
      });
  const nextVisitCheckoutProbability = input.checkedOut
    ? 1
    : estimateCheckoutProbability({
        visitStartScore: effectiveScoreAfter,
        scoreRemaining: effectiveScoreAfter,
        dartsRemaining: 3,
        finishRule: input.finishRule,
        outcomeModel: input.outcomeModel,
      });
  const previousFreshVisitProbability = estimateCheckoutProbability({
    visitStartScore: input.scoreBefore,
    scoreRemaining: input.scoreBefore,
    dartsRemaining: 3,
    finishRule: input.finishRule,
    outcomeModel: input.outcomeModel,
  });
  const beforeBogey = isBogeyLeave(input.scoreBefore, input.finishRule);
  const afterBogey = !input.checkedOut && isBogeyLeave(effectiveScoreAfter, input.finishRule);

  return {
    checkoutProbabilityBefore,
    checkoutProbabilityAfter,
    nextVisitCheckoutProbability,
    leaveProbabilityChange: nextVisitCheckoutProbability - previousFreshVisitProbability,
    createdBogey: !input.busted && !beforeBogey && afterBogey,
    avoidedBogey: !input.busted && beforeBogey && !afterBogey,
  };
}
