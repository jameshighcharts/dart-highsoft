import type { LegRecord, ThrowRecord, TurnWithThrows } from '@/lib/match/types';
import { parseSegmentLabel } from '@/utils/legScoreCalculator';
import {
  evaluateDartSetup,
  estimateCheckoutProbability,
  hasCheckoutRoute,
  type DartIQCheckoutAssessment,
} from './checkout';
import {
  calculateDartIQProjection,
  type DartIQFairEndingProjectionInput,
  type DartIQPlayerProjection,
  type DartIQProjectionApproximationMode,
} from './projection';
import {
  computeFairEndingState,
  getNextFairEndingPlayer,
  getPendingFairEndingPlayerIds,
  type FairEndingState,
  type FairEndingTurnInput,
} from '@/utils/fairEnding';
import type {
  DartIQPlayerHistoryProfile,
  DartIQPopulationProfile,
} from './evidence';
import {
  DARTIQ_OUTCOME_MODEL_VERSION,
  type DartIQOutcomeModel,
} from './model/outcomes';
import { applyThrow, type FinishRule } from '@/utils/x01';

export type DartIQProbabilityPoint = {
  id: string;
  legWinProbability: number;
  matchWinProbability: number;
};

export type DartIQConsequence = {
  leg: number;
  match: number;
};

export function calculateProbabilityVectorConsequence(
  before: DartIQProbabilityPoint[],
  after: DartIQProbabilityPoint[]
): DartIQConsequence {
  const beforeById = new Map(before.map((player) => [player.id, player]));
  const afterById = new Map(after.map((player) => [player.id, player]));
  const playerIds = new Set([...beforeById.keys(), ...afterById.keys()]);
  let leg = 0;
  let match = 0;
  for (const playerId of playerIds) {
    const previous = beforeById.get(playerId);
    const next = afterById.get(playerId);
    leg += Math.abs((next?.legWinProbability ?? 0) - (previous?.legWinProbability ?? 0));
    match += Math.abs((next?.matchWinProbability ?? 0) - (previous?.matchWinProbability ?? 0));
  }
  return { leg: leg / 2, match: match / 2 };
}

export type DartIQReplayLeg = Pick<LegRecord, 'id' | 'match_id' | 'leg_number' | 'starting_player_id' | 'winner_player_id'>;

export type DartIQReplayInput = {
  playerIds: string[];
  legs: DartIQReplayLeg[];
  turnsByLeg: Record<string, TurnWithThrows[]>;
  startScore: number;
  finishRule: FinishRule;
  legsToWin: number;
  initialLegsWon?: Record<string, number>;
  playerProfiles?: Record<string, DartIQPlayerHistoryProfile>;
  populationProfile?: DartIQPopulationProfile;
  outcomeModels?: Record<string, DartIQOutcomeModel>;
  fairEnding?: boolean;
};

export type DartIQReplayOptions = {
  /** Previously verified prefix. Its state transitions are reused while only new darts are projected. */
  cachedPrefix?: DartIQDartEvent[];
  /** Immutable accumulator snapshot immediately after cachedPrefix. */
  cachedCheckpoint?: DartIQReplayCheckpoint | null;
};

export type DartIQFairEndingReplayState = DartIQFairEndingProjectionInput & {
  approximationMode: 'standard' | 'fair-ending-weighted';
};

export type DartIQReplayState = {
  legId: string;
  legNumber: number;
  currentPlayerId: string | null;
  currentVisitStartScore?: number | null;
  dartsRemainingInTurn: number;
  scores: Record<string, number>;
  legsWon: Record<string, number>;
  projections: DartIQPlayerProjection[];
  approximationMode: DartIQProjectionApproximationMode;
  fairEnding: DartIQFairEndingReplayState | null;
};

