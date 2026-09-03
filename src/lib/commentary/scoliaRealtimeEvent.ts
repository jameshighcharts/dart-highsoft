import type { SupabaseClient } from '@supabase/supabase-js';

import type { TurnWithThrows } from '../match/types.ts';
import {
  createPressureDartPacket,
  type PressureDartPacket,
  type PressureEventPriority,
} from '../../utils/pressureEvents.ts';
import type {
  PressurePlayerHistoryProfile,
  PressurePopulationProfile,
} from '../../utils/pressureProfiles.ts';
import { reconstructPressureTimeline } from '../../utils/pressureReplay.ts';
import type { FinishRule } from '../../utils/x01.ts';
import { isNikitaSpecial } from '../../utils/nikitaSpecial.ts';
import {
  createBehavioralOutcomeModel,
  normalizePressureOutcomeObservation,
  type PressureOutcomeObservationRow,
} from '../../utils/pressureOutcomeModel.ts';
import {
  buildCommentaryNarrativeMemory,
  type CommentaryNarrativeMemory,
} from './commentaryNarrative.ts';

type CachedPressureContext = {
  input: Parameters<typeof reconstructPressureTimeline>[0];
  timeline: ReturnType<typeof reconstructPressureTimeline>;
  legId: string;
  lastTurnNumber: number;
  lastDartIndex: number;
};

export class ScoliaPressureEventCache {
  private readonly matches = new Map<string, CachedPressureContext>();
  get(matchId: string) { return this.matches.get(matchId); }
  timeline(matchId: string) { return this.matches.get(matchId)?.timeline; }
  set(matchId: string, value: CachedPressureContext) { this.matches.set(matchId, value); }
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
  pressure?: PressureDartPacket;
  priority: PressureEventPriority;
  shouldSpeak: boolean;
  narrative?: CommentaryNarrativeMemory;
};

export type ScoliaRealtimeDartFacts = Omit<
  ScoliaRealtimeDartEvent,
  'schemaVersion' | 'kind' | 'eventId' | 'priority' | 'shouldSpeak'
>;

export function classifyScoliaRealtimeDart(
  facts: ScoliaRealtimeDartFacts,
  options: { allowSpeech?: boolean } = {}
): ScoliaRealtimeDartEvent {
  let priority: PressureEventPriority = 'silent';
  if (facts.matchWon) priority = 'terminal';
  else if (facts.nikitaSpecial) priority = 'marquee';
  else if (facts.pressure) priority = facts.pressure.priority;
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

/** Load the post-ingestion facts directly from canonical rows; no Realtime round trip is involved. */
export async function loadScoliaRealtimeDartEvent(
  supabase: SupabaseClient,
  matchId: string,
  throwId: string,
  pressureCache?: ScoliaPressureEventCache
): Promise<ScoliaRealtimeDartEvent> {
  const { data: dart, error: dartError } = await supabase
    .from('throws')
    .select('id, turn_id, dart_index, segment, scored')
    .eq('id', throwId)
    .single();
  if (dartError || !dart) throw new Error(dartError?.message ?? 'Accepted Scolia throw was not found');

  const { data: turn, error: turnError } = await supabase
    .from('turns')
    .select(`
      id, leg_id, player_id, turn_number, total_scored, busted, tiebreak_round,
      throws:throws(id, scored, dart_index, segment)
    `)
    .eq('id', dart.turn_id)
    .single();
  if (turnError || !turn) throw new Error(turnError?.message ?? 'Accepted Scolia turn was not found');

  const [{ data: leg, error: legError }, { data: match, error: matchError }, { data: player, error: playerError }] =
    await Promise.all([
      supabase
        .from('legs')
        .select('id, match_id, leg_number, starting_player_id, winner_player_id')
        .eq('id', turn.leg_id)
        .single(),
      supabase
        .from('matches')
        .select('id, winner_player_id, start_score, finish, legs_to_win, fair_ending')
        .eq('id', matchId)
        .single(),
      supabase
        .from('players')
        .select('id, display_name')
        .eq('id', turn.player_id)
        .single(),
    ]);
  if (legError || !leg || leg.match_id !== matchId) {
    throw new Error(legError?.message ?? 'Accepted Scolia leg did not belong to the match');
  }
  if (matchError || !match) throw new Error(matchError?.message ?? 'Accepted Scolia match was not found');
  if (playerError || !player) throw new Error(playerError?.message ?? 'Accepted Scolia player was not found');

  const pressure = await loadPressurePacket(
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
      turn: turn as AcceptedPressureDart['turn'],
      dart: dart as AcceptedPressureDart['dart'],
      leg: leg as AcceptedPressureDart['leg'],
    },
    pressureCache
  );
  const narrativeTimeline = pressureCache?.timeline(matchId);
  const narrative = narrativeTimeline
    ? buildCommentaryNarrativeMemory({
        events: narrativeTimeline,
        finishRule: match.finish as FinishRule,
      })
    : undefined;

  return classifyScoliaRealtimeDart({
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
    turnScore: turn.total_scored as number,
    visitDarts: ((turn as {
      throws?: Array<{ dart_index: number; segment: string; scored: number }>;
    }).throws ?? [])
      .slice()
      .sort((a, b) => a.dart_index - b.dart_index)
      .map((visitDart) => ({
        dartIndex: visitDart.dart_index,
        segment: visitDart.segment,
        scored: visitDart.scored,
      })),
    busted: turn.busted as boolean,
    checkedOut: pressure?.checkedOut ?? leg.winner_player_id === turn.player_id,
    matchWon: match.winner_player_id === turn.player_id,
    nikitaSpecial: isNikitaSpecial(
      ((turn as { throws?: Array<{ scored: number }> }).throws ?? [])
    ),
    pressure,
    narrative,
  });
}

