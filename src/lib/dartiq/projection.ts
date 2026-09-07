import {
  createDartIQSkillModel,
  type DartIQSkillModel,
  type DartIQPlayerHistoryProfile,
  type DartIQPopulationProfile,
} from './evidence';
import type { FairEndingPhase } from '@/utils/fairEnding';
import type { FinishRule } from '@/utils/x01';
import {
  createBehavioralOutcomeModel,
  DARTIQ_OUTCOME_CONFIGURATION,
  type DartIQOutcomeModel,
} from './model/outcomes';
import {
  combineCurrentLegWithMatch,
  combineOrderedFirstFinishPmfs,
  createCurrentLegMatchContinuations,
  createFirstFinishPmf,
  type DartIQFirstFinishPmf,
  type DartIQVisitKernel,
} from './model/race';
import { createDartIQVisitKernel, solveDartIQVisit } from './model/visit';

export const DARTIQ_PROJECTION_CONFIGURATION = Object.freeze({
  currentFormPriorDarts: 90,
  maximumVisits: 40,
});

export type DartIQPlayerState = {
  id: string;
  scoreRemaining: number;
  legsWon: number;
  threeDartAverage: number;
  dartsThrown: number;
  historicalProfile?: DartIQPlayerHistoryProfile;
  outcomeModel?: DartIQOutcomeModel;
};

export type DartIQEngineInput = {
  players: DartIQPlayerState[];
  startScore: number;
  playOrder: string[];
  currentPlayerId: string | null;
  currentVisitStartScore?: number;
  currentLegStarterId?: string;
  dartsRemainingInTurn: number;
  legsToWin: number;
  finishRule: FinishRule;
  matchWinnerId?: string | null;
  populationProfile?: DartIQPopulationProfile;
  fairEnding?: DartIQFairEndingProjectionInput;
};

export type DartIQFairEndingProjectionInput = {
  phase: FairEndingPhase;
  checkedOutPlayerIds: string[];
  tiebreakRound: number;
  tiebreakPlayerIds: string[];
  tiebreakScores: Record<string, number>;
  winnerId: string | null;
  pendingPlayerIds: string[];
  tiebreakDartsThrown: Record<string, number>;
};

export type DartIQPlayerProjection = DartIQPlayerState & {
  adjustedThreeDartAverage: number;
  expectedVisitsRemaining: number;
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

export type DartIQProjectionApproximationMode =
  | 'standard'
  | 'truncated-tail'
  | 'no-finish-fallback'
  | 'large-field-bounded'
  | 'fair-ending-weighted';

export type DartIQEngineProjection = {
  players: DartIQPlayerProjection[];
  favoritePlayerId: string | null;
  approximationMode: DartIQProjectionApproximationMode;
};

export type DartIQOpportunity = {
  leg: number;
  match: number;
  availability: 'standard';
  confidenceTier: ReturnType<DartIQOutcomeModel['distribution']>['confidenceTier'];
  stateBackoffLevel: ReturnType<DartIQOutcomeModel['distribution']>['stateBackoffLevel'];
  outcomeBackoffLevel: ReturnType<DartIQOutcomeModel['distribution']>['outcomeBackoffLevel'];
  sampleSize: number;
  exactStateSampleSize: number;
  eligibleForCommentary: boolean;
  approximationModes: DartIQProjectionApproximationMode[];
};

export type DartIQCandidateImpact = {
  scoreDelta: number;
  isDouble: boolean;
  probability: number;
  actorLegWpa: number;
  actorMatchWpa: number;
  legConsequence: number;
  matchConsequence: number;
};

export type DartIQNextDartAnalysis = {
  opportunity: DartIQOpportunity;
  candidates: DartIQCandidateImpact[];
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
    (clamp(average, 12, 130) * sampleDarts
      + historicalBaseline * DARTIQ_PROJECTION_CONFIGURATION.currentFormPriorDarts) /
      (sampleDarts + DARTIQ_PROJECTION_CONFIGURATION.currentFormPriorDarts),
    20,
    110
  );
}

function normalizeWeights(weights: number[]) {
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return weights.map(() => 1 / Math.max(1, weights.length));
  return weights.map((value) => value / total);
}

