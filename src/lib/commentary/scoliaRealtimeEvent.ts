import type { SupabaseClient } from '@supabase/supabase-js';

import type { TurnWithThrows } from '../match/types.ts';
import {
  createDartIQDartPacket,
  type DartIQDartPacket,
  type DartIQEventPriority,
} from '../dartiq/events.ts';
import type { DartIQDartEvent, DartIQReplayInput, DartIQReplayState } from '../dartiq/replay.ts';
import { DartIQTracker } from '../dartiq/tracker.ts';
import type { FinishRule } from '../../utils/x01.ts';
import { isNikitaSpecial } from '../../utils/nikitaSpecial.ts';
import {
  createAdaptiveDartIQModel, landingSegment,
} from '../dartiq/model/training.ts';
import { selectDartIQNextDartForecast } from '../dartiq/model/outcomes.ts';
import { loadFrozenDartIQEvidence } from '../server/dartiqEvidence';
import {
  buildCommentaryNarrativeMemory,
  type CommentaryNarrativeMemory,
} from './commentaryNarrative.ts';

type CachedDartIQContext = {
  input: DartIQReplayInput;
  tracker: DartIQTracker;
  timeline: ReturnType<DartIQTracker['events']>;
  legId: string;
  lastTurnNumber: number;
  lastDartIndex: number;
  revision?: string;
};

export class ScoliaDartIQEventCache {
  private readonly matches = new Map<string, CachedDartIQContext>();
  get(matchId: string) { return this.matches.get(matchId); }
  timeline(matchId: string) { return this.matches.get(matchId)?.timeline; }
  set(matchId: string, value: CachedDartIQContext) {
    this.matches.delete(matchId); this.matches.set(matchId, value);
    if (this.matches.size > 8) this.matches.delete(this.matches.keys().next().value!);
  }
  delete(matchId: string) { this.matches.delete(matchId); }
  clear() { this.matches.clear(); }
}

export type ScoliaRealtimeDartEvent = {
  schemaVersion: 1;
  kind: 'accepted_scolia_dart';
  eventId: string;
  matchId: string;
  legId: string;
  legNumber: number;
  turnId: string;
  dartId: string;
  playerId: string;
  playerName: string;
  dartIndex: number;
  segment: string;
  scored: number;
  turnScore: number;
  visitDarts: Array<{ dartIndex: number; segment: string; scored: number }>;
  busted: boolean;
  checkedOut: boolean;
  matchWon: boolean;
  nikitaSpecial: boolean;
  dartiq?: DartIQDartPacket;
  priority: DartIQEventPriority;
  shouldSpeak: boolean;
  isLatestDart?: boolean;
  narrative?: CommentaryNarrativeMemory;
  currentState?: DartIQReplayState;
  landing?: { detail: string };
  grouping?: CommentaryGrouping;
  landingBefore?: CommentaryLandingForecast;
  landingNext?: CommentaryLandingForecast;
};

export type CommentaryLandingForecast = {
  playerId: string;
  dartsLeft: number;
  scoreRemaining: number;
  artifactId: string;
  segments: { segment: string; probability: number }[];
  actualSegmentProbability?: number;
};

export type CommentaryGrouping = {
  dartCount: number;
  maximumSeparationMm: number;
  firstPairSeparationMm: number;
  latestNearestSeparationMm: number;
  shape: 'tight' | 'third_separated' | 'spread';
};

type GroupingDart = {
  dart_index: number;
  segment: string;
  impact_x_mm?: number | null;
  impact_y_mm?: number | null;
};

/** Describe only the accepted visit prefix; incomplete geometry cannot establish a group. */
export function measureCommentaryGrouping(darts: readonly GroupingDart[], dartIndex: number): CommentaryGrouping | undefined {
  if (dartIndex !== 2 && dartIndex !== 3) return undefined;
  const prefix = darts.filter((dart) => dart.dart_index <= dartIndex)
    .slice().sort((a, b) => a.dart_index - b.dart_index);
  if (prefix.length !== dartIndex) return undefined;
  const positions: Array<{ x: number; y: number }> = [];
  for (const [index, dart] of prefix.entries()) {
    const x = dart.impact_x_mm;
    const y = dart.impact_y_mm;
    if (dart.dart_index !== index + 1 || x == null || y == null
      || !Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(x, y) > 250
      || landingSegment(x, y) !== dart.segment) return undefined;
    positions.push({ x, y });
  }
  const distance = (a: number, b: number) => Math.hypot(positions[a].x - positions[b].x, positions[a].y - positions[b].y);
  const firstPairSeparationMm = distance(0, 1);
  const lastDistances = positions.slice(0, -1).map((_, index) => distance(index, positions.length - 1));
  const maximumSeparationMm = Math.max(firstPairSeparationMm, ...lastDistances);
  const latestNearestSeparationMm = Math.min(...lastDistances);
  // Descriptive editorial thresholds, not calibrated measures of skill or intended aim.
  return { dartCount: positions.length, maximumSeparationMm, firstPairSeparationMm, latestNearestSeparationMm,
    shape: maximumSeparationMm <= 15 ? 'tight'
      : positions.length === 3 && firstPairSeparationMm <= 15 && latestNearestSeparationMm >= 30
        ? 'third_separated' : 'spread' };
}

