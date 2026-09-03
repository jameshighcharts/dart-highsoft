import type { SupabaseClient } from '@supabase/supabase-js';

import { detectedThrowFromMessage, type ScoliaMessage } from '../scolia/protocol.ts';
import { completeLeg } from './completeLeg.ts';
import { isMatchActive, loadMatch, type MatchRow } from './matchGuards.ts';
import { resolveOrCreateTurnForPlayer } from './turnLifecycle.ts';
import { replayTurn, type ThrowData } from '../../utils/legScoreCalculator.ts';
import { computeFairEndingState, getNextFairEndingPlayer, type FairEndingState } from '../../utils/fairEnding.ts';
import { findExistingGameThrow, ingestGameThrow, settleExistingGameThrow } from './gameScoliaIngestion.ts';
import { findActiveScoliaBoardTarget, type ScoliaBoardTarget } from './scoliaBoardTarget.ts';

export type StoredScoliaEvent = {
  id: number;
  board_id: string;
  message_id: string;
  event_type: string;
  payload: Record<string, unknown>;
};

type ThrowRow = ThrowData & {
  id: string;
  turn_id: string;
  scolia_event_id: number | null;
};

type TurnRow = {
  id: string;
  leg_id: string;
  player_id: string;
  turn_number: number;
  total_scored: number;
  busted: boolean;
  tiebreak_round: number | null;
  throws: ThrowRow[];
};

type LegRow = {
  id: string;
  match_id: string;
  leg_number: number;
  starting_player_id: string;
  winner_player_id: string | null;
};

type MatchSnapshot = {
  match: MatchRow;
  leg: LegRow;
  playerIds: string[];
  orderPlayerIds: string[];
  turns: TurnRow[];
  fairEndingState: FairEndingState;
};

export type ScoliaThrowIngestionResult =
  | { status: 'processed'; target: ScoliaBoardTarget; throwId: string }
  | { status: 'ignored'; reason: string };

function eventMessage(event: StoredScoliaEvent): ScoliaMessage {
  return { type: event.event_type, id: event.message_id, payload: event.payload };
}

function turnInputs(turns: TurnRow[]) {
  return turns.map((turn) => ({
    player_id: turn.player_id,
    total_scored: turn.total_scored,
    busted: turn.busted,
    tiebreak_round: turn.tiebreak_round,
    throw_count: turn.throws.length,
    throws_total: turn.throws.reduce((sum, dart) => sum + dart.scored, 0),
  }));
}

async function updateEvent(
  supabase: SupabaseClient,
  eventId: number,
  status: 'processed' | 'ignored' | 'failed',
  error: string | null
) {
  const { error: updateError } = await supabase
    .from('scolia_events')
    .update({
      processing_status: status,
      processed_at: status === 'failed' ? null : new Date().toISOString(),
      processing_error: error,
    })
    .eq('id', eventId);
  if (updateError) throw new Error(updateError.message);
}

async function loadSnapshot(
  supabase: SupabaseClient,
  matchId: string,
  requestedLegId?: string
): Promise<MatchSnapshot | null> {
  const match = await loadMatch(supabase, matchId);
  if (!match) return null;

  let legQuery = supabase
    .from('legs')
    .select('id, match_id, leg_number, starting_player_id, winner_player_id')
    .eq('match_id', matchId);
  legQuery = requestedLegId
    ? legQuery.eq('id', requestedLegId)
    : legQuery.is('winner_player_id', null).order('leg_number', { ascending: false }).limit(1);
  const { data: legData, error: legError } = await legQuery.maybeSingle();
  if (legError) throw new Error(legError.message);
  if (!legData) return null;
  const leg = legData as LegRow;

  const [{ data: playerData, error: playerError }, { data: turnData, error: turnError }] = await Promise.all([
    supabase
      .from('match_players')
      .select('player_id, play_order')
      .eq('match_id', matchId)
      .order('play_order'),
    supabase
      .from('turns')
      .select(`
        id, leg_id, player_id, turn_number, total_scored, busted, tiebreak_round,
        throws:throws(id, turn_id, dart_index, segment, scored, scolia_event_id)
      `)
      .eq('leg_id', leg.id)
      .order('turn_number'),
  ]);
  if (playerError) throw new Error(playerError.message);
  if (turnError) throw new Error(turnError.message);

  const playerIds = (playerData ?? []).map((row) => row.player_id as string);
  if (playerIds.length === 0) throw new Error('Scolia match has no players');
  const startIndex = playerIds.indexOf(leg.starting_player_id);
  const orderPlayerIds = startIndex < 0
    ? playerIds
    : [...playerIds.slice(startIndex), ...playerIds.slice(0, startIndex)];
  const turns = (turnData ?? []).map((row) => ({
    ...row,
    throws: (Array.isArray(row.throws) ? row.throws : [])
      .map((dart) => dart as ThrowRow)
      .sort((a, b) => a.dart_index - b.dart_index),
  })) as TurnRow[];
  const fairEndingState = computeFairEndingState(
    turnInputs(turns),
    orderPlayerIds.map((id) => ({ id })),
    Number.parseInt(match.start_score, 10),
    match.fair_ending
  );

  return { match, leg, playerIds, orderPlayerIds, turns, fairEndingState };
}