type PreparedDartIQPlayer = DartIQPlayerState & {
  adjustedAverage: number;
  skillModel: DartIQSkillModel;
  outcomeModel: DartIQOutcomeModel;
};

const FALLBACK_OUTCOME_MODEL = createBehavioralOutcomeModel();
type CachedVisitKernel = { maximumScore: number; kernel: DartIQVisitKernel };
const VISIT_KERNEL_CACHE = new WeakMap<DartIQOutcomeModel, Map<FinishRule, CachedVisitKernel>>();
const FINISH_PMF_CACHE = new WeakMap<
  DartIQOutcomeModel,
  Map<string, DartIQFirstFinishPmf>
>();

function getVisitKernel(
  model: DartIQOutcomeModel,
  finishRule: FinishRule,
  maximumScore: number
) {
  let byRule = VISIT_KERNEL_CACHE.get(model);
  if (!byRule) {
    byRule = new Map();
    VISIT_KERNEL_CACHE.set(model, byRule);
  }
  const requiredMaximum = Math.max(1, Math.ceil(maximumScore));
  const cached = byRule.get(finishRule);
  if (cached && cached.maximumScore >= requiredMaximum) return cached.kernel;
  const kernel = createDartIQVisitKernel(model, finishRule, requiredMaximum);
  byRule.set(finishRule, { maximumScore: requiredMaximum, kernel });
  return kernel;
}

function rotateOrder(playOrder: string[], firstPlayerId: string | null | undefined) {
  const firstIndex = Math.max(0, playOrder.indexOf(firstPlayerId ?? ''));
  return [...playOrder.slice(firstIndex), ...playOrder.slice(0, firstIndex)];
}

function expectedVisitsFromPmf(pmf: DartIQFirstFinishPmf) {
  let expected = 0;
  for (let index = 0; index < pmf.probabilities.length; index += 1) {
    expected += pmf.probabilities[index] * (index + 1);
  }
  if (pmf.truncatedMass > 0) {
    expected += pmf.truncatedMass * (pmf.probabilities.length + 1);
  }
  return expected;
}

function createPlayerPmf(
  player: PreparedDartIQPlayer,
  finishRule: FinishRule,
  partial?: { visitStartScore: number; dartsLeft: number }
) {
  const normalizedPartial = partial
    && !(partial.dartsLeft === 3 && partial.visitStartScore === player.scoreRemaining)
    ? partial
    : undefined;
  let byState = FINISH_PMF_CACHE.get(player.outcomeModel);
  if (!byState) {
    byState = new Map();
    FINISH_PMF_CACHE.set(player.outcomeModel, byState);
  }
  const key = normalizedPartial
    ? `${finishRule}:${player.scoreRemaining}:${normalizedPartial.visitStartScore}:${normalizedPartial.dartsLeft}`
    : `${finishRule}:${player.scoreRemaining}`;
  const cached = byState.get(key);
  if (cached) return cached;

  const kernel = getVisitKernel(
    player.outcomeModel,
    finishRule,
    Math.max(player.scoreRemaining, normalizedPartial?.visitStartScore ?? 0)
  );
  const firstVisit = normalizedPartial
    ? solveDartIQVisit(player.outcomeModel, {
        visitStartScore: normalizedPartial.visitStartScore,
        currentScore: player.scoreRemaining,
        dartsLeft: clamp(Math.floor(normalizedPartial.dartsLeft), 1, 3) as 1 | 2 | 3,
        finishRule,
      })
    : undefined;
  const pmf = createFirstFinishPmf({
    startScore: player.scoreRemaining,
    kernel,
    firstVisit,
    maximumVisits: DARTIQ_PROJECTION_CONFIGURATION.maximumVisits,
  });
  byState.set(key, pmf);
  return pmf;
}