/** Coordinates describe a landing, never an intended target. */
export function describeCommentaryLanding(segment: string, x?: number | null, y?: number | null) {
  if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)
    || Math.hypot(x, y) > 250 || landingSegment(x, y) !== segment) return undefined;
  const radius = Math.hypot(x, y);
  // Same-sector radial proximity is exact for these circular ring boundaries.
  if (segment.startsWith('S') && segment !== 'SB') {
    const nearby = [
      { target: `T${segment.slice(1)}`, distance: radius < 99 ? 99 - radius : radius - 107 },
      { target: `D${segment.slice(1)}`, distance: 162 - radius },
    ].filter(({ distance }) => distance > 0 && distance <= 5)
      .sort((a, b) => a.distance - b.distance)[0];
    if (nearby) return { detail: `Landed in ${segment}, ${nearby.distance.toFixed(1)} mm from the ${nearby.target} scoring region. Intended target unknown.` };
  }
  return undefined;
}

export function commentaryLandingForecast(
  input: DartIQReplayInput, state: DartIQReplayState, actualSegment?: string
): CommentaryLandingForecast | undefined {
  const playerId = state.currentPlayerId;
  if (!playerId || state.fairEnding?.phase === 'tiebreak' || state.fairEnding?.phase === 'resolved'
    || state.dartsRemainingInTurn < 1 || state.dartsRemainingInTurn > 3 || state.scores[playerId] <= 170) return undefined;
  const full = input.outcomeModels?.[playerId]?.predictLanding?.({
    currentScore: state.scores[playerId], dartsLeft: state.dartsRemainingInTurn as 1 | 2 | 3,
    finishRule: input.finishRule,
  });
  const selected = selectDartIQNextDartForecast(full);
  if (!selected) return undefined;
  return { playerId, dartsLeft: state.dartsRemainingInTurn, scoreRemaining: state.scores[playerId],
    ...selected, actualSegmentProbability: actualSegment
      ? full?.segments.find((entry) => entry.segment === actualSegment)?.probability : undefined };
}

export type ScoliaRealtimeDartFacts = Omit<
  ScoliaRealtimeDartEvent,
  'schemaVersion' | 'kind' | 'eventId' | 'priority' | 'shouldSpeak'
>;

export function classifyScoliaRealtimeDart(
  facts: ScoliaRealtimeDartFacts,
  options: { allowSpeech?: boolean } = {}
): ScoliaRealtimeDartEvent {
  let priority: DartIQEventPriority = 'silent';
  if (facts.matchWon) priority = 'terminal';
  else if (facts.nikitaSpecial) priority = 'marquee';
  else if (facts.dartiq) priority = facts.dartiq.priority;
  else if (
    facts.checkedOut
    || (facts.dartIndex === 3 && facts.turnScore === 180)
  ) {
    priority = 'marquee';
  } else if (facts.busted) {
    priority = 'notable';
  } else if (facts.dartIndex === 3) {
    priority = 'ordinary';
  }
  if (options.allowSpeech === false) priority = 'silent';

  return {
    schemaVersion: 1,
    kind: 'accepted_scolia_dart',
    eventId: `scolia-throw:${facts.dartId}`,
    ...facts,
    priority,
    shouldSpeak: priority !== 'silent',
  };
}

export type AcceptedScoliaDart = { workerReceivedAtMs?: number; rows: AcceptedScoliaDartRows; previousRevision?: string; revision: string };

