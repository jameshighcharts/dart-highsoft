import type { SupabaseClient } from '@supabase/supabase-js';

import { getEngine } from '../games/registry.ts';
import { parseSegment } from '../games/segment.ts';
import type { GameEngine, GameEvent, GameState, GameThrowInput } from '../games/types.ts';
import { GAME_SESSION_COLUMNS, isGameSessionActive, type GameSessionRow } from './gameGuards.ts';

export type GameThrowRow = {
  id: string;
  session_id: string;
  player_id: string;
  round_number: number;
  turn_index: number;
  dart_index: number;
  segment: string;
  scored: number;
  meta: Record<string, unknown>;
  scolia_event_id: number | null;
  impact_x_mm: number | null;
  impact_y_mm: number | null;
  angle_horizontal_deg: number | null;
  angle_vertical_deg: number | null;
  created_at: string;
};

export const GAME_THROW_COLUMNS =
  'id, session_id, player_id, round_number, turn_index, dart_index, segment, scored, meta, scolia_event_id, impact_x_mm, impact_y_mm, angle_horizontal_deg, angle_vertical_deg, created_at';

export type GameSessionPlayer = {
  player_id: string;
  play_order: number;
  display_name: string;
};

export type GameSnapshot = {
  session: GameSessionRow;
  players: GameSessionPlayer[];
  orderedPlayerIds: string[];
  throws: GameThrowRow[];
  engine: GameEngine<unknown, unknown, GameEvent>;
  state: GameState;
};

export function sortThrowRows<T extends { turn_index: number; dart_index: number }>(rows: T[]): T[] {
  return rows.slice().sort((a, b) => a.turn_index - b.turn_index || a.dart_index - b.dart_index);
}

export function throwInputFromRow(row: GameThrowRow): GameThrowInput {
  return {
    id: row.id,
    playerId: row.player_id,
    roundNumber: row.round_number,
    turnIndex: row.turn_index,
    dartIndex: row.dart_index,
    segment: row.segment,
    scored: row.scored,
  };
}

function deriveFromRows(
  engine: GameEngine<unknown, unknown, GameEvent>,
  session: GameSessionRow,
  orderedPlayerIds: string[],
  rows: GameThrowRow[]
): GameState {
  return engine.deriveState(session.config, orderedPlayerIds, sortThrowRows(rows).map(throwInputFromRow));
}

type PlayerJoinRow = {
  player_id: string;
  play_order: number;
  players: { display_name: string } | { display_name: string }[] | null;
};

export async function loadGameSnapshot(supabase: SupabaseClient, sessionId: string): Promise<GameSnapshot | null> {
  const [sessionResult, playersResult, throwsResult] = await Promise.all([
    supabase.from('game_sessions').select(GAME_SESSION_COLUMNS).eq('id', sessionId).maybeSingle(),
    supabase
      .from('game_session_players')
      .select('player_id, play_order, players(display_name)')
      .eq('session_id', sessionId)
      .order('play_order'),
    supabase
      .from('game_throws')
      .select(GAME_THROW_COLUMNS)
      .eq('session_id', sessionId)
      .order('turn_index')
      .order('dart_index'),
  ]);
  if (sessionResult.error) throw new Error(sessionResult.error.message);
  if (!sessionResult.data) return null;
  if (playersResult.error) throw new Error(playersResult.error.message);
  if (throwsResult.error) throw new Error(throwsResult.error.message);

  const session = sessionResult.data as GameSessionRow;
  const players = ((playersResult.data ?? []) as unknown as PlayerJoinRow[]).map((row) => {
    const player = Array.isArray(row.players) ? row.players[0] : row.players;
    return { player_id: row.player_id, play_order: row.play_order, display_name: player?.display_name ?? 'Unknown' };
  });
  const orderedPlayerIds = players.map((player) => player.player_id);
  const throws = (throwsResult.data ?? []) as GameThrowRow[];
  const engine = getEngine(session.mode);
  return {
    session,
    players,
    orderedPlayerIds,
    throws,
    engine,
    state: deriveFromRows(engine, session, orderedPlayerIds, throws),
  };
}

export type AppendGameThrowInput = {
  segment: string;
  scored?: number;
  /** Stale-client guard: reject when this is not the current player. */
  playerId?: string;
  scoliaEventId?: number;
  impactXmm?: number | null;
  impactYmm?: number | null;
  angleHorizontalDeg?: number | null;
  angleVerticalDeg?: number | null;
};

export type AppendGameThrowResult =
  | { ok: true; throw: GameThrowRow; state: GameState }
  | { ok: false; status: 400 | 409; error: string; code?: 'slot_taken' | 'not_active' | 'finished' | 'wrong_player' | 'invalid_segment' };

/**
 * Stamp the next slot from the derived state, insert the dart, and finalize
 * the session when the engine says the game is over.
 */
