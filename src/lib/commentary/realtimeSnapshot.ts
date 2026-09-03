import type { SupabaseClient } from '@supabase/supabase-js';

import { computeFairEndingState, getNextFairEndingPlayer } from '../../utils/fairEnding.ts';
import type { MatchRow } from '../server/matchGuards.ts';
import {
  buildCommentaryNarrativeMemory,
  type CommentaryNarrativeMemory,
  type CommentaryRematchContext,
} from './commentaryNarrative.ts';
import {
  createDartIQSkillModel,
} from '../dartiq/evidence.ts';
import { reconstructDartIQTimeline } from '../dartiq/replay.ts';
import type { TurnWithThrows } from '../match/types.ts';
import {
  createBehavioralOutcomeModel,
} from '../dartiq/model/outcomes.ts';
import { loadFrozenDartIQEvidence } from '../server/dartiqEvidence';

type SnapshotTurn = {
  id: string;
  leg_id: string;
  player_id: string;
  turn_number: number;
  total_scored: number;
  busted: boolean;
  tiebreak_round: number | null;
  throws: Array<{ id: string; turn_id: string; dart_index: number; segment: string; scored: number }>;
};

export type RealtimeCommentarySnapshot = {
  schemaVersion: 1;
  kind: 'match_snapshot';
  matchId: string;
  generatedAt: string;
  sequence: number;
  scoringSource: 'manual' | 'scolia';
  startScore: number;
  finishRule: MatchRow['finish'];
  legsToWin: number;
  fairEnding: boolean;
  players: Array<{
    id: string;
    name: string;
    playOrder: number;
    score: number;
    legsWon: number;
    historicalBaseline: ReturnType<typeof createDartIQSkillModel>;
  }>;
  currentLeg: null | {
    id: string;
    number: number;
    startingPlayerId: string;
    currentPlayerId: string | null;
    fairEndingState: ReturnType<typeof computeFairEndingState> | null;
  };
  matchWinnerId: string | null;
  rematch: CommentaryRematchContext | null;
  narrative: CommentaryNarrativeMemory;
};