/** Load the post-ingestion facts directly from canonical rows; no Realtime round trip is involved. */
export async function loadScoliaRealtimeDartEvent(
  supabase: SupabaseClient,
  matchId: string,
  throwId: string,
  dartIQCache?: ScoliaDartIQEventCache,
  accepted?: AcceptedScoliaDart
): Promise<ScoliaRealtimeDartEvent> {
  // Read the same facts in one database snapshot instead of three dependent
  // request stages. Explicit FK aliases disambiguate the reverse throws join.
  const { data, error } = accepted ? { data: accepted.rows, error: null } : await supabase
    .from('throws')
    .select(`
      id, turn_id, dart_index, segment, scored, impact_x_mm, impact_y_mm,
      turn:turn_id(
        id, leg_id, player_id, turn_number, total_scored, busted, tiebreak_round,
        throws:throws(id, scored, dart_index, segment, impact_x_mm, impact_y_mm),
        player:player_id(id, display_name),
        leg:leg_id(
          id, match_id, leg_number, starting_player_id, winner_player_id,
          match:match_id(id, winner_player_id, start_score, finish, legs_to_win, fair_ending)
        )
      )
    `)
    .eq('id', throwId)
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Accepted Scolia throw was not found');
  const { turn: joinedTurn, ...dart } = data as unknown as AcceptedScoliaDartRows;
  if (!joinedTurn) throw new Error('Accepted Scolia turn was not found');
  const { leg: joinedLeg, player, ...turn } = joinedTurn;
  if (!joinedLeg || joinedLeg.match_id !== matchId) {
    throw new Error('Accepted Scolia leg did not belong to the match');
  }
  const { match, ...leg } = joinedLeg;
  if (!match) throw new Error('Accepted Scolia match was not found');
  if (!player) throw new Error('Accepted Scolia player was not found');

  const eventCache = dartIQCache ?? new ScoliaDartIQEventCache();
  const cachedRevision = eventCache.get(matchId)?.revision;
  if (accepted && cachedRevision !== accepted.previousRevision && cachedRevision !== accepted.revision) eventCache.delete(matchId);
  const dartiq = await loadDartIQPacket(
    supabase,
    matchId,
    throwId,
    { id: leg.id as string },
    {
      startScore: Number.parseInt(String(match.start_score), 10),
      finishRule: match.finish as FinishRule,
      legsToWin: match.legs_to_win as number,
      fairEnding: Boolean(match.fair_ending),
    },
    {
      turn: turn as AcceptedDartIQDart['turn'],
      dart: dart as AcceptedDartIQDart['dart'],
      leg: leg as AcceptedDartIQDart['leg'],
    },
    eventCache
  );
  if (accepted && eventCache.get(matchId)) eventCache.get(matchId)!.revision = accepted.revision;
  const narrativeTimeline = eventCache.timeline(matchId);
  const sourceIndex = narrativeTimeline?.findIndex((event) => event.dartId === throwId) ?? -1;
  const narrative = narrativeTimeline
    ? buildCommentaryNarrativeMemory({
        events: narrativeTimeline.slice(0, sourceIndex + 1),
        finishRule: match.finish as FinishRule,
      })
    : undefined;

  const canonical: DartIQDartEvent | undefined = narrativeTimeline?.[sourceIndex];
  const replayInput = eventCache.get(matchId)?.input;
  return classifyScoliaRealtimeDart({
    currentState: canonical?.after,
    grouping: measureCommentaryGrouping((turn as { throws?: GroupingDart[] }).throws ?? [], dart.dart_index),
    landing: describeCommentaryLanding(dart.segment, dart.impact_x_mm, dart.impact_y_mm),
    landingBefore: canonical && replayInput ? commentaryLandingForecast(replayInput, canonical.before, dart.segment) : undefined,
    landingNext: canonical && replayInput && !canonical.legResolution
      && canonical.after.currentPlayerId === canonical.playerId && canonical.after.dartsRemainingInTurn < 3
      ? commentaryLandingForecast(replayInput, canonical.after) : undefined,
    matchId,
    legId: leg.id as string,
    legNumber: leg.leg_number as number,
    turnId: turn.id as string,
    dartId: dart.id as string,
    playerId: turn.player_id as string,
    playerName: player.display_name as string,
    dartIndex: dart.dart_index as number,
    segment: dart.segment as string,
    scored: dart.scored as number,
    turnScore: dartiq?.turnScoreAfter ?? turn.total_scored as number,
    visitDarts: ((turn as {
      throws?: Array<{ dart_index: number; segment: string; scored: number }>;
    }).throws ?? [])
      .slice()
      .filter((visitDart) => visitDart.dart_index <= dart.dart_index)
      .sort((a, b) => a.dart_index - b.dart_index)
      .map((visitDart) => ({
        dartIndex: visitDart.dart_index,
        segment: visitDart.segment,
        scored: visitDart.scored,
      })),
    busted: dartiq?.busted ?? turn.busted as boolean,
    checkedOut: dartiq?.checkedOut ?? leg.winner_player_id === turn.player_id,
    matchWon: dartiq
      ? Boolean(dartiq.legResolution?.matchWon && dartiq.legResolution.winnerPlayerId === turn.player_id)
      : match.winner_player_id === turn.player_id,
    nikitaSpecial: isNikitaSpecial(
      ((turn as { throws?: Array<{ scored: number; dart_index: number }> }).throws ?? [])
        .filter((visitDart) => visitDart.dart_index <= dart.dart_index)
    ),
    dartiq,
    narrative,
    isLatestDart: narrativeTimeline ? sourceIndex >= 0 && sourceIndex === narrativeTimeline.length - 1 : undefined,
  });
}

