import type { LegRecord, ThrowRecord, TurnWithThrows } from '../lib/match/types.ts';
import { parseSegmentLabel } from './legScoreCalculator.ts';
import {
  evaluateDartSetup,
  hasCheckoutRoute,
  type PressureCheckoutAssessment,
} from './pressureCheckout.ts';
import {
  calculatePressureProjection,
  type PressureFairEndingProjectionInput,
  type PressurePlayerProjection,
} from './pressureEngine.ts';
import {
  computeFairEndingState,
  getNextFairEndingPlayer,
  getPendingFairEndingPlayerIds,
  type FairEndingState,
  type FairEndingTurnInput,
} from './fairEnding.ts';
import type {
  PressurePlayerHistoryProfile,
  PressurePopulationProfile,
} from './pressureProfiles.ts';
import {
  PRESSURE_OUTCOME_MODEL_VERSION,
  type PressureOutcomeModel,
} from './pressureOutcomeModel.ts';
import { applyThrow, type FinishRule } from './x01.ts';
import {
  calculateProbabilityVectorConsequence,
  type PressureConsequence,
} from './pressureSignificance.ts';

type ReplayLeg = Pick<LegRecord, 'id' | 'match_id' | 'leg_number' | 'starting_player_id' | 'winner_player_id'>;

export type PressureReplayInput = {
  playerIds: string[];
  legs: ReplayLeg[];
  turnsByLeg: Record<string, TurnWithThrows[]>;
  startScore: number;
  finishRule: FinishRule;
  legsToWin: number;
  initialLegsWon?: Record<string, number>;
  playerProfiles?: Record<string, PressurePlayerHistoryProfile>;
  populationProfile?: PressurePopulationProfile;
  outcomeModels?: Record<string, PressureOutcomeModel>;
  fairEnding?: boolean;
};

export type PressureReplayOptions = {
  /** Previously verified prefix. Its state transitions are reused while only new darts are projected. */
  cachedPrefix?: PressureDartEvent[];
};

export type PressureFairEndingReplayState = PressureFairEndingProjectionInput & {
  approximationMode: 'standard' | 'fair-ending-weighted';
};

export type PressureReplayState = {
  legId: string;
  legNumber: number;
  currentPlayerId: string | null;
  dartsRemainingInTurn: number;
  scores: Record<string, number>;
  legsWon: Record<string, number>;
  projections: PressurePlayerProjection[];
  fairEnding: PressureFairEndingReplayState | null;
};

export type PressureDartEvent = {
  eventId: string;
  engineVersion: typeof PRESSURE_OUTCOME_MODEL_VERSION;
  matchId: string;
  sequence: number;
  legId: string;
  legNumber: number;
  turnId: string;
  playerId: string;
  dartId: string;
  dartIndex: number;
  segment: string;
  scored: number;
  turnScoreAfter: number;
  busted: boolean;
  checkedOut: boolean;
  semanticStakes: {
    directCheckoutOpportunity: boolean;
    checkoutVisitOpportunity: boolean;
    matchCheckoutOpportunity: boolean;
  };
  consequence: PressureConsequence;
  checkout: PressureCheckoutAssessment;
  fairEndingBefore: PressureFairEndingReplayState | null;
  fairEndingAfter: PressureFairEndingReplayState | null;
  before: PressureReplayState;
  after: PressureReplayState;
  matchWinProbabilityAdded: Record<string, number>;
  legWinProbabilityAdded: Record<string, number>;
};

type FlatDart = {
  leg: ReplayLeg;
  legIndex: number;
  turn: TurnWithThrows;
  dart: ThrowRecord;
  isLastInLeg: boolean;
};

type ReplayTurnProgress = FairEndingTurnInput & {
  id: string;
};

function rotatePlayerOrder(playerIds: string[], startingPlayerId: string) {
  const startIndex = playerIds.indexOf(startingPlayerId);
  if (startIndex <= 0) return playerIds.slice();
  return [...playerIds.slice(startIndex), ...playerIds.slice(0, startIndex)];
}

function createNumberRecord(playerIds: string[], initialValue: number) {
  return Object.fromEntries(playerIds.map((playerId) => [playerId, initialValue]));
}