function selectCurrentPlayerId(snapshot: MatchSnapshot): string | null {
  const { fairEndingState, orderPlayerIds, turns } = snapshot;
  if (fairEndingState.phase === 'resolved') return null;
  if (fairEndingState.phase !== 'normal') {
    return getNextFairEndingPlayer(
      fairEndingState,
      orderPlayerIds.map((id) => ({ id })),
      turnInputs(turns)
    );
  }

  const latest = turns.at(-1);
  if (latest && latest.throws.length < 3 && !latest.busted) return latest.player_id;
  return orderPlayerIds[turns.length % orderPlayerIds.length] ?? null;
}

async function finishThrowLifecycle(
  supabase: SupabaseClient,
  matchId: string,
  legId: string,
  turnId: string,
  throwId: string
) {
  const snapshot = await loadSnapshot(supabase, matchId, legId);
  if (!snapshot) throw new Error('Could not reload the Scolia match after recording a throw');
  const turn = snapshot.turns.find((candidate) => candidate.id === turnId);
  if (!turn) throw new Error('Could not reload the Scolia turn after recording a throw');

  const isTiebreak = turn.tiebreak_round != null;
  const turnStartScore = isTiebreak
    ? 0
    : (() => {
        let score = Number.parseInt(snapshot.match.start_score, 10);
        for (const candidate of snapshot.turns) {
          if (candidate.id === turn.id) break;
          if (candidate.player_id !== turn.player_id || candidate.tiebreak_round != null) continue;
          const replayed = replayTurn([...candidate.throws], score, snapshot.match.finish);
          if (!replayed.busted) score = replayed.score_after;
        }
        return score;
      })();
  const replayed = isTiebreak
    ? { busted: false, finished: false }
    : replayTurn([...turn.throws], turnStartScore, snapshot.match.finish);
  const turnComplete = replayed.busted || replayed.finished || turn.throws.length >= 3;
  if (!turnComplete) return;

  const totalScored = turn.throws.reduce((sum, dart) => sum + dart.scored, 0);
  const { error: turnUpdateError } = await supabase
    .from('turns')
    .update({ total_scored: totalScored, busted: replayed.busted })
    .eq('id', turn.id);
  if (turnUpdateError) throw new Error(turnUpdateError.message);

  if (replayed.finished && !snapshot.match.fair_ending) {
    await completeLeg(supabase, matchId, legId, turn.player_id, snapshot.match);
    return;
  }

  if (snapshot.match.fair_ending) {
    const refreshed = await loadSnapshot(supabase, matchId, legId);
    if (refreshed?.fairEndingState.phase === 'resolved' && refreshed.fairEndingState.winnerId) {
      await completeLeg(
        supabase,
        matchId,
        legId,
        refreshed.fairEndingState.winnerId,
        refreshed.match
      );
    }
  }

  // Keep the argument intentionally used: callers know the inserted row made it
  // through all turn/leg side effects before the event is marked processed.
  void throwId;
}

async function findExistingThrow(supabase: SupabaseClient, eventId: number): Promise<ThrowRow | null> {
  const { data, error } = await supabase
    .from('throws')
    .select('id, turn_id, dart_index, segment, scored, scolia_event_id')
    .eq('scolia_event_id', eventId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ThrowRow | null) ?? null;
}

async function matchAndLegForTurn(
  supabase: SupabaseClient,
  turnId: string
): Promise<{ matchId: string; legId: string } | null> {
  const { data: turn, error: turnError } = await supabase
    .from('turns')
    .select('leg_id')
    .eq('id', turnId)
    .maybeSingle();
  if (turnError) throw new Error(turnError.message);
  if (!turn) return null;
  const { data: leg, error: legError } = await supabase
    .from('legs')
    .select('match_id')
    .eq('id', turn.leg_id)
    .maybeSingle();
  if (legError) throw new Error(legError.message);
  return leg ? { matchId: leg.match_id as string, legId: turn.leg_id as string } : null;
}

/**
 * Apply one persisted THROW_DETECTED event to the currently active match on
 * its board. This is safe to retry: scolia_event_id can create only one throw.
 */
