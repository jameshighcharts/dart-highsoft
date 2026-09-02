import type { LegRecord, ThrowRecord, TurnWithThrows } from '@/lib/match/types';
import { parseSegmentLabel } from '@/utils/legScoreCalculator';
import {
  evaluateDartSetup,
  type PressureCheckoutAssessment,
} from '@/utils/pressureCheckout';
import {
  calculateDartLeverage,
  calculatePressureProjection,
  type PressureDartLeverage,
  type PressurePlayerProjection,
} from '@/utils/pressureEngine';
import type {
  PressurePlayerHistoryProfile,
  PressurePopulationProfile,
} from '@/utils/pressureProfiles';
import { applyThrow, type FinishRule } from '@/utils/x01';

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
};

export type PressureReplayState = {
  legId: string;
  legNumber: number;
  currentPlayerId: string | null;
  dartsRemainingInTurn: number;
  scores: Record<string, number>;
  legsWon: Record<string, number>;
  projections: PressurePlayerProjection[];
};

export type PressureDartEvent = {
  eventId: string;
  engineVersion: 'pressure-v1';
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
  leverage: PressureDartLeverage;
  checkout: PressureCheckoutAssessment;
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

function rotatePlayerOrder(playerIds: string[], startingPlayerId: string) {
  const startIndex = playerIds.indexOf(startingPlayerId);
  if (startIndex <= 0) return playerIds.slice();
  return [...playerIds.slice(startIndex), ...playerIds.slice(0, startIndex)];
}

function createNumberRecord(playerIds: string[], initialValue: number) {
  return Object.fromEntries(playerIds.map((playerId) => [playerId, initialValue]));
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

/**
 * Reconstructs the full pressure timeline in a single chronological pass.
 * Score and form accumulators are mutated internally, while every returned
 * state is copied so consumers can safely retain or serialize the timeline.
 */
export function reconstructPressureTimeline(input: PressureReplayInput): PressureDartEvent[] {
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

  function createState(
    leg: ReplayLeg,
    currentPlayerId: string | null,
    dartsRemainingInTurn: number
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
      })),
      playOrder,
      currentPlayerId,
      dartsRemainingInTurn,
      legsToWin: input.legsToWin,
      finishRule: input.finishRule,
      matchWinnerId,
      populationProfile: input.populationProfile,
    });

    return {
      legId: leg.id,
      legNumber: leg.leg_number,
      currentPlayerId,
      dartsRemainingInTurn,
      scores: { ...scores },
      legsWon: { ...legsWon },
      projections: projections.players,
    };
  }

  const timeline: PressureDartEvent[] = [];
  let before = createState(
    darts[0].leg,
    darts[0].turn.player_id,
    Math.max(1, 4 - darts[0].dart.dart_index)
  );

  for (let index = 0; index < darts.length; index += 1) {
    const event = darts[index];
    const nextEvent = darts[index + 1];

    const leverage = calculateDartLeverage(
      before.projections,
      event.turn.player_id,
      input.legsToWin
    );

    if (event.legIndex !== activeLegIndex) {
      activeLegIndex = event.legIndex;
      for (const playerId of input.playerIds) scores[playerId] = input.startScore;
    }

    if (turnId !== event.turn.id) {
      turnId = event.turn.id;
      turnStartScore = scores[event.turn.player_id];
      turnStartPoints = points[event.turn.player_id];
      turnStartDarts = dartsThrown[event.turn.player_id];
    }

    const playerId = event.turn.player_id;
    const segment = parseSegmentLabel(event.dart.segment);
    const outcome = applyThrow(scores[playerId], segment, input.finishRule);
    const playerProjectionBefore = before.projections.find((projection) => projection.id === playerId);

    if (outcome.busted) {
      scores[playerId] = turnStartScore;
      points[playerId] = turnStartPoints;
      dartsThrown[playerId] = turnStartDarts;
    } else {
      points[playerId] += scores[playerId] - outcome.newScore;
      dartsThrown[playerId] += 1;
      scores[playerId] = outcome.newScore;
    }
    const turnScoreAfter = outcome.busted ? 0 : turnStartScore - scores[playerId];
    const checkout = evaluateDartSetup({
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

    if (event.isLastInLeg && event.leg.winner_player_id) {
      const legWinnerId = event.leg.winner_player_id;
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

    const after = createState(stateLeg, nextPlayerId, nextDartsRemaining);
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

    timeline.push({
      eventId: `pressure-v1:${event.leg.match_id}:${event.dart.id}`,
      engineVersion: 'pressure-v1',
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
      leverage,
      checkout,
      before,
      after,
      matchWinProbabilityAdded,
      legWinProbabilityAdded,
    });
    before = after;
  }

  return timeline;
}
