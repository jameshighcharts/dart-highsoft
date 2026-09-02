import { computeCheckoutSuggestions } from '@/utils/checkoutSuggestions';
import {
  createPressureSkillModel,
  type PressurePlayerHistoryProfile,
  type PressurePopulationProfile,
} from '@/utils/pressureProfiles';
import type { FinishRule } from '@/utils/x01';

const PRIOR_DARTS = 12;

export type PressurePlayerState = {
  id: string;
  scoreRemaining: number;
  legsWon: number;
  threeDartAverage: number;
  dartsThrown: number;
  historicalProfile?: PressurePlayerHistoryProfile;
};

export type PressureEngineInput = {
  players: PressurePlayerState[];
  playOrder: string[];
  currentPlayerId: string | null;
  dartsRemainingInTurn: number;
  legsToWin: number;
  finishRule: FinishRule;
  matchWinnerId?: string | null;
  populationProfile?: PressurePopulationProfile;
};

export type PressurePlayerProjection = PressurePlayerState & {
  adjustedThreeDartAverage: number;
  expectedDartsRemaining: number;
  legWinProbability: number;
  matchWinProbability: number;
  baselineThreeDartAverage: number;
  historicalDarts: number;
  profileConfidence: number;
  profileSource: 'fallback' | 'population' | 'personal';
  checkoutRate: number;
  populationCheckoutRate: number;
  bustRate: number;
};

export type PressureEngineProjection = {
  players: PressurePlayerProjection[];
  favoritePlayerId: string | null;
};

export type ExpectedDartsSkill = {
  checkoutRate?: number;
  populationCheckoutRate?: number;
  bustRate?: number;
};