type AcceptedDartIQDart = {
  turn: {
    id: string; leg_id: string; player_id: string; turn_number: number;
    total_scored: number; busted: boolean; tiebreak_round: number | null;
  };
  dart: { id: string; turn_id: string; dart_index: number; segment: string; scored: number };
  leg: {
    id: string; match_id: string; leg_number: number; starting_player_id: string;
    winner_player_id: string | null;
  };
};

export type AcceptedScoliaDartRows = AcceptedDartIQDart['dart'] & {
  impact_x_mm: number | null;
  impact_y_mm: number | null;
  turn: (AcceptedDartIQDart['turn'] & {
    throws: Array<AcceptedDartIQDart['dart'] & { impact_x_mm: number | null; impact_y_mm: number | null }>;
    player: { id: string; display_name: string } | null;
    leg: (AcceptedDartIQDart['leg'] & {
      match: { id: string; winner_player_id: string | null; start_score: string | number;
        finish: FinishRule; legs_to_win: number; fair_ending: boolean } | null;
    }) | null;
  }) | null;
};

async function loadDartIQPacket(
  supabase: SupabaseClient,
  matchId: string,
  throwId: string,
  currentLeg: { id: string },
  config: { startScore: number; finishRule: FinishRule; legsToWin: number; fairEnding: boolean },
  accepted: AcceptedDartIQDart,
  dartIQCache?: ScoliaDartIQEventCache
): Promise<DartIQDartPacket | undefined> {
  const cached = dartIQCache?.get(matchId);
  if (cached) {
    const existing = cached.tracker.events().find((event) => event.dartId === throwId);
    if (existing) return createDartIQDartPacket(existing);
    const followsCache = cached.legId === accepted.leg.id && (
      (accepted.turn.turn_number === cached.lastTurnNumber + 1 && accepted.dart.dart_index === 1)
      || (accepted.turn.turn_number === cached.lastTurnNumber
        && accepted.dart.dart_index === cached.lastDartIndex + 1)
    );
    if (followsCache) {
      const leg = cached.input.legs.find((entry) => entry.id === accepted.leg.id);
      if (leg) leg.winner_player_id = accepted.leg.winner_player_id;
      const turns = cached.input.turnsByLeg[accepted.leg.id] ?? [];
      let turn = turns.find((entry) => entry.id === accepted.turn.id);
      if (!turn) {
        turn = { ...accepted.turn, throws: [] };
        turns.push(turn);
        cached.input.turnsByLeg[accepted.leg.id] = turns;
      }
      turn.total_scored = accepted.turn.total_scored;
      turn.busted = accepted.turn.busted;
      if (!turn.throws.some((dart) => dart.id === accepted.dart.id)) turn.throws.push(accepted.dart);
      cached.tracker.update(cached.input);
      cached.timeline = cached.tracker.events();
      cached.lastTurnNumber = accepted.turn.turn_number;
      cached.lastDartIndex = accepted.dart.dart_index;
      const event = cached.tracker.events().find((entry) => entry.dartId === throwId);
      return event ? createDartIQDartPacket(event) : undefined;
    }
    dartIQCache?.delete(matchId);
  }

  const context = await loadScoliaDartIQContext(supabase, matchId, config, currentLeg.id);
  if (!context) return undefined;
  context.lastTurnNumber ||= accepted.turn.turn_number;
  context.lastDartIndex = context.timeline.at(-1)?.dartIndex ?? accepted.dart.dart_index;
  dartIQCache?.set(matchId, context);
  const dartIQEvent = context.timeline.find((event) => event.dartId === throwId);
  return dartIQEvent ? createDartIQDartPacket(dartIQEvent) : undefined;
}