export type DartIQDartEvent = {
  eventId: string;
  engineVersion: typeof DARTIQ_OUTCOME_MODEL_VERSION;
  matchId: string;
  sequence: number;
  legId: string;
  legNumber: number;
  turnId: string;
  playerId: string;
  tiebreakRound?: number | null;
  dartId: string;
  dartIndex: number;
  segment: string;
  scored: number;
  turnScoreAfter: number;
  busted: boolean;
  checkedOut: boolean;
  nextOpponentThreat?: {
    playerId: string;
    scoreRemaining: number;
    checkoutProbabilityNextVisit: number;
  } | null;
  semanticStakes: {
    oneDartFinishAvailable: boolean;
    finishAvailableThisVisit: boolean;
    matchWinAvailableThisVisit: boolean;
    oneDartFinishUnconverted?: boolean;
    unconvertedMatchFinishChancesInVisit?: number;
  };
  consequence: DartIQConsequence;
  checkout: DartIQCheckoutAssessment;
  fairEndingBefore: DartIQFairEndingReplayState | null;
  fairEndingAfter: DartIQFairEndingReplayState | null;
  before: DartIQReplayState;
  after: DartIQReplayState;
  matchWinProbabilityAdded: Record<string, number>;
  legWinProbabilityAdded: Record<string, number>;
};

export type DartIQReplayDart = {
  leg: DartIQReplayLeg;
  legIndex: number;
  turn: TurnWithThrows;
  dart: ThrowRecord;
  isLastInLeg: boolean;
};

type ReplayTurnProgress = FairEndingTurnInput & {
  id: string;
};

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type DartIQReplayCheckpoint = DeepReadonly<{
  sequence: number;
  sourceDartId: string;
  state: DartIQReplayState;
  activeLegIndex: number;
  scores: Record<string, number>;
  legsWon: Record<string, number>;
  points: Record<string, number>;
  dartsThrown: Record<string, number>;
  turnId: string | null;
  turnStartScore: number;
  turnStartPoints: number;
  turnStartDarts: number;
  unconvertedMatchFinishChancesInVisit: number;
  matchWinnerId: string | null;
  turnProgress: ReplayTurnProgress[];
  currentFairEnding: DartIQFairEndingProjectionInput | null;
}>;

type DartIQTransitionCheckpoint = Omit<DartIQReplayCheckpoint, 'sourceDartId'> & {
  readonly sourceDartId: string | null;
};

export type DartIQReplayResult = {
  timeline: DartIQDartEvent[];
  checkpoint: DartIQReplayCheckpoint | null;
};

function rotatePlayerOrder(playerIds: string[], startingPlayerId: string) {
  const startIndex = playerIds.indexOf(startingPlayerId);
  if (startIndex <= 0) return playerIds.slice();
  return [...playerIds.slice(startIndex), ...playerIds.slice(0, startIndex)];
}

function createNumberRecord(playerIds: string[], initialValue: number) {
  return Object.fromEntries(playerIds.map((playerId) => [playerId, initialValue]));
}

function tiebreakCheckoutAssessment(): DartIQCheckoutAssessment {
  return {
    checkoutProbabilityBefore: 0,
    checkoutProbabilityAfter: 0,
    nextVisitCheckoutProbability: 0,
    leaveProbabilityChange: 0,
    createdBogey: false,
    avoidedBogey: false,
  };
}

function cloneFairEnding(
  state: DeepReadonly<DartIQFairEndingProjectionInput> | null | undefined
): DartIQFairEndingProjectionInput | undefined {
  if (!state) return undefined;
  return {
    ...state,
    checkedOutPlayerIds: [...state.checkedOutPlayerIds],
    tiebreakPlayerIds: [...state.tiebreakPlayerIds],
    tiebreakScores: { ...state.tiebreakScores },
    pendingPlayerIds: [...state.pendingPlayerIds],
    tiebreakDartsThrown: { ...state.tiebreakDartsThrown },
  };
}

