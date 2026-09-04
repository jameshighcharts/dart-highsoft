import { estimateCheckoutProbability } from './checkout';
import { calculateDartIQProjection } from './projection';
import {
  reconstructDartIQTimelineWithCheckpoint,
  type DartIQDartEvent,
  type DartIQReplayCheckpoint,
  type DartIQReplayInput,
  type DartIQReplayState,
} from './replay';

export type DartIQTrackerSnapshot = {
  state: DartIQReplayState;
  currentCheckoutProbability: number;
  latestEvent: DartIQDartEvent | null;
  sequence: number;
};

type TrackerContext = {
  signature: string;
  populationProfile: DartIQReplayInput['populationProfile'];
  playerProfiles: DartIQReplayInput['playerProfiles'];
  outcomeModels: DartIQReplayInput['outcomeModels'];
};

function rotatePlayerOrder(playerIds: string[], startingPlayerId: string) {
  const startIndex = playerIds.indexOf(startingPlayerId);
  if (startIndex <= 0) return playerIds.slice();
  return [...playerIds.slice(startIndex), ...playerIds.slice(0, startIndex)];
}

function trackerSignature(input: DartIQReplayInput) {
  return JSON.stringify({
    playerIds: input.playerIds,
    startScore: input.startScore,
    finishRule: input.finishRule,
    legsToWin: input.legsToWin,
    fairEnding: Boolean(input.fairEnding),
    initialLegsWon: input.initialLegsWon ?? null,
    legs: input.legs.map((leg) => [
      leg.id,
      leg.leg_number,
      leg.starting_player_id,
      leg.winner_player_id,
    ]),
  });
}

function sourceSignature(input: DartIQReplayInput) {
  return JSON.stringify(input.legs.flatMap((leg) => (
    (input.turnsByLeg[leg.id] ?? [])
      .slice()
      .sort((a, b) => a.turn_number - b.turn_number)
      .flatMap((turn) => (turn.throws ?? [])
        .slice()
        .sort((a, b) => a.dart_index - b.dart_index)
        .map((dart) => [
          dart.id,
          turn.id,
          turn.tiebreak_round,
          dart.dart_index,
          dart.segment,
          dart.scored,
        ]))
  )));
}

function sameContext(previous: TrackerContext | null, input: DartIQReplayInput) {
  if (!previous) return false;
  if (previous.signature !== trackerSignature(input)) return false;
  if (previous.populationProfile !== input.populationProfile) return false;
  for (const playerId of input.playerIds) {
    if (previous.playerProfiles?.[playerId] !== input.playerProfiles?.[playerId]) return false;
    if (previous.outcomeModels?.[playerId] !== input.outcomeModels?.[playerId]) return false;
  }
  return true;
}