function markovLegProbabilities(players: PreparedDartIQPlayer[], input: DartIQEngineInput) {
  const orderedIds = rotateOrder(input.playOrder, input.currentPlayerId ?? input.currentLegStarterId);
  const byId = new Map(players.map((player) => [player.id, player]));
  const orderedPlayers = orderedIds.map((id) => byId.get(id)).filter(Boolean) as PreparedDartIQPlayer[];
  const pmfs = orderedPlayers.map((player, index) => createPlayerPmf(
    player,
    input.finishRule,
    index === 0 && player.id === input.currentPlayerId
      ? {
          visitStartScore: input.currentVisitStartScore ?? player.scoreRemaining,
          dartsLeft: input.dartsRemainingInTurn,
        }
      : undefined
  ));
  const race = combineOrderedFirstFinishPmfs(pmfs);
  const probabilityById = new Map(
    orderedPlayers.map((player, index) => [player.id, race.probabilities[index] ?? 0])
  );
  return {
    probabilities: players.map((player) => probabilityById.get(player.id) ?? 0),
    pmfById: new Map(orderedPlayers.map((player, index) => [player.id, pmfs[index]])),
    approximationMode: race.approximationMode,
  };
}

function probabilityVectorConsequence(before: number[], after: number[]) {
  return before.reduce(
    (sum, probability, index) => sum + Math.abs((after[index] ?? 0) - probability),
    0
  ) / 2;
}

function combineLegVectorWithMatch(leg: number[], continuations: number[][]) {
  const match = new Array<number>(leg.length).fill(0);
  for (let winner = 0; winner < leg.length; winner += 1) {
    for (let player = 0; player < leg.length; player += 1) {
      match[player] += (leg[winner] ?? 0) * (continuations[winner]?.[player] ?? 0);
    }
  }
  return normalizeWeights(match);
}

function preparePlayers(input: DartIQEngineInput): PreparedDartIQPlayer[] {
  return input.players.map((player) => {
    const skillModel = createDartIQSkillModel(player.historicalProfile, input.populationProfile);
    return {
      ...player,
      adjustedAverage: adjustedAverage(
        player.threeDartAverage,
        player.dartsThrown,
        skillModel.threeDartAverage
      ),
      skillModel,
      outcomeModel: player.outcomeModel ?? FALLBACK_OUTCOME_MODEL,
    };
  });
}

/**
 * Enumerates the acting player's behavioral next-dart outcomes against the
 * same ordered race and match-continuation solvers used by the live forecast.
 * Special fair-ending play is deliberately unavailable until it has an
 * equally exact continuation model.
 */