function tiebreakCheckoutAssessment(): PressureCheckoutAssessment {
  return {
    checkoutProbabilityBefore: 0,
    checkoutProbabilityAfter: 0,
    nextVisitCheckoutProbability: 0,
    bestAvailableLeaveValue: 0,
    actualLeaveValue: 0,
    setupQuality: 1,
    setupGrade: 'neutral',
    bestSegment: null,
    createdBogey: false,
    avoidedBogey: false,
  };
}

function flattenDarts(input: PressureReplayInput): FlatDart[] {
  const events: FlatDart[] = [];
  const sortedLegs = input.legs.slice().sort((a, b) => a.leg_number - b.leg_number);

  sortedLegs.forEach((leg, legIndex) => {
    const legEvents: Omit<FlatDart, 'isLastInLeg'>[] = [];
    const turns = (input.turnsByLeg[leg.id] ?? []).slice().sort((a, b) => a.turn_number - b.turn_number);
    for (const turn of turns) {
      const throws = (turn.throws ?? []).slice().sort((a, b) => a.dart_index - b.dart_index);
      for (const dart of throws) legEvents.push({ leg, legIndex, turn, dart });
    }
    legEvents.forEach((event, index) => {
      events.push({ ...event, isLastInLeg: index === legEvents.length - 1 });
    });
  });

  return events;
}

function matchesCachedDart(flat: FlatDart | undefined, cached: PressureDartEvent) {
  return flat?.dart.id === cached.dartId
    && flat.turn.id === cached.turnId
    && flat.dart.dart_index === cached.dartIndex
    && flat.dart.segment === cached.segment
    && flat.dart.scored === cached.scored;
}

/**
 * Reconstructs the full pressure timeline in a single chronological pass.
 * Score and form accumulators are mutated internally, while every returned
 * state is copied so consumers can safely retain or serialize the timeline.
 */