/** Builds the same canonical replay used by live delivery, without sending speech. */
export async function warmScoliaDartIQContext(
  supabase: SupabaseClient,
  matchId: string,
): Promise<CachedDartIQContext | undefined> {
  const { data: match, error } = await supabase.from('matches')
    .select('start_score, finish, legs_to_win, fair_ending').eq('id', matchId).single();
  if (error) throw new Error(error.message);
  if (!match) return undefined;
  return loadScoliaDartIQContext(supabase, matchId, {
    startScore: Number.parseInt(String(match.start_score), 10),
    finishRule: match.finish as FinishRule,
    legsToWin: match.legs_to_win as number,
    fairEnding: Boolean(match.fair_ending),
  });
}

async function loadScoliaDartIQContext(
  supabase: SupabaseClient,
  matchId: string,
  config: { startScore: number; finishRule: FinishRule; legsToWin: number; fairEnding: boolean },
  currentLegId?: string,
): Promise<CachedDartIQContext | undefined> {
  const [playersResult, legsResult, frozenEvidence] = await Promise.all([
    supabase
      .from('match_players')
      .select('player_id, play_order')
      .eq('match_id', matchId)
      .order('play_order'),
    supabase
      .from('legs')
      .select('id, match_id, leg_number, starting_player_id, winner_player_id')
      .eq('match_id', matchId)
      .order('leg_number'),
    loadFrozenDartIQEvidence(supabase, matchId),
  ]);
  const error = playersResult.error
    ?? legsResult.error;
  if (error) throw new Error(error.message);

  // Do not warm a fallback model before the match's immutable evidence exists.
  if (!currentLegId && !frozenEvidence) return undefined;

  const playerIds = (playersResult.data ?? []).map((row) => row.player_id as string);
  const playerIdSet = new Set(playerIds);
  const allLegs = (legsResult.data ?? []) as Array<{
    id: string;
    match_id: string;
    leg_number: number;
    starting_player_id: string;
    winner_player_id: string | null;
  }>;
  const turnsResult = await supabase
    .from('turns')
    .select(`
      id, leg_id, player_id, turn_number, total_scored, busted, tiebreak_round,
      throws:throws(id, turn_id, dart_index, segment, scored)
    `)
    .in('leg_id', allLegs.map((leg) => leg.id))
    .order('turn_number');
  if (turnsResult.error) throw new Error(turnsResult.error.message);
  const replayLeg = currentLegId
    ? allLegs.find((leg) => leg.id === currentLegId)
    : allLegs.at(-1);
  if (!replayLeg || playerIds.length === 0) return undefined;

  const turnsByLeg = Object.fromEntries(allLegs.map((leg) => [leg.id, [] as TurnWithThrows[]]));
  for (const turn of (turnsResult.data ?? []) as unknown as TurnWithThrows[]) {
    (turnsByLeg[turn.leg_id] ??= []).push(turn);
  }
  const playerProfiles = Object.fromEntries(
    (frozenEvidence?.playerProfiles ?? [])
      .filter((profile) => playerIdSet.has(profile.playerId))
      .map((profile) => [profile.playerId, profile])
  );
  const populationProfile = frozenEvidence?.populationProfile;
  const populationOutcomes = frozenEvidence?.populationOutcomes ?? [];
  const personalOutcomes = new Map<string, typeof populationOutcomes>();
  for (const outcome of frozenEvidence?.playerOutcomes ?? []) {
    if (!playerIdSet.has(outcome.playerId)) continue;
    const existing = personalOutcomes.get(outcome.playerId) ?? [];
    existing.push(outcome);
    personalOutcomes.set(outcome.playerId, existing);
  }
  const outcomeModels = Object.fromEntries(playerIds.map((playerId) => [
    playerId,
    createAdaptiveDartIQModel({
      playerId,
      deployment: frozenEvidence?.modelDeployment,
      personal: personalOutcomes.get(playerId),
      population: populationOutcomes,
    }),
  ]));

  const input: DartIQReplayInput = {
    playerIds,
    legs: allLegs,
    turnsByLeg,
    startScore: config.startScore,
    finishRule: config.finishRule,
    legsToWin: config.legsToWin,
    initialLegsWon: {},
    playerProfiles,
    populationProfile,
    outcomeModels,
    fairEnding: config.fairEnding,
  };
  const tracker = new DartIQTracker();
  tracker.update(input);
  const timeline = tracker.events();
  const latestEvent = timeline.at(-1);
  const latestTurn = latestEvent
    ? (input.turnsByLeg[replayLeg.id] ?? []).find((turn) => turn.id === latestEvent.turnId)
    : undefined;
  return {
    input,
    tracker,
    timeline,
    legId: replayLeg.id,
    lastTurnNumber: latestTurn?.turn_number ?? 0,
    lastDartIndex: latestTurn ? latestEvent!.dartIndex : 0,
  };
}