export function calculateDartIQNextDartAnalysis(
  input: DartIQEngineInput,
  beforeProjection: Pick<DartIQEngineProjection, 'players'>
): DartIQNextDartAnalysis | null {
  if (input.fairEnding || input.matchWinnerId || !input.currentPlayerId) return null;
  const actorIndex = input.players.findIndex((player) => player.id === input.currentPlayerId);
  if (actorIndex < 0 || input.dartsRemainingInTurn < 1 || input.dartsRemainingInTurn > 3) return null;

  const prepared = preparePlayers(input);
  const actor = prepared[actorIndex];
  const distribution = actor.outcomeModel.distribution({
    currentScore: actor.scoreRemaining,
    dartsLeft: input.dartsRemainingInTurn as 1 | 2 | 3,
    finishRule: input.finishRule,
  });
  const beforeLeg = beforeProjection.players.map((player) => player.legWinProbability);
  const beforeMatch = beforeProjection.players.map((player) => player.matchWinProbability);
  const legsWon = prepared.map((player) => player.legsWon);
  const currentStarterIndex = Math.max(
    0,
    input.playOrder.indexOf(input.currentLegStarterId ?? input.playOrder[0])
  );
  const continuations = createCurrentLegMatchContinuations({
    legsWon,
    legsToWin: input.legsToWin,
    nextStarterIndex: (currentStarterIndex + 1) % prepared.length,
    futureLegProbabilitiesByStarter: futureLegProbabilitiesByStarter(
      prepared,
      input.playOrder,
      input.finishRule,
      input.startScore
    ),
  });
  const actorOrderIndex = Math.max(0, input.playOrder.indexOf(actor.id));
  const nextPlayerId = input.playOrder[(actorOrderIndex + 1) % input.playOrder.length] ?? null;
  const candidates: DartIQCandidateImpact[] = [];
  const approximationModes = new Set<DartIQProjectionApproximationMode>();
  if (continuations.approximationMode !== 'exact') {
    approximationModes.add('large-field-bounded');
  }

  for (const dart of distribution.outcomes) {
    if (!(dart.probability > 0)) continue;
    const nextScore = actor.scoreRemaining - dart.scoreDelta;
    const busted = nextScore < 0
      || (input.finishRule === 'double_out' && nextScore === 1)
      || (input.finishRule === 'double_out' && nextScore === 0 && !dart.isDouble);
    const finished = !busted && nextScore === 0;
    let leg: number[];
    if (finished) {
      leg = prepared.map((_, index) => index === actorIndex ? 1 : 0);
    } else {
      const candidatePlayers = prepared.map((player) => player.id === actor.id
        ? { ...player, scoreRemaining: busted ? input.currentVisitStartScore ?? actor.scoreRemaining : nextScore }
        : player
      );
      const visitContinues = !busted && input.dartsRemainingInTurn > 1;
      const candidateRace = markovLegProbabilities(candidatePlayers, {
        ...input,
        players: candidatePlayers,
        currentPlayerId: visitContinues ? actor.id : nextPlayerId,
        currentVisitStartScore: visitContinues
          ? input.currentVisitStartScore ?? actor.scoreRemaining
          : nextPlayerId
            ? candidatePlayers.find((player) => player.id === nextPlayerId)?.scoreRemaining
            : undefined,
        dartsRemainingInTurn: visitContinues ? input.dartsRemainingInTurn - 1 : 3,
      });
      leg = candidateRace.probabilities;
      if (candidateRace.approximationMode !== 'exact') {
        approximationModes.add(candidateRace.approximationMode);
      }
    }
    const match = combineLegVectorWithMatch(leg, continuations.probabilities);
    candidates.push({
      scoreDelta: dart.scoreDelta,
      isDouble: dart.isDouble,
      probability: dart.probability,
      actorLegWpa: (leg[actorIndex] ?? 0) - (beforeLeg[actorIndex] ?? 0),
      actorMatchWpa: (match[actorIndex] ?? 0) - (beforeMatch[actorIndex] ?? 0),
      legConsequence: probabilityVectorConsequence(beforeLeg, leg),
      matchConsequence: probabilityVectorConsequence(beforeMatch, match),
    });
  }

  return {
    opportunity: {
      leg: candidates.reduce((sum, candidate) => sum + candidate.probability * candidate.legConsequence, 0),
      match: candidates.reduce((sum, candidate) => sum + candidate.probability * candidate.matchConsequence, 0),
      availability: 'standard',
      confidenceTier: distribution.confidenceTier,
      stateBackoffLevel: distribution.stateBackoffLevel,
      outcomeBackoffLevel: distribution.outcomeBackoffLevel,
      sampleSize: distribution.sampleSize,
      exactStateSampleSize: distribution.exactStateSampleSize,
      eligibleForCommentary: distribution.confidenceTier !== 'fallback'
        && distribution.outcomeBackoffLevel === 'exact'
        && distribution.exactStateSampleSize >= DARTIQ_OUTCOME_CONFIGURATION.exactOutcomeThreshold
        && approximationModes.size === 0,
      approximationModes: [...approximationModes],
    },
    candidates,
  };
}

function futureLegProbabilitiesByStarter(
  players: PreparedDartIQPlayer[],
  playOrder: string[],
  finishRule: FinishRule,
  startScore: number
) {
  const byId = new Map(players.map((player) => [
    player.id,
    { ...player, scoreRemaining: startScore },
  ]));
  return playOrder.map((starterId) => {
    const orderedPlayers = rotateOrder(playOrder, starterId)
      .map((id) => byId.get(id))
      .filter(Boolean) as PreparedDartIQPlayer[];
    const race = combineOrderedFirstFinishPmfs(
      orderedPlayers.map((player) => createPlayerPmf(player, finishRule))
    );
    const probabilityById = new Map(
      orderedPlayers.map((player, index) => [player.id, race.probabilities[index] ?? 0])
    );
    return players.map((player) => probabilityById.get(player.id) ?? 0);
  });
}

function tiebreakStrength(player: PreparedDartIQPlayer) {
  return Math.pow(clamp(player.adjustedAverage, 20, 110), 1.35);
}

