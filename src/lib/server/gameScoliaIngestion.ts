import type { SupabaseClient } from '@supabase/supabase-js';

import type { ScoliaDetectedThrow } from '../scolia/protocol.ts';
import {
  appendGameThrow,
  finalizeGameSession,
  loadGameSnapshot,
  sortThrowRows,
  GAME_THROW_COLUMNS,
  type GameThrowRow,
} from './gameThrowLifecycle.ts';
import { hasTakeoutSinceEvent } from './scoliaCommands.ts';

export type GameScoliaIngestionOutcome =
  | { status: 'processed'; throwId: string }
  | { status: 'ignored'; reason: string };

export async function findExistingGameThrow(supabase: SupabaseClient, eventId: number): Promise<GameThrowRow | null> {
  const { data, error } = await supabase
    .from('game_throws')
    .select(GAME_THROW_COLUMNS)
    .eq('scolia_event_id', eventId)
    .maybeSingle();
  if (error && error.code !== '42P01') throw new Error(error.message);
  return (data as GameThrowRow | null) ?? null;
}

export async function settleExistingGameThrow(supabase: SupabaseClient, existing: GameThrowRow): Promise<void> {
  const snapshot = await loadGameSnapshot(supabase, existing.session_id);
  if (!snapshot) return;
  if (snapshot.session.status === 'active' && snapshot.state.finished && snapshot.state.winnerId) {
    await finalizeGameSession(supabase, {
      sessionId: snapshot.session.id,
      expectedLastThrowId: existing.id,
      winnerPlayerId: snapshot.state.winnerId,
    });
  }
}

export async function ingestGameThrow(
  supabase: SupabaseClient,
  sessionId: string,
  eventId: number,
  boardId: string,
  detected: ScoliaDetectedThrow
): Promise<GameScoliaIngestionOutcome> {
  const snapshot = await loadGameSnapshot(supabase, sessionId);
  if (!snapshot || snapshot.session.status !== 'active') {
    return { status: 'ignored', reason: 'The assigned game is no longer active' };
  }
  if (snapshot.state.finished || !snapshot.state.currentPlayerId) {
    return { status: 'ignored', reason: 'The assigned game is already finished' };
  }

  const ordered = sortThrowRows(snapshot.throws);
  const last = ordered[ordered.length - 1];
  if (last && last.scolia_event_id != null && snapshot.state.turnIndex > last.turn_index) {
    const takenOut = await hasTakeoutSinceEvent(supabase, boardId, last.scolia_event_id, eventId);
    if (takenOut === false) {
      return { status: 'ignored', reason: 'Dart detected before the previous round was taken out' };
    }
  }

  const result = await appendGameThrow(supabase, snapshot, {
    segment: detected.segment,
    scored: detected.scored,
    scoliaEventId: eventId,
    impactXmm: detected.impactXmm ?? null,
    impactYmm: detected.impactYmm ?? null,
    angleHorizontalDeg: detected.angleHorizontalDeg ?? null,
    angleVerticalDeg: detected.angleVerticalDeg ?? null,
  });
  if (result.ok) return { status: 'processed', throwId: result.throw.id };

  if (result.code === 'slot_taken') {
    const duplicate = await findExistingGameThrow(supabase, eventId);
    if (duplicate) {
      await settleExistingGameThrow(supabase, duplicate);
      return { status: 'processed', throwId: duplicate.id };
    }
    throw new Error('Another dart claimed this slot; the event will be retried');
  }
  return { status: 'ignored', reason: result.error };
}
