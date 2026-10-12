import type { SupabaseClient } from '@supabase/supabase-js';

import type { ScoliaDetectedThrow } from '../scolia/protocol.ts';
import {
  appendGameThrow,
  buildGameSnapshot,
  finalizeGameSession,
  loadGameSnapshot,
  sortThrowRows,
  GAME_THROW_COLUMNS,
  type GameSessionPlayer,
  type GameSnapshot,
  type GameThrowRow,
} from './gameThrowLifecycle.ts';
import type { GameSessionRow } from './gameGuards.ts';
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

/** Game state the database prepared alongside persisting the Scolia event. */
export type PreparedScoliaGame = {
  kind: 'game';
  sessionId: string;
  snapshot: { session: GameSessionRow | null; players: GameSessionPlayer[]; throws: GameThrowRow[] };
  /** null when the previous dart has no Scolia event on this board (same as hasTakeoutSinceEvent). */
  takeoutSinceLastThrow: boolean | null;
};

/** Why a Scolia dart cannot be appended to this game, or null when it can. */
async function gameRejection(
  snapshot: GameSnapshot | null,
  takenOut: (lastScoliaEventId: number) => Promise<boolean | null>
): Promise<string | null> {
  if (!snapshot || snapshot.session.status !== 'active') return 'The assigned game is no longer active';
  if (snapshot.state.finished || !snapshot.state.currentPlayerId) return 'The assigned game is already finished';
  const ordered = sortThrowRows(snapshot.throws);
  const last = ordered[ordered.length - 1];
  if (last && last.scolia_event_id != null && snapshot.state.turnIndex > last.turn_index) {
    if (await takenOut(last.scolia_event_id) === false) return 'Dart detected before the previous round was taken out';
  }
  return null;
}

function appendInput(eventId: number, detected: ScoliaDetectedThrow) {
  return {
    segment: detected.segment,
    scored: detected.scored,
    scoliaEventId: eventId,
    impactXmm: detected.impactXmm ?? null,
    impactYmm: detected.impactYmm ?? null,
    angleHorizontalDeg: detected.angleHorizontalDeg ?? null,
    angleVerticalDeg: detected.angleVerticalDeg ?? null,
  };
}

/**
 * Fast path: the snapshot and takeout check arrived with the persisted event, and the
 * append marks the event processed in the same transaction. Returns null when another
 * dart took the slot, so the caller falls back to the re-reading path; an ignored
 * outcome still needs the event marked by the caller.
 */
export async function ingestPreparedGameThrow(
  supabase: SupabaseClient,
  eventId: number,
  prepared: PreparedScoliaGame,
  detected: ScoliaDetectedThrow
): Promise<GameScoliaIngestionOutcome | null> {
  const { session, players, throws } = prepared.snapshot;
  const snapshot = session ? buildGameSnapshot(session, players, throws) : null;
  const rejection = await gameRejection(snapshot, async () => prepared.takeoutSinceLastThrow);
  if (rejection) return { status: 'ignored', reason: rejection };
  const result = await appendGameThrow(supabase, snapshot!, { ...appendInput(eventId, detected), settleScoliaEvent: true });
  if (result.ok) return { status: 'processed', throwId: result.throw.id };
  if (result.code === 'slot_taken') return null;
  return { status: 'ignored', reason: result.error };
}

export async function ingestGameThrow(
  supabase: SupabaseClient,
  sessionId: string,
  eventId: number,
  boardId: string,
  detected: ScoliaDetectedThrow
): Promise<GameScoliaIngestionOutcome> {
  const snapshot = await loadGameSnapshot(supabase, sessionId);
  const rejection = await gameRejection(snapshot, (lastScoliaEventId) =>
    hasTakeoutSinceEvent(supabase, boardId, lastScoliaEventId, eventId));
  if (rejection) return { status: 'ignored', reason: rejection };

  const result = await appendGameThrow(supabase, snapshot!, appendInput(eventId, detected));
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