function checkoutChanceWithinVisit(
  player: PreparedDartIQPlayer,
  dartsRemaining: number,
  finishRule: FinishRule
) {
  const darts = clamp(Math.floor(dartsRemaining), 0, 3);
  if (player.scoreRemaining <= 0) return 1;
  if (darts === 0) return 0;
  const distribution = solveDartIQVisit(player.outcomeModel, {
    visitStartScore: player.scoreRemaining,
    currentScore: player.scoreRemaining,
    dartsLeft: darts as 1 | 2 | 3,
    finishRule,
  });
  return distribution.get(0) ?? 0;
}

/**
 * Deterministic bounded approximation for the special fair-ending phases.
 * It deliberately exposes its approximation mode rather than presenting a
 * weighted tiebreak forecast as an exact analytical probability.
 */
function fairEndingLegProbabilities(
  players: PreparedDartIQPlayer[],
  input: DartIQEngineInput,
  fairEnding: DartIQFairEndingProjectionInput
) {
  const playerIndex = new Map(players.map((player, index) => [player.id, index]));
  const result = players.map(() => 0);

  if (fairEnding.phase === 'resolved' && fairEnding.winnerId) {
    const winnerIndex = playerIndex.get(fairEnding.winnerId);
    if (winnerIndex !== undefined) result[winnerIndex] = 1;
    return result;
  }

  if (fairEnding.phase === 'completing_round') {
    const checkedOut = new Set(fairEnding.checkedOutPlayerIds);
    const pending = new Set(fairEnding.pendingPlayerIds);
    const joinChances = new Map<string, number>();

    for (const player of players) {
      if (!pending.has(player.id)) continue;
      const darts = player.id === input.currentPlayerId ? input.dartsRemainingInTurn : 3;
      const chance = checkoutChanceWithinVisit(player, darts, input.finishRule);
      joinChances.set(player.id, chance);
    }

    const pendingPlayers = players.filter((player) => pending.has(player.id));
    if (pendingPlayers.length <= 10) {
      const checkedOutPlayers = players.filter((player) => checkedOut.has(player.id));
      const subsetCount = 2 ** pendingPlayers.length;
      for (let mask = 0; mask < subsetCount; mask += 1) {
        let subsetProbability = 1;
        const participants = checkedOutPlayers.slice();
        for (let index = 0; index < pendingPlayers.length; index += 1) {
          const player = pendingPlayers[index];
          const joins = (mask & (1 << index)) !== 0;
          const chance = joinChances.get(player.id) ?? 0;
          subsetProbability *= joins ? chance : 1 - chance;
          if (joins) participants.push(player);
        }
        if (!(subsetProbability > 0) || participants.length === 0) continue;
        if (participants.length === 1) {
          result[playerIndex.get(participants[0].id)!] += subsetProbability;
          continue;
        }
        const strengthTotal = participants.reduce(
          (sum, player) => sum + tiebreakStrength(player),
          0
        );
        for (const participant of participants) {
          result[playerIndex.get(participant.id)!] += subsetProbability
            * tiebreakStrength(participant)
            / strengthTotal;
        }
      }
      return normalizeWeights(result);
    }

    // Large-field bounded path: preserve each player's identity and join
    // probability without enumerating an exponential number of subsets.
    let nobodyElseChecksOut = 1;
    for (const chance of joinChances.values()) nobodyElseChecksOut *= 1 - chance;
    const conditionalWeights = players.map((player) => {
      if (checkedOut.has(player.id)) return tiebreakStrength(player);
      const joinChance = joinChances.get(player.id) ?? 0;
      return joinChance * tiebreakStrength(player);
    });
    const conditional = normalizeWeights(conditionalWeights);

    if (checkedOut.size === 1) {
      const tieProbability = 1 - nobodyElseChecksOut;
      for (let index = 0; index < result.length; index += 1) {
        result[index] = conditional[index] * tieProbability;
        if (checkedOut.has(players[index].id)) result[index] += nobodyElseChecksOut;
      }
      return normalizeWeights(result);
    }

    return conditional;
  }

  if (fairEnding.phase === 'tiebreak') {
    const eligible = new Set(fairEnding.tiebreakPlayerIds);
    const highestRecorded = Math.max(...players.filter((player) => eligible.has(player.id))
      .map((player) => fairEnding.tiebreakScores[player.id] ?? 0));
    const expectedTotals = players.map((player) => {
      if (!eligible.has(player.id)) return Number.NEGATIVE_INFINITY;
      const dartsThrown = clamp(fairEnding.tiebreakDartsThrown[player.id] ?? 0, 0, 3);
      const currentScore = fairEnding.tiebreakScores[player.id] ?? 0;
      // Weighted forecasts must still respect physical impossibility. Equality
      // remains eligible because a tied round can advance to another round.
      if (currentScore + (3 - dartsThrown) * 60 < highestRecorded) return Number.NEGATIVE_INFINITY;
      return currentScore + (3 - dartsThrown) * (player.adjustedAverage / 3);
    });
    const bestExpected = Math.max(...expectedTotals);
    const temperature = 22 + Math.max(0, eligible.size - 2) * 2;
    return normalizeWeights(expectedTotals.map((total) =>
      Number.isFinite(total) ? Math.exp((total - bestExpected) / temperature) : 0
    ));
  }

  return markovLegProbabilities(players, input).probabilities;
}