function cloneReplayState(state: DeepReadonly<DartIQReplayState>): DartIQReplayState {
  return {
    ...state,
    scores: { ...state.scores },
    legsWon: { ...state.legsWon },
    projections: state.projections.map((projection) => ({ ...projection })),
    fairEnding: state.fairEnding
      ? {
          ...state.fairEnding,
          checkedOutPlayerIds: [...state.fairEnding.checkedOutPlayerIds],
          tiebreakPlayerIds: [...state.fairEnding.tiebreakPlayerIds],
          tiebreakScores: { ...state.fairEnding.tiebreakScores },
          pendingPlayerIds: [...state.fairEnding.pendingPlayerIds],
          tiebreakDartsThrown: { ...state.fairEnding.tiebreakDartsThrown },
        }
      : null,
  };
}

function flattenDarts(input: DartIQReplayInput): DartIQReplayDart[] {
  const events: DartIQReplayDart[] = [];
  const sortedLegs = input.legs.slice().sort((a, b) => a.leg_number - b.leg_number);

  sortedLegs.forEach((leg, legIndex) => {
    const legEvents: Omit<DartIQReplayDart, 'isLastInLeg'>[] = [];
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

function matchesCachedDart(flat: DartIQReplayDart | undefined, cached: DartIQDartEvent) {
  return flat?.dart.id === cached.dartId
    && flat.leg.id === cached.legId
    && flat.turn.id === cached.turnId
    && flat.turn.player_id === cached.playerId
    && (flat.turn.tiebreak_round ?? null) === (cached.tiebreakRound ?? null)
    && flat.dart.dart_index === cached.dartIndex
    && flat.dart.segment === cached.segment
    && flat.dart.scored === cached.scored;
}

function buildFairEndingContext(
  input: DartIQReplayInput,
  leg: DartIQReplayLeg,
  turns: ReplayTurnProgress[]
): DartIQFairEndingProjectionInput | undefined {
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

function createReplayState(
  input: DartIQReplayInput,
  leg: DartIQReplayLeg,
  currentPlayerId: string | null,
  dartsRemainingInTurn: number,
  fairEnding: DartIQFairEndingProjectionInput | undefined,
  scores: Readonly<Record<string, number>>,
  legsWon: Readonly<Record<string, number>>,
  points: Readonly<Record<string, number>>,
  dartsThrown: Readonly<Record<string, number>>,
  matchWinnerId: string | null,
  currentVisitStartScore?: number
): DartIQReplayState {
  const playOrder = rotatePlayerOrder(input.playerIds, leg.starting_player_id);
  const projections = calculateDartIQProjection({
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
    startScore: input.startScore,
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
    currentVisitStartScore: currentPlayerId ? (currentVisitStartScore ?? scores[currentPlayerId]) : null,
    dartsRemainingInTurn,
    scores: { ...scores },
    legsWon: { ...legsWon },
    projections: projections.players,
    approximationMode: projections.approximationMode,
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

export type DartIQDartTransitionResult = {
  event: DartIQDartEvent;
  checkpoint: DartIQReplayCheckpoint;
};

/**
 * Applies exactly one canonical dart to an immutable replay accumulator.
 * Full reconstruction and verified-prefix resumption both use this primitive,
 * so append processing cannot drift into a second probability engine.
 */
export function transitionDartIQDart(
  input: DartIQReplayInput,
  orderedLegs: readonly DartIQReplayLeg[],
  source: DartIQReplayDart,
  nextSource: DartIQReplayDart | undefined,
  previous: DartIQTransitionCheckpoint
): DartIQDartTransitionResult {
  let activeLegIndex = previous.activeLegIndex;
  const scores = { ...previous.scores };
  const legsWon = { ...previous.legsWon };
  const points = { ...previous.points };
  const dartsThrown = { ...previous.dartsThrown };
  let turnId = previous.turnId;
  let turnStartScore = previous.turnStartScore;
  let turnStartPoints = previous.turnStartPoints;
  let turnStartDarts = previous.turnStartDarts;
  let unconvertedMatchFinishChancesInVisit = previous.unconvertedMatchFinishChancesInVisit;
  let matchWinnerId = previous.matchWinnerId;
  const turnProgress = new Map(previous.turnProgress.map((progress) => [progress.id, { ...progress }]));
  let currentFairEnding = cloneFairEnding(previous.currentFairEnding);
  let before = cloneReplayState(previous.state);

  if (source.legIndex !== activeLegIndex) {
    activeLegIndex = source.legIndex;
    for (const playerId of input.playerIds) scores[playerId] = input.startScore;
    turnProgress.clear();
    currentFairEnding = buildFairEndingContext(input, source.leg, []);
    before = createReplayState(
      input,
      source.leg,
      source.turn.player_id,
      Math.max(1, 4 - source.dart.dart_index),
      currentFairEnding,
      scores,
      legsWon,
      points,
      dartsThrown,
      matchWinnerId,
      scores[source.turn.player_id]
    );
  }

  const fairEndingBefore = before.fairEnding;
  if (turnId !== source.turn.id) {
    turnId = source.turn.id;
    turnStartScore = scores[source.turn.player_id];
    turnStartPoints = points[source.turn.player_id];
    turnStartDarts = dartsThrown[source.turn.player_id];
    unconvertedMatchFinishChancesInVisit = 0;
  }

  const playerId = source.turn.player_id;
  const isTiebreak = source.turn.tiebreak_round != null;
  const segment = parseSegmentLabel(source.dart.segment);
  const outcome = isTiebreak
    ? { newScore: scores[playerId], busted: false, finished: false }
    : applyThrow(scores[playerId], segment, input.finishRule);
  if (outcome.busted) {
    scores[playerId] = turnStartScore;
    points[playerId] = turnStartPoints;
    dartsThrown[playerId] = turnStartDarts;
  } else if (!isTiebreak) {
    points[playerId] += scores[playerId] - outcome.newScore;
    dartsThrown[playerId] += 1;
    scores[playerId] = outcome.newScore;
  }

  const previousProgress = turnProgress.get(source.turn.id);
  const throwCount = (previousProgress?.throw_count ?? 0) + 1;
  const throwsTotal = (previousProgress?.throws_total ?? 0) + source.dart.scored;
  const turnScoreAfter = isTiebreak
    ? throwsTotal
    : outcome.busted ? 0 : turnStartScore - scores[playerId];
  turnProgress.set(source.turn.id, {
    id: source.turn.id,
    player_id: playerId,
    total_scored: turnScoreAfter,
    busted: outcome.busted,
    tiebreak_round: source.turn.tiebreak_round,
    throw_count: throwCount,
    throws_total: throwsTotal,
    completed: outcome.busted || outcome.finished || throwCount >= 3,
  });
  currentFairEnding = buildFairEndingContext(input, source.leg, [...turnProgress.values()]);

  const checkout = isTiebreak
    ? tiebreakCheckoutAssessment()
    : evaluateDartSetup({
        visitStartScore: turnStartScore,
        scoreBefore: before.scores[playerId] ?? turnStartScore,
        scoreAfter: outcome.busted ? turnStartScore : outcome.newScore,
        dartsRemainingBefore: before.dartsRemainingInTurn,
        finishRule: input.finishRule,
        busted: outcome.busted,
        checkedOut: outcome.finished,
        outcomeModel: input.outcomeModels?.[playerId],
      });

  let stateLeg = source.leg;
  let nextPlayerId: string | null;
  let nextDartsRemaining: number;
  let resolvedLegWinnerId: string | null = null;
  const fairEndingWinnerId = input.fairEnding && currentFairEnding?.phase === 'resolved'
    ? currentFairEnding.winnerId
    : null;
  const standardWinnerId = !input.fairEnding && source.isLastInLeg
    ? source.leg.winner_player_id
    : null;
  const legWinnerId = fairEndingWinnerId ?? standardWinnerId;

  if (legWinnerId) {
    resolvedLegWinnerId = legWinnerId;
    legsWon[legWinnerId] = (legsWon[legWinnerId] ?? 0) + 1;
    if (legsWon[legWinnerId] >= input.legsToWin) matchWinnerId = legWinnerId;
    const nextLeg = orderedLegs[source.legIndex + 1];
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
    const playOrder = rotatePlayerOrder(input.playerIds, source.leg.starting_player_id);
    nextPlayerId = getNextFairEndingPlayer(
      currentFairEnding as FairEndingState,
      playOrder.map((id) => ({ id })),
      [...turnProgress.values()]
    );
    nextDartsRemaining = nextPlayerId === playerId && throwCount < 3 ? 3 - throwCount : 3;
  } else if (nextSource && nextSource.leg.id === source.leg.id) {
    nextPlayerId = nextSource.turn.player_id;
    nextDartsRemaining = Math.max(1, 4 - nextSource.dart.dart_index);
  } else if (outcome.busted || source.dart.dart_index >= 3) {
    const playOrder = rotatePlayerOrder(input.playerIds, source.leg.starting_player_id);
    const playerIndex = Math.max(0, playOrder.indexOf(playerId));
    nextPlayerId = playOrder[(playerIndex + 1) % playOrder.length] ?? null;
    nextDartsRemaining = 3;
  } else {
    nextPlayerId = playerId;
    nextDartsRemaining = Math.max(0, 3 - source.dart.dart_index);
  }

  const stateFairEnding = stateLeg.id === source.leg.id
    ? currentFairEnding
    : buildFairEndingContext(input, stateLeg, []);
  const after = createReplayState(
    input,
    stateLeg,
    nextPlayerId,
    nextDartsRemaining,
    stateFairEnding,
    scores,
    legsWon,
    points,
    dartsThrown,
    matchWinnerId,
    nextPlayerId === playerId && stateLeg.id === source.leg.id
      ? turnStartScore
      : nextPlayerId ? scores[nextPlayerId] : undefined
  );

  const matchWinProbabilityAdded: Record<string, number> = {};
  const legWinProbabilityAdded: Record<string, number> = {};
  const beforeByPlayer = new Map(before.projections.map((projection) => [projection.id, projection]));
  for (const projection of after.projections) {
    const priorProjection = beforeByPlayer.get(projection.id);
    matchWinProbabilityAdded[projection.id] = projection.matchWinProbability
      - (priorProjection?.matchWinProbability ?? 0);
    const afterLegProbability = resolvedLegWinnerId
      ? (projection.id === resolvedLegWinnerId ? 1 : 0)
      : projection.legWinProbability;
    legWinProbabilityAdded[projection.id] = afterLegProbability
      - (priorProjection?.legWinProbability ?? 0);
  }
  const consequenceAfter = after.projections.map((projection) => ({
    ...projection,
    legWinProbability: resolvedLegWinnerId
      ? (projection.id === resolvedLegWinnerId ? 1 : 0)
      : projection.legWinProbability,
  }));
  const consequence = calculateProbabilityVectorConsequence(before.projections, consequenceAfter);
  const scoreBefore = before.scores[playerId] ?? 0;
  const oneDartFinishAvailable = !isTiebreak && hasCheckoutRoute(scoreBefore, 1, input.finishRule);
  const finishAvailableThisVisit = !isTiebreak
    && hasCheckoutRoute(scoreBefore, before.dartsRemainingInTurn, input.finishRule);
  const matchWinAvailableThisVisit = finishAvailableThisVisit
    && (before.legsWon[playerId] ?? 0) === input.legsToWin - 1;
  const oneDartFinishUnconverted = oneDartFinishAvailable && !outcome.finished;
  if (oneDartFinishUnconverted && matchWinAvailableThisVisit) {
    unconvertedMatchFinishChancesInVisit += 1;
  }
  const legPlayOrder = rotatePlayerOrder(input.playerIds, source.leg.starting_player_id);
  const actorOrderIndex = legPlayOrder.indexOf(playerId);
  const nextOpponentId = legPlayOrder.length > 1
    ? legPlayOrder[(actorOrderIndex + 1) % legPlayOrder.length]
    : null;
  const opponentScore = nextOpponentId ? scores[nextOpponentId] : undefined;
  const nextOpponentThreat = !isTiebreak
    && !outcome.finished
    && (!input.fairEnding || currentFairEnding?.phase === 'normal')
    && nextOpponentId
    && opponentScore !== undefined
    ? {
        playerId: nextOpponentId,
        scoreRemaining: opponentScore,
        checkoutProbabilityNextVisit: estimateCheckoutProbability({
          visitStartScore: opponentScore,
          scoreRemaining: opponentScore,
          dartsRemaining: 3,
          finishRule: input.finishRule,
          outcomeModel: input.outcomeModels?.[nextOpponentId],
        }),
      }
    : null;

  const event: DartIQDartEvent = {
    eventId: `${DARTIQ_OUTCOME_MODEL_VERSION}:${source.leg.match_id}:${source.dart.id}`,
    engineVersion: DARTIQ_OUTCOME_MODEL_VERSION,
    matchId: source.leg.match_id,
    sequence: previous.sequence + 1,
    legId: source.leg.id,
    legNumber: source.leg.leg_number,
    turnId: source.turn.id,
    playerId,
    tiebreakRound: source.turn.tiebreak_round,
    dartId: source.dart.id,
    dartIndex: source.dart.dart_index,
    segment: source.dart.segment,
    scored: source.dart.scored,
    turnScoreAfter,
    busted: outcome.busted,
    checkedOut: outcome.finished,
    nextOpponentThreat,
    semanticStakes: {
      oneDartFinishAvailable,
      finishAvailableThisVisit,
      matchWinAvailableThisVisit,
      oneDartFinishUnconverted,
      unconvertedMatchFinishChancesInVisit,
    },
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
  };

  return {
    event,
    checkpoint: {
      sequence: event.sequence,
      sourceDartId: event.dartId,
      state: cloneReplayState(after),
      activeLegIndex,
      scores: { ...scores },
      legsWon: { ...legsWon },
      points: { ...points },
      dartsThrown: { ...dartsThrown },
      turnId,
      turnStartScore,
      turnStartPoints,
      turnStartDarts,
      unconvertedMatchFinishChancesInVisit,
      matchWinnerId,
      turnProgress: [...turnProgress.values()].map((progress) => ({ ...progress })),
      currentFairEnding: cloneFairEnding(currentFairEnding) ?? null,
    },
  };
}

/**
 * Reconstructs the full DartIQ timeline in a single chronological pass.
 * Score and form accumulators are mutated internally, while every returned
 * state is copied so consumers can safely retain or serialize the timeline.
 */
export function reconstructDartIQTimelineWithCheckpoint(
  input: DartIQReplayInput,
  options: DartIQReplayOptions = {}
): DartIQReplayResult {
  if (input.playerIds.length === 0 || input.legs.length === 0) {
    return { timeline: [], checkpoint: null };
  }
  const orderedLegs = input.legs.slice().sort((a, b) => a.leg_number - b.leg_number);
  const darts = flattenDarts({ ...input, legs: orderedLegs });
  if (darts.length === 0) return { timeline: [], checkpoint: null };

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
  let unconvertedMatchFinishChancesInVisit = 0;
  let matchWinnerId: string | null = null;
  const turnProgress = new Map<string, ReplayTurnProgress>();

  const reusablePrefix = (options.cachedPrefix ?? []).every(
    (cached, index) => matchesCachedDart(darts[index], cached)
  ) ? (options.cachedPrefix ?? []) : [];
  const timeline: DartIQDartEvent[] = [...reusablePrefix];
  let currentFairEnding: DartIQFairEndingProjectionInput | undefined;
  let before: DartIQReplayState;
  const cachedCheckpoint = options.cachedCheckpoint;
  const canResumeCheckpoint = Boolean(
    cachedCheckpoint
    && cachedCheckpoint.sequence === reusablePrefix.length
    && cachedCheckpoint.sourceDartId === reusablePrefix.at(-1)?.dartId
  );
  if (canResumeCheckpoint && cachedCheckpoint) {
    activeLegIndex = cachedCheckpoint.activeLegIndex;
    Object.assign(scores, cachedCheckpoint.scores);
    Object.assign(legsWon, cachedCheckpoint.legsWon);
    Object.assign(points, cachedCheckpoint.points);
    Object.assign(dartsThrown, cachedCheckpoint.dartsThrown);
    turnId = cachedCheckpoint.turnId;
    turnStartScore = cachedCheckpoint.turnStartScore;
    turnStartPoints = cachedCheckpoint.turnStartPoints;
    turnStartDarts = cachedCheckpoint.turnStartDarts;
    unconvertedMatchFinishChancesInVisit = cachedCheckpoint.unconvertedMatchFinishChancesInVisit;
    matchWinnerId = cachedCheckpoint.matchWinnerId;
    for (const progress of cachedCheckpoint.turnProgress) {
      turnProgress.set(progress.id, { ...progress });
    }
    currentFairEnding = cloneFairEnding(cachedCheckpoint.currentFairEnding);
    before = cloneReplayState(cachedCheckpoint.state);
  } else if (reusablePrefix.length > 0) {
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
    let hydratedLegIndex = darts[0].legIndex;
    for (let index = 0; index < reusablePrefix.length; index += 1) {
      const flat = darts[index];
      const cached = reusablePrefix[index];
      if (flat.legIndex !== hydratedLegIndex) {
        turnProgress.clear();
        hydratedLegIndex = flat.legIndex;
      }
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
    unconvertedMatchFinishChancesInVisit = lastCached.semanticStakes.unconvertedMatchFinishChancesInVisit ?? 0;
    before = lastCached.after;
  } else {
    currentFairEnding = buildFairEndingContext(input, darts[0].leg, []);
    before = createReplayState(
      input,
      darts[0].leg,
      darts[0].turn.player_id,
      Math.max(1, 4 - darts[0].dart.dart_index),
      currentFairEnding,
      scores,
      legsWon,
      points,
      dartsThrown,
      matchWinnerId,
      scores[darts[0].turn.player_id]
    );
  }

  let transitionCheckpoint: DartIQTransitionCheckpoint = {
    sequence: timeline.length,
    sourceDartId: timeline.at(-1)?.dartId ?? null,
    state: cloneReplayState(before),
    activeLegIndex,
    scores: { ...scores },
    legsWon: { ...legsWon },
    points: { ...points },
    dartsThrown: { ...dartsThrown },
    turnId,
    turnStartScore,
    turnStartPoints,
    turnStartDarts,
    unconvertedMatchFinishChancesInVisit,
    matchWinnerId,
    turnProgress: [...turnProgress.values()].map((progress) => ({ ...progress })),
    currentFairEnding: cloneFairEnding(currentFairEnding) ?? null,
  };
  let latestCheckpoint: DartIQReplayCheckpoint | null = null;
  for (let index = reusablePrefix.length; index < darts.length; index += 1) {
    const result = transitionDartIQDart(
      input,
      orderedLegs,
      darts[index],
      darts[index + 1],
      transitionCheckpoint
    );
    timeline.push(result.event);
    latestCheckpoint = result.checkpoint;
    transitionCheckpoint = result.checkpoint;
  }

  const sourceDartId = timeline.at(-1)?.dartId;
  const finalCheckpoint: DartIQReplayCheckpoint | null = sourceDartId
    ? latestCheckpoint ?? { ...transitionCheckpoint, sourceDartId }
    : null;
  return {
    timeline,
    checkpoint: finalCheckpoint,
  };
}

export function reconstructDartIQTimeline(
  input: DartIQReplayInput,
  options: DartIQReplayOptions = {}
): DartIQDartEvent[] {
  return reconstructDartIQTimelineWithCheckpoint(input, options).timeline;
}