export async function loadRealtimeCommentarySnapshot(
  supabase: SupabaseClient,
  match: MatchRow
): Promise<RealtimeCommentarySnapshot> {
  const [playersResult, legsResult, frozenEvidence] = await Promise.all([
    supabase
      .from('match_players')
      .select('player_id, play_order, players:player_id(display_name)')
      .eq('match_id', match.id)
      .order('play_order'),
    supabase
      .from('legs')
      .select('id, leg_number, starting_player_id, winner_player_id')
      .eq('match_id', match.id)
      .order('leg_number'),
    loadFrozenDartIQEvidence(supabase, match.id),
  ]);
  const error = playersResult.error
    ?? legsResult.error;
  if (error) throw new Error(error.message);

  const playerRows = (playersResult.data ?? []) as unknown as Array<{
    player_id: string;
    play_order: number;
    players: { display_name: string } | null;
  }>;
  const playerIds = playerRows.map((row) => row.player_id);
  const playerIdSet = new Set(playerIds);
  const profiles = new Map(
    (frozenEvidence?.playerProfiles ?? [])
      .filter((profile) => playerIdSet.has(profile.playerId))
      .map((profile) => [profile.playerId, profile] as const)
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
  const outcomeModels = Object.fromEntries(playerRows.map((row) => [
    row.player_id,
    createBehavioralOutcomeModel({
      personal: personalOutcomes.get(row.player_id),
      population: populationOutcomes,
    }),
  ]));
  const legs = (legsResult.data ?? []) as Array<{
    id: string;
    leg_number: number;
    starting_player_id: string;
    winner_player_id: string | null;
  }>;
  const currentLeg = legs.find((leg) => !leg.winner_player_id) ?? legs.at(-1) ?? null;
  let allTurns: SnapshotTurn[] = [];
  if (currentLeg) {
    const result = await supabase
      .from('turns')
      .select(`
        id, leg_id, player_id, turn_number, total_scored, busted, tiebreak_round,
        throws:throws(id, turn_id, dart_index, segment, scored)
      `)
      .in('leg_id', legs.map((leg) => leg.id))
      .order('turn_number');
    if (result.error) throw new Error(result.error.message);
    allTurns = (result.data ?? []) as unknown as SnapshotTurn[];
  }
  const turns = currentLeg
    ? allTurns.filter((turn) => turn.leg_id === currentLeg.id)
    : [];

  const startScore = Number.parseInt(match.start_score, 10);
  const scores = Object.fromEntries(playerRows.map((row) => [row.player_id, startScore]));
  for (const turn of turns) {
    if (turn.tiebreak_round != null || turn.busted) continue;
    scores[turn.player_id] = Math.max(0, (scores[turn.player_id] ?? startScore) - turn.total_scored);
  }
  const legsWon = Object.fromEntries(playerRows.map((row) => [row.player_id, 0]));
  for (const leg of legs) {
    if (leg.winner_player_id) legsWon[leg.winner_player_id] = (legsWon[leg.winner_player_id] ?? 0) + 1;
  }
  const orderedIds = currentLeg
    ? rotateIds(playerRows.map((row) => row.player_id), currentLeg.starting_player_id)
    : playerRows.map((row) => row.player_id);
  const fairEndingTurns = turns.map((turn) => ({
    player_id: turn.player_id,
    total_scored: turn.total_scored,
    busted: turn.busted,
    tiebreak_round: turn.tiebreak_round,
    throw_count: turn.throws.length,
    throws_total: turn.throws.reduce((sum, dart) => sum + dart.scored, 0),
  }));
  const fairEndingState = currentLeg && match.fair_ending
    ? computeFairEndingState(
        fairEndingTurns,
        orderedIds.map((id) => ({ id })),
        startScore,
        true
      )
    : null;
  const lastTurn = turns.at(-1);
  const currentPlayerId = fairEndingState && fairEndingState.phase !== 'normal'
    ? getNextFairEndingPlayer(fairEndingState, orderedIds.map((id) => ({ id })), fairEndingTurns)
    : lastTurn && lastTurn.throws.length < 3 && !lastTurn.busted
      ? lastTurn.player_id
      : nextPlayerId(orderedIds, lastTurn?.player_id);
  let rematch: CommentaryRematchContext | null = null;
  if (match.rematch_of_match_id) {
    const { data: previous, error: previousError } = await supabase
      .from('matches')
      .select('id, winner_player_id')
      .eq('id', match.rematch_of_match_id)
      .maybeSingle();
    if (previousError) throw new Error(previousError.message);
    if (previous) {
      rematch = {
        previousMatchId: previous.id as string,
        previousWinnerId: previous.winner_player_id as string | null,
        revengePlayerIds: previous.winner_player_id
          ? playerRows
              .map((row) => row.player_id)
              .filter((playerId) => playerId !== previous.winner_player_id)
          : [],
      };
    }
  }
  const turnsByLeg = Object.fromEntries(legs.map((leg) => [leg.id, [] as TurnWithThrows[]]));
  for (const turn of allTurns as unknown as TurnWithThrows[]) {
    (turnsByLeg[turn.leg_id] ??= []).push(turn);
  }
  const dartIQTimeline = playerRows.length > 0 && legs.length > 0
    ? reconstructDartIQTimeline({
        playerIds: playerRows.map((row) => row.player_id),
        legs: legs.map((leg) => ({ ...leg, match_id: match.id })),
        turnsByLeg,
        startScore,
        finishRule: match.finish,
        legsToWin: match.legs_to_win,
        initialLegsWon: {},
        playerProfiles: Object.fromEntries(profiles),
        populationProfile,
        outcomeModels,
        fairEnding: match.fair_ending,
      })
    : [];
  const narrative = buildCommentaryNarrativeMemory({
    events: dartIQTimeline,
    finishRule: match.finish,
    rematch,
  });

  return {
    schemaVersion: 1,
    kind: 'match_snapshot',
    matchId: match.id,
    generatedAt: new Date().toISOString(),
    sequence: allTurns.reduce((count, turn) => count + turn.throws.length, 0),
    scoringSource: match.scolia_board_id ? 'scolia' : 'manual',
    startScore,
    finishRule: match.finish,
    legsToWin: match.legs_to_win,
    fairEnding: match.fair_ending,
    players: playerRows.map((row) => ({
      id: row.player_id,
      name: row.players?.display_name ?? 'Player',
      playOrder: row.play_order,
      score: scores[row.player_id] ?? startScore,
      legsWon: legsWon[row.player_id] ?? 0,
      historicalBaseline: createDartIQSkillModel(
        profiles.get(row.player_id),
        populationProfile
      ),
    })),
    currentLeg: currentLeg ? {
      id: currentLeg.id,
      number: currentLeg.leg_number,
      startingPlayerId: currentLeg.starting_player_id,
      currentPlayerId,
      fairEndingState,
    } : null,
    matchWinnerId: match.winner_player_id,
    rematch,
    narrative,
  };
}

function rotateIds(ids: string[], startingId: string) {
  const index = ids.indexOf(startingId);
  return index > 0 ? [...ids.slice(index), ...ids.slice(0, index)] : ids.slice();
}

function nextPlayerId(ids: string[], previousId?: string) {
  if (ids.length === 0) return null;
  if (!previousId) return ids[0];
  const index = ids.indexOf(previousId);
  return ids[(Math.max(0, index) + 1) % ids.length] ?? ids[0];
}