export function calculateDartIQProjection(input: DartIQEngineInput): DartIQEngineProjection {
  const { players } = input;
  if (players.length === 0) {
    return { players: [], favoritePlayerId: null, approximationMode: 'standard' };
  }

  const prepared = preparePlayers(input);

  let legProbabilities: number[];
  let matchProbabilities: number[];
  let currentLegPmfs: Map<string, DartIQFirstFinishPmf> | null = null;
  let projectionApproximation: DartIQEngineProjection['approximationMode'] = 'standard';

  const winnerIndex = input.matchWinnerId
    ? prepared.findIndex((player) => player.id === input.matchWinnerId)
    : -1;
  if (winnerIndex >= 0) {
    legProbabilities = prepared.map((_, index) => (index === winnerIndex ? 1 : 0));
    matchProbabilities = legProbabilities;
  } else {
    const liveLeg = input.fairEnding && input.fairEnding.phase !== 'normal'
      ? null
      : markovLegProbabilities(prepared, input);
    currentLegPmfs = liveLeg?.pmfById ?? null;
    legProbabilities = input.fairEnding && input.fairEnding.phase !== 'normal'
      ? fairEndingLegProbabilities(prepared, input, input.fairEnding)
      : liveLeg!.probabilities;
    if (input.fairEnding && input.fairEnding.phase !== 'normal') {
      projectionApproximation = 'fair-ending-weighted';
    } else if (
      liveLeg?.approximationMode === 'truncated-tail'
      || liveLeg?.approximationMode === 'no-finish-fallback'
    ) {
      projectionApproximation = liveLeg.approximationMode;
    }
    const legsWon = prepared.map((player) => player.legsWon);
    const currentStarterIndex = Math.max(
      0,
      input.playOrder.indexOf(input.currentLegStarterId ?? input.playOrder[0])
    );
    const matchRace = combineCurrentLegWithMatch({
      currentLegProbabilities: legProbabilities,
      legsWon,
      legsToWin: input.legsToWin,
      nextStarterIndex: (currentStarterIndex + 1) % prepared.length,
      futureLegProbabilitiesByStarter: futureLegProbabilitiesByStarter(
        prepared,
        input.playOrder,
        input.finishRule,
        input.startScore
      ),
    });
    matchProbabilities = matchRace.probabilities;
    if (matchRace.approximationMode !== 'exact') {
      projectionApproximation = 'large-field-bounded';
    }
  }

  const projections = prepared.map((player, index) => ({
    id: player.id,
    scoreRemaining: player.scoreRemaining,
    legsWon: player.legsWon,
    threeDartAverage: player.threeDartAverage,
    dartsThrown: player.dartsThrown,
    adjustedThreeDartAverage: player.adjustedAverage,
    expectedVisitsRemaining: player.scoreRemaining <= 0 ? 0 : expectedVisitsFromPmf(
      currentLegPmfs?.get(player.id) ?? createPlayerPmf(
        player,
        input.finishRule,
        player.id === input.currentPlayerId
          ? {
              visitStartScore: input.currentVisitStartScore ?? player.scoreRemaining,
              dartsLeft: input.dartsRemainingInTurn,
            }
          : undefined
      )
    ),
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

  return {
    players: projections,
    favoritePlayerId: projections[favoriteIndex]?.id ?? null,
    approximationMode: projectionApproximation,
  };
}
