import { updateBullOff } from './bullOff.ts';
import type { SupabaseClient } from '@supabase/supabase-js';

import { detectedThrowFromMessage, type ScoliaMessage } from '../scolia/protocol.ts';
import { completeLeg } from './completeLeg.ts';
import { enqueueDartIQLiveThrow } from './backgroundJobs.ts';
import { isMatchScoringActive, loadMatch, type MatchRow } from './matchGuards.ts';
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
  requestedLegId?: string,
  settlingTurnId?: string
): Promise<MatchSnapshot | null> {
  const { data, error } = await supabase.rpc('load_scolia_match_snapshot', {
    p_match_id: matchId,
    p_leg_id: requestedLegId ?? null,
    p_turn_id: settlingTurnId ?? null,
  });
  if (error) throw new Error(error.message);
  if (!data) return null;
  const { match, leg, playerIds, turns } = data as Pick<MatchSnapshot, 'match' | 'leg' | 'playerIds' | 'turns'>;
  if (playerIds.length === 0) throw new Error('Scolia match has no players');
  const startIndex = playerIds.indexOf(leg.starting_player_id);
  const orderPlayerIds = startIndex < 0
    ? playerIds
    : [...playerIds.slice(startIndex), ...playerIds.slice(0, startIndex)];
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
  const snapshot = await loadSnapshot(supabase, matchId, legId, turnId);
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

async function enqueueLiveDartIQWithoutBreakingScoring(
  supabase: SupabaseClient,
  matchId: string,
  throwId: string
) {
  try {
    await enqueueDartIQLiveThrow(supabase, matchId, throwId);
  } catch (error) {
    console.error('DartIQ live Scolia telemetry error:', error);
  }
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

    const [existingThrow, existingGameThrow, bullEventResult] = await Promise.all([
      findExistingThrow(supabase, event.id),
      findExistingGameThrow(supabase, event.id),
      supabase.from('bull_off_events').select('match_id').eq('event_id', event.id).maybeSingle(),
    ]);
    if (bullEventResult.error) throw new Error(bullEventResult.error.message);
    if (bullEventResult.data) {
      await updateEvent(supabase, event.id, 'processed', null);
      return { status: 'ignored', reason: 'Bull-off dart already recorded' };
    }
    if (existingGameThrow) {
      await settleExistingGameThrow(supabase, existingGameThrow);
      await updateEvent(supabase, event.id, 'processed', null);
      return { status: 'processed', target: { kind: 'game', id: existingGameThrow.session_id }, throwId: existingGameThrow.id };
    }
    if (existingThrow) {
      const linked = await matchAndLegForTurn(supabase, existingThrow.turn_id);
      if (linked) {
        const match = await loadMatch(supabase, linked.matchId);
        if (match && isMatchScoringActive(match)) {
          await finishThrowLifecycle(
            supabase,
            linked.matchId,
            linked.legId,
            existingThrow.turn_id,
            existingThrow.id
          );
        }
        await enqueueLiveDartIQWithoutBreakingScoring(supabase, linked.matchId, existingThrow.id);
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
    const bullMatch = snapshot?.match;
    if (bullMatch?.bull_off?.phase === 'throwing' && isMatchScoringActive(bullMatch)) {
      if (bullMatch.bull_off.awaitingTakeout) {
        await updateEvent(supabase, event.id, 'ignored', 'One dart each: remove the dart before the next player');
        return { status: 'ignored', reason: 'Waiting for bull-off takeout' };
      }
      const distanceMm = event.payload.bounceout === true || detected.impactXmm === undefined || detected.impactYmm === undefined
        ? null : Math.hypot(detected.impactXmm, detected.impactYmm);
      await updateBullOff(supabase, matchId, bullMatch.bull_off, { playerId: bullMatch.bull_off.pending[0], distanceMm }, event.id);
      await updateEvent(supabase, event.id, 'processed', null);
      return { status: 'ignored', reason: 'Bull-off distance recorded separately from X01' };
    }
    if (!snapshot || !isMatchScoringActive(snapshot.match)) {
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
      await enqueueLiveDartIQWithoutBreakingScoring(supabase, matchId, duplicate.id);
      await updateEvent(supabase, event.id, 'processed', null);
      return { status: 'processed', target, throwId: duplicate.id };
    }

    const inserted = insertedThrow as ThrowRow;
    await finishThrowLifecycle(supabase, matchId, snapshot.leg.id, inserted.turn_id, inserted.id);
    await enqueueLiveDartIQWithoutBreakingScoring(supabase, matchId, inserted.id);
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