function createInitialState(input: DartIQReplayInput): DartIQReplayState {
  const orderedLegs = input.legs.slice().sort((a, b) => a.leg_number - b.leg_number);
  const currentLeg = orderedLegs.find((leg) => !leg.winner_player_id) ?? orderedLegs.at(-1);
  if (!currentLeg) throw new Error('DartIQ tracker requires a leg');

  const legsWon = Object.fromEntries(input.playerIds.map((playerId) => [playerId, 0]));
  for (const [playerId, wins] of Object.entries(input.initialLegsWon ?? {})) {
    if (playerId in legsWon) legsWon[playerId] = wins;
  }
  for (const leg of orderedLegs) {
    if (leg.winner_player_id && leg.winner_player_id in legsWon) {
      legsWon[leg.winner_player_id] += 1;
    }
  }
  const matchWinnerId = input.playerIds.find((playerId) => legsWon[playerId] >= input.legsToWin) ?? null;
  const currentPlayerId = matchWinnerId ? null : currentLeg.starting_player_id;
  const scores = Object.fromEntries(input.playerIds.map((playerId) => [playerId, input.startScore]));
  const projection = calculateDartIQProjection({
    players: input.playerIds.map((playerId) => ({
      id: playerId,
      scoreRemaining: input.startScore,
      legsWon: legsWon[playerId],
      threeDartAverage: 0,
      dartsThrown: 0,
      historicalProfile: input.playerProfiles?.[playerId],
      outcomeModel: input.outcomeModels?.[playerId],
    })),
    startScore: input.startScore,
    playOrder: rotatePlayerOrder(input.playerIds, currentLeg.starting_player_id),
    currentPlayerId,
    currentVisitStartScore: currentPlayerId ? input.startScore : undefined,
    currentLegStarterId: currentLeg.starting_player_id,
    dartsRemainingInTurn: currentPlayerId ? 3 : 0,
    legsToWin: input.legsToWin,
    finishRule: input.finishRule,
    matchWinnerId,
    populationProfile: input.populationProfile,
  });

  return {
    legId: currentLeg.id,
    legNumber: currentLeg.leg_number,
    currentPlayerId,
    currentVisitStartScore: currentPlayerId ? input.startScore : null,
    dartsRemainingInTurn: currentPlayerId ? 3 : 0,
    scores,
    legsWon,
    projections: projection.players,
    approximationMode: projection.approximationMode,
    fairEnding: null,
  };
}

function snapshotFromState(
  input: DartIQReplayInput,
  state: DartIQReplayState,
  latestEvent: DartIQDartEvent | null,
  sequence: number
): DartIQTrackerSnapshot {
  const currentPlayerId = state.currentPlayerId;
  const currentCheckoutProbability = currentPlayerId && state.fairEnding?.phase !== 'tiebreak'
    ? estimateCheckoutProbability({
        visitStartScore: state.currentVisitStartScore ?? state.scores[currentPlayerId],
        scoreRemaining: state.scores[currentPlayerId],
        dartsRemaining: state.dartsRemainingInTurn,
        finishRule: input.finishRule,
        outcomeModel: input.outcomeModels?.[currentPlayerId],
      })
    : 0;

  return { state, currentCheckoutProbability, latestEvent, sequence };
}

/**
 * Stateful owner for a match's verified DartIQ event prefix. Appends reuse the
 * existing events; corrections or model/config changes rebuild cleanly.
 */
export class DartIQTracker {
  private context: TrackerContext | null = null;
  private timeline: DartIQDartEvent[] = [];
  private lastSourceSignature: string | null = null;
  private lastSnapshot: DartIQTrackerSnapshot | null = null;
  private checkpoint: DartIQReplayCheckpoint | null = null;

  update(input: DartIQReplayInput): DartIQTrackerSnapshot {
    const contextMatches = sameContext(this.context, input);
    const nextSourceSignature = sourceSignature(input);
    if (
      contextMatches
      && nextSourceSignature === this.lastSourceSignature
      && this.lastSnapshot
    ) return this.lastSnapshot;

    const cachedPrefix = contextMatches ? this.timeline : [];
    const replay = reconstructDartIQTimelineWithCheckpoint(input, {
      cachedPrefix,
      cachedCheckpoint: contextMatches ? this.checkpoint : null,
    });
    this.timeline = replay.timeline;
    this.checkpoint = replay.checkpoint;
    this.context = {
      signature: trackerSignature(input),
      populationProfile: input.populationProfile,
      playerProfiles: input.playerProfiles,
      outcomeModels: input.outcomeModels,
    };

    const latestEvent = this.timeline.at(-1) ?? null;
    const state = latestEvent?.after ?? createInitialState(input);
    this.lastSourceSignature = nextSourceSignature;
    this.lastSnapshot = snapshotFromState(input, state, latestEvent, this.timeline.length);
    return this.lastSnapshot;
  }

  events() {
    return this.timeline.slice();
  }

  reset() {
    this.context = null;
    this.timeline = [];
    this.lastSourceSignature = null;
    this.lastSnapshot = null;
    this.checkpoint = null;
  }
}