function numeric(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

type AcceptedPressureDart = {
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

function normalizeProfileBase(row: Record<string, unknown>) {
  return {
    finishRule: row.finish_rule as FinishRule,
    visits: numeric(row.visits),
    dartsThrown: numeric(row.darts_thrown),
    scoringPoints: numeric(row.scoring_points),
    threeDartAverage: numeric(row.three_dart_average),
    busts: numeric(row.busts),
    bustRate: numeric(row.bust_rate),
    checkoutOpportunities: numeric(row.checkout_opportunities),
    checkouts: numeric(row.checkouts),
    checkoutRate: numeric(row.checkout_rate),
  };
}

async function loadPressurePacket(
  supabase: SupabaseClient,
  matchId: string,
  throwId: string,
  currentLeg: { id: string },
  config: { startScore: number; finishRule: FinishRule; legsToWin: number; fairEnding: boolean },
  accepted: AcceptedPressureDart,
  pressureCache?: ScoliaPressureEventCache
): Promise<PressureDartPacket | undefined> {
  const cached = pressureCache?.get(matchId);
  if (cached) {
    const existing = cached.timeline.find((event) => event.dartId === throwId);
    if (existing) return createPressureDartPacket(existing);
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
      cached.timeline = reconstructPressureTimeline(cached.input, { cachedPrefix: cached.timeline });
      cached.lastTurnNumber = accepted.turn.turn_number;
      cached.lastDartIndex = accepted.dart.dart_index;
      const event = cached.timeline.find((entry) => entry.dartId === throwId);
      return event ? createPressureDartPacket(event) : undefined;
    }
    pressureCache?.delete(matchId);
  }

  const [playersResult, legsResult, populationResult, populationOutcomesResult] = await Promise.all([
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
    supabase
      .from('pressure_population_profiles')
      .select('*')
      .eq('finish_rule', config.finishRule)
      .maybeSingle(),
    supabase
      .from('pressure_population_outcomes')
      .select('*')
      .eq('finish_rule', config.finishRule),
  ]);
  const error = playersResult.error
    ?? legsResult.error
    ?? populationResult.error
    ?? populationOutcomesResult.error;
  if (error) throw new Error(error.message);

  const playerIds = (playersResult.data ?? []).map((row) => row.player_id as string);
  const [playerProfilesResult, playerOutcomesResult] = await Promise.all([
    supabase
      .from('player_pressure_profiles')
      .select('*')
      .eq('finish_rule', config.finishRule)
      .in('player_id', playerIds),
    supabase
      .from('player_pressure_outcomes')
      .select('*')
      .eq('finish_rule', config.finishRule)
      .in('player_id', playerIds),
  ]);
  if (playerProfilesResult.error) throw new Error(playerProfilesResult.error.message);
  if (playerOutcomesResult.error) throw new Error(playerOutcomesResult.error.message);

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
  const replayLeg = allLegs.find((leg) => leg.id === currentLeg.id);
  if (!replayLeg || playerIds.length === 0) return undefined;

  const turnsByLeg = Object.fromEntries(allLegs.map((leg) => [leg.id, [] as TurnWithThrows[]]));
  for (const turn of (turnsResult.data ?? []) as unknown as TurnWithThrows[]) {
    (turnsByLeg[turn.leg_id] ??= []).push(turn);
  }
  const playerProfiles = Object.fromEntries(
    ((playerProfilesResult.data ?? []) as Record<string, unknown>[])
      .filter((row) => playerIdSet.has(row.player_id as string))
      .map((row) => [
        row.player_id as string,
        {
          playerId: row.player_id as string,
          matchesPlayed: numeric(row.matches_played),
          ...normalizeProfileBase(row),
        } satisfies PressurePlayerHistoryProfile,
      ])
  );
  const populationProfile = populationResult.data
    ? {
        matchesPlayed: numeric(populationResult.data.player_match_samples),
        ...normalizeProfileBase(populationResult.data as Record<string, unknown>),
      } satisfies PressurePopulationProfile
    : undefined;
  const populationOutcomes = (
    (populationOutcomesResult.data ?? []) as PressureOutcomeObservationRow[]
  ).map(normalizePressureOutcomeObservation);
  const personalOutcomes = new Map<string, ReturnType<typeof normalizePressureOutcomeObservation>[]>();
  for (const row of (playerOutcomesResult.data ?? []) as PressureOutcomeObservationRow[]) {
    if (!row.player_id || !playerIdSet.has(row.player_id)) continue;
    const existing = personalOutcomes.get(row.player_id) ?? [];
    existing.push(normalizePressureOutcomeObservation(row));
    personalOutcomes.set(row.player_id, existing);
  }
  const outcomeModels = Object.fromEntries(playerIds.map((playerId) => [
    playerId,
    createBehavioralOutcomeModel({
      personal: personalOutcomes.get(playerId),
      population: populationOutcomes,
    }),
  ]));

  const input: Parameters<typeof reconstructPressureTimeline>[0] = {
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
  const timeline = reconstructPressureTimeline(input);
  const latestEvent = timeline.at(-1);
  const latestTurn = latestEvent
    ? (input.turnsByLeg[accepted.leg.id] ?? []).find((turn) => turn.id === latestEvent.turnId)
    : undefined;
  pressureCache?.set(matchId, {
    input,
    timeline,
    legId: accepted.leg.id,
    lastTurnNumber: latestTurn?.turn_number ?? accepted.turn.turn_number,
    lastDartIndex: latestEvent?.dartIndex ?? accepted.dart.dart_index,
  });
  const pressureEvent = timeline.find((event) => event.dartId === throwId);
  return pressureEvent ? createPressureDartPacket(pressureEvent) : undefined;
}