export type PressureDartLeverage = {
  /** Pre-dart opportunity to swing the current leg, normalized to 0–1. */
  leg: number;
  /** Leg leverage weighted by how decisive this leg is for the match. */
  match: number;
  /** Broadcast-friendly pressure index including imminent opponent threat. */
  pressureIndex: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function adjustedAverage(average: number, dartsThrown: number, historicalBaseline: number) {
  if (!Number.isFinite(average) || average <= 0 || dartsThrown <= 0) {
    return historicalBaseline;
  }

  const sampleDarts = Math.max(0, dartsThrown);
  return clamp(
    (clamp(average, 12, 130) * sampleDarts + historicalBaseline * PRIOR_DARTS) /
      (sampleDarts + PRIOR_DARTS),
    20,
    110
  );
}

/**
 * A transparent first-pass checkout model. It estimates scoring travel at the
 * player's adjusted points-per-dart, then adds the cost of finding the winning
 * double. It is deliberately deterministic so the same match state always
 * produces the same broadcast number.
 */
export function estimateExpectedDartsRemaining(
  scoreRemaining: number,
  threeDartAverage: number,
  finishRule: FinishRule,
  skill?: ExpectedDartsSkill
) {
  if (scoreRemaining <= 0) return 0;

  const pointsPerDart = clamp(threeDartAverage / 3, 6, 36.67);
  if (finishRule === 'single_out') {
    return Math.max(1, scoreRemaining / pointsPerDart);
  }

  const checkoutModifier = clamp(
    (skill?.checkoutRate ?? 0.12) - (skill?.populationCheckoutRate ?? 0.12),
    -0.15,
    0.15
  );
  const doubleAccuracy = clamp(
    0.1 + (threeDartAverage - 30) * 0.0045 + checkoutModifier * 0.5,
    0.08,
    0.48
  );
  const checkoutPaths = scoreRemaining <= 170
    ? computeCheckoutSuggestions(scoreRemaining, 3, finishRule)
    : [];

  if (checkoutPaths.length > 0) {
    const routeDarts = checkoutPaths[0].length;
    const missedDoubleCost = (1 / doubleAccuracy - 1) * 0.75;
    return routeDarts + missedDoubleCost;
  }

  // Travel to a representative two-dart checkout. Bogey numbers receive an
  // extra setup dart because they cannot be finished in a normal three-dart visit.
  const checkoutEntry = 60;
  const bustDrag = 1 + clamp(skill?.bustRate ?? 0.04, 0, 0.3) * 0.35;
  const travel = (Math.max(0, scoreRemaining - checkoutEntry) / pointsPerDart) * bustDrag;
  const bogeyPenalty = scoreRemaining <= 170 ? 1 : 0;
  const finish = 2 + (1 / doubleAccuracy - 1) * 0.75;
  return travel + bogeyPenalty + finish;
}

function normalizeWeights(weights: number[]) {
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return weights.map(() => 1 / Math.max(1, weights.length));
  return weights.map((value) => value / total);
}

/**
 * Estimates how consequential the next dart is before its outcome is known.
 * This is deliberately distinct from WPA: two darts thrown from the same
 * state have equal leverage even if one hits and the other misses.
 *
 * The first model is a transparent, normalized index rather than a claimed
 * probability-point range. Checkout proximity supplies urgency, probability
 * uncertainty supplies volatility, and the match score supplies importance.
 */
export function calculateDartLeverage(
  projections: PressurePlayerProjection[],
  playerId: string,
  legsToWin: number
): PressureDartLeverage {
  const player = projections.find((entry) => entry.id === playerId);
  if (!player || projections.length === 0) {
    return { leg: 0, match: 0, pressureIndex: 0 };
  }

  const readiness = (expectedDarts: number) => clamp(3 / Math.max(3, expectedDarts), 0, 1);
  const playerReadiness = readiness(player.expectedDartsRemaining);
  let opponentReadiness = 0;
  let furthestMatchProgress = player.legsWon;
  for (const projection of projections) {
    furthestMatchProgress = Math.max(furthestMatchProgress, projection.legsWon);
    if (projection.id !== playerId) {
      opponentReadiness = Math.max(opponentReadiness, readiness(projection.expectedDartsRemaining));
    }
  }

  const urgency = Math.max(playerReadiness, opponentReadiness * 0.9);
  const uncertainty = 1 - Math.abs(player.legWinProbability * 2 - 1);
  // Retain meaningful leverage at lopsided probabilities: a match dart remains
  // consequential even when the favorite is already very likely to win.
  const volatility = 0.6 + uncertainty * 0.4;
  const leg = clamp(urgency * volatility, 0, 1);
  const progress = legsToWin <= 1
    ? 1
    : clamp(furthestMatchProgress / (legsToWin - 1), 0, 1);
  const matchImportance = 0.45 + progress * 0.55;
  const match = clamp(leg * matchImportance, 0, 1);
  const pressureIndex = clamp(
    Math.max(match, leg * 0.7) * (0.85 + opponentReadiness * 0.15),
    0,
    1
  );

  return { leg, match, pressureIndex };
}

function liveLegProbabilities(
  players: Array<PressurePlayerState & { expectedDarts: number }>,
  playOrder: string[],
  currentPlayerId: string | null,
  dartsRemainingInTurn: number
) {
  if (players.length === 1) return [1];

  const currentOrderIndex = Math.max(0, playOrder.indexOf(currentPlayerId ?? ''));
  const rotatedOrder = [
    ...playOrder.slice(currentOrderIndex),
    ...playOrder.slice(0, currentOrderIndex),
  ];
  const currentDarts = clamp(dartsRemainingInTurn, 0, 3);

  const finishTimes = players.map((player) => {
    if (player.scoreRemaining <= 0) return 0;
    const offset = Math.max(0, rotatedOrder.indexOf(player.id));
    const firstVisitDarts = offset === 0 ? currentDarts : 3;
    const waitBeforeFirstVisit = offset === 0 ? 0 : currentDarts + 3 * (offset - 1);
    const dartsAfterFirstVisit = Math.max(0, player.expectedDarts - firstVisitDarts);
    const interveningVisits = (dartsAfterFirstVisit / 3) * 3 * (players.length - 1);
    return waitBeforeFirstVisit + player.expectedDarts + interveningVisits;
  });

  const bestTime = Math.min(...finishTimes);
  const temperature = 13 + Math.max(0, players.length - 2) * 3;
  const weights = finishTimes.map((time) => Math.exp(-(time - bestTime) / temperature));
  return normalizeWeights(weights);
}

function futureLegProbabilities(
  players: Array<PressurePlayerState & { adjustedAverage: number }>
) {
  return normalizeWeights(players.map((player) => Math.pow(player.adjustedAverage, 1.65)));
}

function createMatchProbabilitySolver(
  legsToWin: number,
  nextLegProbabilities: number[]
) {
  // Exact dynamic programming is small for normal 2–4 player matches. For a
  // very large field/race, use a bounded approximation so a live dart can
  // never trigger an exponential amount of work on the spectator screen.
  if (Math.pow(legsToWin, nextLegProbabilities.length) > 5_000) {
    return (legsWon: number[]) =>
      normalizeWeights(
        legsWon.map((wins, index) => {
          const legsNeeded = Math.max(1, legsToWin - wins);
          return Math.pow(nextLegProbabilities[index], legsNeeded);
        })
      );
  }

  const memo = new Map<string, number[]>();

  function solve(state: number[]): number[] {
    const existingWinner = state.findIndex((wins) => wins >= legsToWin);
    if (existingWinner >= 0) {
      return state.map((_, index) => (index === existingWinner ? 1 : 0));
    }

    const key = state.join(':');
    const cached = memo.get(key);
    if (cached) return cached;

    const result = state.map(() => 0);
    for (let legWinner = 0; legWinner < state.length; legWinner += 1) {
      const nextState = state.slice();
      nextState[legWinner] += 1;
      const outcome = solve(nextState);
      for (let playerIndex = 0; playerIndex < result.length; playerIndex += 1) {
        result[playerIndex] += nextLegProbabilities[legWinner] * outcome[playerIndex];
      }
    }

    memo.set(key, result);
    return result;
  }

  return solve;
}

export function calculatePressureProjection(input: PressureEngineInput): PressureEngineProjection {
  const { players } = input;
  if (players.length === 0) return { players: [], favoritePlayerId: null };

  const prepared = players.map((player) => {
    const skillModel = createPressureSkillModel(
      player.historicalProfile,
      input.populationProfile
    );
    const average = adjustedAverage(
      player.threeDartAverage,
      player.dartsThrown,
      skillModel.threeDartAverage
    );
    return {
      ...player,
      adjustedAverage: average,
      expectedDarts: estimateExpectedDartsRemaining(
        player.scoreRemaining,
        average,
        input.finishRule,
        skillModel
      ),
      skillModel,
    };
  });

  let legProbabilities: number[];
  let matchProbabilities: number[];

  const winnerIndex = input.matchWinnerId
    ? prepared.findIndex((player) => player.id === input.matchWinnerId)
    : -1;
  if (winnerIndex >= 0) {
    legProbabilities = prepared.map((_, index) => (index === winnerIndex ? 1 : 0));
    matchProbabilities = legProbabilities;
  } else {
    legProbabilities = liveLegProbabilities(
      prepared,
      input.playOrder,
      input.currentPlayerId,
      input.dartsRemainingInTurn
    );
    const nextLegProbabilities = futureLegProbabilities(prepared);
    const legsWon = prepared.map((player) => player.legsWon);
    const solveMatchRace = createMatchProbabilitySolver(input.legsToWin, nextLegProbabilities);

    matchProbabilities = prepared.map(() => 0);
    for (let currentLegWinner = 0; currentLegWinner < prepared.length; currentLegWinner += 1) {
      const stateAfterLeg = legsWon.slice();
      stateAfterLeg[currentLegWinner] += 1;
      const outcome = solveMatchRace(stateAfterLeg);
      for (let playerIndex = 0; playerIndex < prepared.length; playerIndex += 1) {
        matchProbabilities[playerIndex] += legProbabilities[currentLegWinner] * outcome[playerIndex];
      }
    }
  }

  const projections = prepared.map((player, index) => ({
    id: player.id,
    scoreRemaining: player.scoreRemaining,
    legsWon: player.legsWon,
    threeDartAverage: player.threeDartAverage,
    dartsThrown: player.dartsThrown,
    adjustedThreeDartAverage: player.adjustedAverage,
    expectedDartsRemaining: player.expectedDarts,
    legWinProbability: legProbabilities[index],
    matchWinProbability: matchProbabilities[index],
    baselineThreeDartAverage: player.skillModel.threeDartAverage,
    historicalDarts: player.skillModel.historicalDarts,
    profileConfidence: player.skillModel.profileConfidence,
    profileSource: player.skillModel.profileSource,
    checkoutRate: player.skillModel.checkoutRate,
    populationCheckoutRate: player.skillModel.populationCheckoutRate,
    bustRate: player.skillModel.bustRate,
  }));
  let favoriteIndex = 0;
  for (let index = 1; index < projections.length; index += 1) {
    if (projections[index].matchWinProbability > projections[favoriteIndex].matchWinProbability) {
      favoriteIndex = index;
    }
  }

  return { players: projections, favoritePlayerId: projections[favoriteIndex]?.id ?? null };
}