export function reconstructPressureTimeline(
  input: PressureReplayInput,
  options: PressureReplayOptions = {}
): PressureDartEvent[] {
  if (input.playerIds.length === 0 || input.legs.length === 0) return [];
  const orderedLegs = input.legs.slice().sort((a, b) => a.leg_number - b.leg_number);
  const darts = flattenDarts({ ...input, legs: orderedLegs });
  if (darts.length === 0) return [];

  const scores = createNumberRecord(input.playerIds, input.startScore);
  const legsWon = Object.fromEntries(
    input.playerIds.map((playerId) => [playerId, input.initialLegsWon?.[playerId] ?? 0])
  );
  const points = createNumberRecord(input.playerIds, 0);
  const dartsThrown = createNumberRecord(input.playerIds, 0);
  let activeLegIndex = darts[0].legIndex;
  let turnId: string | null = null;
  let turnStartScore = input.startScore;
  let turnStartPoints = 0;
  let turnStartDarts = 0;
  let matchWinnerId: string | null = null;
  const turnProgress = new Map<string, ReplayTurnProgress>();

  function buildFairEndingContext(
    leg: ReplayLeg,
    turns: ReplayTurnProgress[]
  ): PressureFairEndingProjectionInput | undefined {
    if (!input.fairEnding) return undefined;
    const playOrder = rotatePlayerOrder(input.playerIds, leg.starting_player_id);
    const orderPlayers = playOrder.map((id) => ({ id }));
    const state = computeFairEndingState(turns, orderPlayers, input.startScore, true);
    const tiebreakDartsThrown: Record<string, number> = {};
    for (const playerId of state.tiebreakPlayerIds) tiebreakDartsThrown[playerId] = 0;
    for (const progress of turns) {
      if (progress.tiebreak_round === state.tiebreakRound) {
        tiebreakDartsThrown[progress.player_id] = progress.throw_count ?? 0;
      }
    }
    return {
      ...state,
      pendingPlayerIds: getPendingFairEndingPlayerIds(state, orderPlayers, turns),
      tiebreakDartsThrown,
    };
  }

  function createState(
    leg: ReplayLeg,
    currentPlayerId: string | null,
    dartsRemainingInTurn: number,
    fairEnding: PressureFairEndingProjectionInput | undefined,
    currentVisitStartScore?: number
  ): PressureReplayState {
    const playOrder = rotatePlayerOrder(input.playerIds, leg.starting_player_id);
    const projections = calculatePressureProjection({
      players: input.playerIds.map((playerId) => ({
        id: playerId,
        scoreRemaining: scores[playerId],
        legsWon: legsWon[playerId],
        threeDartAverage: dartsThrown[playerId] > 0
          ? (points[playerId] / dartsThrown[playerId]) * 3
          : 0,
        dartsThrown: dartsThrown[playerId],
        historicalProfile: input.playerProfiles?.[playerId],
        outcomeModel: input.outcomeModels?.[playerId],
      })),
      playOrder,
      currentPlayerId,
      currentVisitStartScore,
      currentLegStarterId: leg.starting_player_id,
      dartsRemainingInTurn,
      legsToWin: input.legsToWin,
      finishRule: input.finishRule,
      matchWinnerId,
      populationProfile: input.populationProfile,
      fairEnding,
    });

    return {
      legId: leg.id,
      legNumber: leg.leg_number,
      currentPlayerId,
      dartsRemainingInTurn,
      scores: { ...scores },
      legsWon: { ...legsWon },
      projections: projections.players,
      fairEnding: fairEnding
        ? {
            ...fairEnding,
            approximationMode: fairEnding.phase === 'normal'
              ? 'standard'
              : 'fair-ending-weighted',
          }
        : null,
    };
  }

  const reusablePrefix = (options.cachedPrefix ?? []).every(
    (cached, index) => matchesCachedDart(darts[index], cached)
  ) ? (options.cachedPrefix ?? []) : [];
  if (reusablePrefix.length === darts.length) return reusablePrefix;

  const timeline: PressureDartEvent[] = [...reusablePrefix];
  let currentFairEnding: PressureFairEndingProjectionInput | undefined;
  let before: PressureReplayState;
  if (reusablePrefix.length > 0) {
    const lastCached = reusablePrefix.at(-1)!;
    const lastFlat = darts[reusablePrefix.length - 1];
    activeLegIndex = lastFlat.legIndex;
    Object.assign(scores, lastCached.after.scores);
    Object.assign(legsWon, lastCached.after.legsWon);
    for (const projection of lastCached.after.projections) {
      dartsThrown[projection.id] = projection.dartsThrown;
      points[projection.id] = projection.dartsThrown > 0
        ? (projection.threeDartAverage / 3) * projection.dartsThrown
        : 0;
    }
    for (let index = 0; index < reusablePrefix.length; index += 1) {
      const flat = darts[index];
      const cached = reusablePrefix[index];
      const previous = turnProgress.get(flat.turn.id);
      const throwCount = (previous?.throw_count ?? 0) + 1;
      const throwsTotal = (previous?.throws_total ?? 0) + flat.dart.scored;
      turnProgress.set(flat.turn.id, {
        id: flat.turn.id,
        player_id: flat.turn.player_id,
        total_scored: cached.turnScoreAfter,
        busted: cached.busted,
        tiebreak_round: flat.turn.tiebreak_round,
        throw_count: throwCount,
        throws_total: throwsTotal,
        completed: cached.busted || cached.checkedOut || throwCount >= 3,
      });
    }
    turnId = lastFlat.turn.id;
    const firstInTurn = reusablePrefix.find((event) => event.turnId === turnId)!;
    const startProjection = firstInTurn.before.projections.find((entry) => entry.id === lastFlat.turn.player_id);
    turnStartScore = firstInTurn.before.scores[lastFlat.turn.player_id] ?? input.startScore;
    turnStartDarts = startProjection?.dartsThrown ?? 0;
    turnStartPoints = startProjection && startProjection.dartsThrown > 0
      ? (startProjection.threeDartAverage / 3) * startProjection.dartsThrown
      : 0;
    currentFairEnding = lastCached.fairEndingAfter ?? undefined;
    before = lastCached.after;
  } else {
    currentFairEnding = buildFairEndingContext(darts[0].leg, []);
    before = createState(
      darts[0].leg,
      darts[0].turn.player_id,
      Math.max(1, 4 - darts[0].dart.dart_index),
      currentFairEnding,
      scores[darts[0].turn.player_id]
    );
  }

  for (let index = reusablePrefix.length; index < darts.length; index += 1) {
    const event = darts[index];
    const nextEvent = darts[index + 1];

    if (event.legIndex !== activeLegIndex) {
      activeLegIndex = event.legIndex;
      for (const playerId of input.playerIds) scores[playerId] = input.startScore;
      turnProgress.clear();
      currentFairEnding = buildFairEndingContext(event.leg, []);
    }

    const fairEndingBefore = before.fairEnding;
    if (turnId !== event.turn.id) {
      turnId = event.turn.id;
      turnStartScore = scores[event.turn.player_id];
      turnStartPoints = points[event.turn.player_id];
      turnStartDarts = dartsThrown[event.turn.player_id];
    }

    const playerId = event.turn.player_id;
    const isTiebreak = event.turn.tiebreak_round != null;
    const segment = parseSegmentLabel(event.dart.segment);
    const outcome = isTiebreak
      ? { newScore: scores[playerId], busted: false, finished: false }
      : applyThrow(scores[playerId], segment, input.finishRule);
    const playerProjectionBefore = before.projections.find((projection) => projection.id === playerId);

    if (isTiebreak) {
      // High-round darts do not modify the already-completed X01 score or the
      // X01 form sample used by the probability model.
    } else if (outcome.busted) {
      scores[playerId] = turnStartScore;
      points[playerId] = turnStartPoints;
      dartsThrown[playerId] = turnStartDarts;
    } else {
      points[playerId] += scores[playerId] - outcome.newScore;
      dartsThrown[playerId] += 1;
      scores[playerId] = outcome.newScore;
    }
    const previousProgress = turnProgress.get(event.turn.id);
    const throwCount = (previousProgress?.throw_count ?? 0) + 1;
    const throwsTotal = (previousProgress?.throws_total ?? 0) + event.dart.scored;
    const turnScoreAfter = isTiebreak
      ? throwsTotal
      : outcome.busted ? 0 : turnStartScore - scores[playerId];
    turnProgress.set(event.turn.id, {
      id: event.turn.id,
      player_id: playerId,
      total_scored: turnScoreAfter,
      busted: outcome.busted,
      tiebreak_round: event.turn.tiebreak_round,
      throw_count: throwCount,
      throws_total: throwsTotal,
      completed: outcome.busted || outcome.finished || throwCount >= 3,
    });
    currentFairEnding = buildFairEndingContext(event.leg, [...turnProgress.values()]);

    const checkout = isTiebreak
      ? tiebreakCheckoutAssessment()
      : evaluateDartSetup({
          scoreBefore: before.scores[playerId] ?? turnStartScore,
          scoreAfter: outcome.busted ? turnStartScore : outcome.newScore,
          dartsRemainingBefore: before.dartsRemainingInTurn,
          segment: event.dart.segment,
          threeDartAverage: playerProjectionBefore?.adjustedThreeDartAverage ?? 45,
          finishRule: input.finishRule,
          busted: outcome.busted,
          checkedOut: outcome.finished,
          checkoutRate: playerProjectionBefore?.checkoutRate,
          populationCheckoutRate: playerProjectionBefore?.populationCheckoutRate,
          bustRate: playerProjectionBefore?.bustRate,
        });

    let stateLeg = event.leg;
    let nextPlayerId: string | null;
    let nextDartsRemaining: number;
    let resolvedLegWinnerId: string | null = null;

    const fairEndingWinnerId = input.fairEnding && currentFairEnding?.phase === 'resolved'
      ? currentFairEnding.winnerId
      : null;
    const standardWinnerId = !input.fairEnding && event.isLastInLeg
      ? event.leg.winner_player_id
      : null;
    const legWinnerId = fairEndingWinnerId ?? standardWinnerId;

    if (legWinnerId) {
      resolvedLegWinnerId = legWinnerId;
      legsWon[legWinnerId] = (legsWon[legWinnerId] ?? 0) + 1;
      if (legsWon[legWinnerId] >= input.legsToWin) matchWinnerId = legWinnerId;

      const nextLeg = orderedLegs[event.legIndex + 1];
      if (!matchWinnerId && nextLeg) {
        for (const id of input.playerIds) scores[id] = input.startScore;
        stateLeg = nextLeg;
        nextPlayerId = nextLeg.starting_player_id;
        nextDartsRemaining = 3;
      } else {
        nextPlayerId = null;
        nextDartsRemaining = 0;
      }
    } else if (input.fairEnding && currentFairEnding?.phase !== 'normal') {
      const playOrder = rotatePlayerOrder(input.playerIds, event.leg.starting_player_id);
      nextPlayerId = getNextFairEndingPlayer(
        currentFairEnding as FairEndingState,
        playOrder.map((id) => ({ id })),
        [...turnProgress.values()]
      );
      nextDartsRemaining = nextPlayerId === playerId && throwCount < 3
        ? 3 - throwCount
        : 3;
    } else if (nextEvent && nextEvent.leg.id === event.leg.id) {
      nextPlayerId = nextEvent.turn.player_id;
      nextDartsRemaining = Math.max(1, 4 - nextEvent.dart.dart_index);
    } else if (outcome.busted || event.dart.dart_index >= 3) {
      const playOrder = rotatePlayerOrder(input.playerIds, event.leg.starting_player_id);
      const playerIndex = Math.max(0, playOrder.indexOf(playerId));
      nextPlayerId = playOrder[(playerIndex + 1) % playOrder.length] ?? null;
      nextDartsRemaining = 3;
    } else {
      nextPlayerId = playerId;
      nextDartsRemaining = Math.max(0, 3 - event.dart.dart_index);
    }

    const stateFairEnding = stateLeg.id === event.leg.id
      ? currentFairEnding
      : buildFairEndingContext(stateLeg, []);
    const after = createState(
      stateLeg,
      nextPlayerId,
      nextDartsRemaining,
      stateFairEnding,
      nextPlayerId === playerId && stateLeg.id === event.leg.id
        ? turnStartScore
        : nextPlayerId ? scores[nextPlayerId] : undefined
    );
    const matchWinProbabilityAdded: Record<string, number> = {};
    const legWinProbabilityAdded: Record<string, number> = {};
    const beforeByPlayer = new Map(before.projections.map((projection) => [projection.id, projection]));
    for (const projection of after.projections) {
      const previous = beforeByPlayer.get(projection.id);
      matchWinProbabilityAdded[projection.id] = projection.matchWinProbability - (previous?.matchWinProbability ?? 0);
      const afterLegProbability = resolvedLegWinnerId
        ? (projection.id === resolvedLegWinnerId ? 1 : 0)
        : projection.legWinProbability;
      legWinProbabilityAdded[projection.id] = afterLegProbability - (previous?.legWinProbability ?? 0);
    }
    const consequenceAfter = after.projections.map((projection) => ({
      ...projection,
      legWinProbability: resolvedLegWinnerId
        ? (projection.id === resolvedLegWinnerId ? 1 : 0)
        : projection.legWinProbability,
    }));
    const consequence = calculateProbabilityVectorConsequence(
      before.projections,
      consequenceAfter
    );

    timeline.push({
      eventId: `${PRESSURE_OUTCOME_MODEL_VERSION}:${event.leg.match_id}:${event.dart.id}`,
      engineVersion: PRESSURE_OUTCOME_MODEL_VERSION,
      matchId: event.leg.match_id,
      sequence: index + 1,
      legId: event.leg.id,
      legNumber: event.leg.leg_number,
      turnId: event.turn.id,
      playerId,
      dartId: event.dart.id,
      dartIndex: event.dart.dart_index,
      segment: event.dart.segment,
      scored: event.dart.scored,
      turnScoreAfter,
      busted: outcome.busted,
      checkedOut: outcome.finished,
      semanticStakes: (() => {
        const scoreBefore = before.scores[playerId] ?? 0;
        const directCheckoutOpportunity = !isTiebreak
          && hasCheckoutRoute(scoreBefore, 1, input.finishRule);
        const checkoutVisitOpportunity = !isTiebreak
          && hasCheckoutRoute(scoreBefore, before.dartsRemainingInTurn, input.finishRule);
        return {
          directCheckoutOpportunity,
          checkoutVisitOpportunity,
          matchCheckoutOpportunity: checkoutVisitOpportunity
            && (before.legsWon[playerId] ?? 0) === input.legsToWin - 1,
        };
      })(),
      consequence,
      checkout,
      fairEndingBefore,
      fairEndingAfter: currentFairEnding
        ? {
            ...currentFairEnding,
            approximationMode: currentFairEnding.phase === 'normal'
              ? 'standard'
              : 'fair-ending-weighted',
          }
        : null,
      before,
      after,
      matchWinProbabilityAdded,
      legWinProbabilityAdded,
    });
    before = after;
  }

  return timeline;
}