export async function ingestScoliaThrowEvent(
  supabase: SupabaseClient,
  event: StoredScoliaEvent
): Promise<ScoliaThrowIngestionResult> {
  try {
    const detected = detectedThrowFromMessage(eventMessage(event));
    if (!detected) {
      const reason = 'Invalid THROW_DETECTED payload';
      await updateEvent(supabase, event.id, 'ignored', reason);
      return { status: 'ignored', reason };
    }

    const [existingThrow, existingGameThrow] = await Promise.all([
      findExistingThrow(supabase, event.id),
      findExistingGameThrow(supabase, event.id),
    ]);
    if (existingGameThrow) {
      await settleExistingGameThrow(supabase, existingGameThrow);
      await updateEvent(supabase, event.id, 'processed', null);
      return { status: 'processed', target: { kind: 'game', id: existingGameThrow.session_id }, throwId: existingGameThrow.id };
    }
    if (existingThrow) {
      const linked = await matchAndLegForTurn(supabase, existingThrow.turn_id);
      if (linked) {
        const match = await loadMatch(supabase, linked.matchId);
        if (match && isMatchActive(match)) {
          await finishThrowLifecycle(
            supabase,
            linked.matchId,
            linked.legId,
            existingThrow.turn_id,
            existingThrow.id
          );
        }
        await updateEvent(supabase, event.id, 'processed', null);
        return { status: 'processed', target: { kind: 'match', id: linked.matchId }, throwId: existingThrow.id };
      }
    }

    const target = await findActiveScoliaBoardTarget(supabase, event.board_id);
    if (!target) {
      const reason = 'No active match or game is assigned to this board';
      await updateEvent(supabase, event.id, 'ignored', reason);
      return { status: 'ignored', reason };
    }
    if (target.kind === 'game') {
      const outcome = await ingestGameThrow(supabase, target.id, event.id, event.board_id, detected);
      if (outcome.status === 'ignored') {
        await updateEvent(supabase, event.id, 'ignored', outcome.reason);
        return outcome;
      }
      await updateEvent(supabase, event.id, 'processed', null);
      return { status: 'processed', target, throwId: outcome.throwId };
    }

    const matchId = target.id;
    const snapshot = await loadSnapshot(supabase, matchId);
    if (!snapshot || !isMatchActive(snapshot.match)) {
      const reason = 'The assigned match has no active leg';
      await updateEvent(supabase, event.id, 'ignored', reason);
      return { status: 'ignored', reason };
    }
    const playerId = selectCurrentPlayerId(snapshot);
    if (!playerId) throw new Error('Could not determine the current player for this Scolia throw');
    const isTiebreak = snapshot.fairEndingState.phase === 'tiebreak';
    const resolved = await resolveOrCreateTurnForPlayer(
      supabase,
      snapshot.leg.id,
      playerId,
      isTiebreak ? snapshot.fairEndingState.tiebreakRound : undefined
    );
    if ('error' in resolved) throw new Error(resolved.error);

    const { data: currentThrows, error: currentThrowsError } = await supabase
      .from('throws')
      .select('id, turn_id, dart_index, segment, scored, scolia_event_id')
      .eq('turn_id', resolved.turn.id)
      .order('dart_index');
    if (currentThrowsError) throw new Error(currentThrowsError.message);
    const throws = (currentThrows ?? []) as ThrowRow[];
    if (throws.length >= 3) throw new Error('The current Scolia turn already has three darts');

    const { data: insertedThrow, error: insertError } = await supabase
      .from('throws')
      .insert({
        turn_id: resolved.turn.id,
        dart_index: throws.length + 1,
        segment: detected.segment,
        scored: detected.scored,
        scolia_event_id: event.id,
        impact_x_mm: detected.impactXmm ?? null,
        impact_y_mm: detected.impactYmm ?? null,
        angle_horizontal_deg: detected.angleHorizontalDeg ?? null,
        angle_vertical_deg: detected.angleVerticalDeg ?? null,
      })
      .select('id, turn_id, dart_index, segment, scored, scolia_event_id, impact_x_mm, impact_y_mm, angle_horizontal_deg, angle_vertical_deg')
      .single();
    if (insertError || !insertedThrow) {
      const duplicate = await findExistingThrow(supabase, event.id);
      if (!duplicate) throw new Error(insertError?.message ?? 'Failed to create Scolia throw');
      await finishThrowLifecycle(supabase, matchId, snapshot.leg.id, duplicate.turn_id, duplicate.id);
      await updateEvent(supabase, event.id, 'processed', null);
      return { status: 'processed', target, throwId: duplicate.id };
    }

    const inserted = insertedThrow as ThrowRow;
    await finishThrowLifecycle(supabase, matchId, snapshot.leg.id, inserted.turn_id, inserted.id);
    await updateEvent(supabase, event.id, 'processed', null);
    return { status: 'processed', target, throwId: inserted.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Scolia ingestion error';
    try {
      await updateEvent(supabase, event.id, 'failed', message);
    } catch {
      // Preserve the original ingestion failure for the worker log.
    }
    throw error;
  }
}