export async function appendGameThrow(
  supabase: SupabaseClient,
  snapshot: GameSnapshot,
  input: AppendGameThrowInput
): Promise<AppendGameThrowResult> {
  const { session, state, engine, orderedPlayerIds, throws } = snapshot;
  if (!isGameSessionActive(session)) return { ok: false, status: 409, error: 'Game is not active', code: 'not_active' };
  if (state.finished || !state.currentPlayerId) {
    return { ok: false, status: 409, error: 'Game is already finished', code: 'finished' };
  }
  const parsed = parseSegment(input.segment);
  if (!parsed) return { ok: false, status: 400, error: 'Invalid segment', code: 'invalid_segment' };
  if (typeof input.scored === 'number' && input.scored !== parsed.scored) {
    return { ok: false, status: 400, error: 'scored does not match segment', code: 'invalid_segment' };
  }
  if (input.playerId && input.playerId !== state.currentPlayerId) {
    return { ok: false, status: 409, error: "It is not this player's turn", code: 'wrong_player' };
  }

  const candidate: GameThrowInput = {
    id: 'pending',
    playerId: state.currentPlayerId,
    roundNumber: state.round,
    turnIndex: state.turnIndex,
    dartIndex: state.dartsThrownInTurn + 1,
    segment: input.segment,
    scored: parsed.scored,
  };
  const nextState = engine.deriveState(
    session.config,
    orderedPlayerIds,
    [...sortThrowRows(throws).map(throwInputFromRow), candidate]
  );

  const { data, error } = await supabase
    .from('game_throws')
    .insert({
      session_id: session.id,
      player_id: candidate.playerId,
      round_number: candidate.roundNumber,
      turn_index: candidate.turnIndex,
      dart_index: candidate.dartIndex,
      segment: candidate.segment,
      scored: candidate.scored,
      meta: nextState.lastEvent ?? {},
      scolia_event_id: input.scoliaEventId ?? null,
      impact_x_mm: input.impactXmm ?? null,
      impact_y_mm: input.impactYmm ?? null,
      angle_horizontal_deg: input.angleHorizontalDeg ?? null,
      angle_vertical_deg: input.angleVerticalDeg ?? null,
    })
    .select(GAME_THROW_COLUMNS)
    .single();
  if (error || !data) {
    if (error?.code === '23505') {
      return { ok: false, status: 409, error: 'Another dart was recorded first. Reload and try again.', code: 'slot_taken' };
    }
    throw new Error(error?.message ?? 'Failed to record dart');
  }

  if (nextState.finished) {
    await finalizeGameSession(supabase, session.id, nextState);
  }
  return { ok: true, throw: data as GameThrowRow, state: nextState };
}

export type RemoveLastGameThrowResult =
  | { ok: true; deleted: GameThrowRow; state: GameState; reopened: boolean }
  | { ok: false; status: 404 | 409; error: string };

/**
 * Undo the most recent dart. Undoing the winning dart of a completed session
 * reopens it; sessions ended early stay closed.
 */
export async function removeLastGameThrow(
  supabase: SupabaseClient,
  snapshot: GameSnapshot,
  throwId?: string
): Promise<RemoveLastGameThrowResult> {
  const { session, engine, orderedPlayerIds } = snapshot;
  if (session.status === 'ended_early') return { ok: false, status: 409, error: 'Game was ended early' };
  const ordered = sortThrowRows(snapshot.throws);
  const last = ordered[ordered.length - 1];
  if (!last) return { ok: false, status: 404, error: 'No darts to undo' };
  if (throwId && throwId !== last.id) return { ok: false, status: 409, error: 'Only the latest dart can be undone' };

  const { error, count } = await supabase.from('game_throws').delete({ count: 'exact' }).eq('id', last.id);
  if (error) throw new Error(error.message);
  if (count === 0) return { ok: false, status: 404, error: 'Dart was already removed' };

  const remaining = ordered.slice(0, -1);
  const state = deriveFromRows(engine, session, orderedPlayerIds, remaining);
  let reopened = false;
  if (session.status === 'completed' && !state.finished) {
    reopened = await reopenGameSession(supabase, session.id);
  }
  return { ok: true, deleted: last, state, reopened };
}

/** Idempotent: only an active session can be completed. */
export async function finalizeGameSession(supabase: SupabaseClient, sessionId: string, state: GameState): Promise<void> {
  const { error } = await supabase
    .from('game_sessions')
    .update({
      status: 'completed',
      winner_player_id: state.winnerId,
      completed_at: new Date().toISOString(),
    })
    .eq('id', sessionId)
    .eq('status', 'active');
  if (error) throw new Error(error.message);
}

export async function reopenGameSession(supabase: SupabaseClient, sessionId: string): Promise<boolean> {
  const { error, count } = await supabase
    .from('game_sessions')
    .update({ status: 'active', winner_player_id: null, completed_at: null }, { count: 'exact' })
    .eq('id', sessionId)
    .eq('status', 'completed');
  if (error) throw new Error(error.message);
  return (count ?? 0) > 0;
}
