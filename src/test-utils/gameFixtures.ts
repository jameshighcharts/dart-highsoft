/**
 * Fixtures for party-game server tests: a cricket session plus a scripted
 * throw log stamped the way the server would stamp it.
 */

import { cricketEngine } from '@/lib/games/engines/cricket';
import { scoreFromSegment } from '@/lib/games/segment';
import type { CricketConfig, GameThrowInput } from '@/lib/games/types';
import type { GameSessionRow } from '@/lib/server/gameGuards';
import type { GameSnapshot, GameThrowRow } from '@/lib/server/gameThrowLifecycle';

export const PLAYER_A = '00000000-0000-4000-8000-00000000000a';
export const PLAYER_B = '00000000-0000-4000-8000-00000000000b';
export const PLAYER_C = '00000000-0000-4000-8000-00000000000c';
export const SESSION_ID = '00000000-0000-4000-8000-0000000000e1';
export const BOARD_ID = '00000000-0000-4000-8000-0000000000b0';

export const CRICKET_CONFIG: CricketConfig = { variant: 'standard', maxRounds: 20 };

export type ScriptedDart = [playerId: string, segment: string];

export function cricketSession(overrides: Partial<GameSessionRow> = {}): GameSessionRow {
  return {
    id: SESSION_ID,
    mode: 'cricket',
    config: CRICKET_CONFIG as unknown as Record<string, unknown>,
    status: 'active',
    winner_player_id: null,
    scolia_board_id: null,
    created_at: '2026-09-01T10:00:00.000Z',
    completed_at: null,
    ...overrides,
  };
}

export function throwRow(input: GameThrowInput, sessionId = SESSION_ID, extra: Partial<GameThrowRow> = {}): GameThrowRow {
  return {
    id: input.id,
    session_id: sessionId,
    player_id: input.playerId,
    round_number: input.roundNumber,
    turn_index: input.turnIndex,
    dart_index: input.dartIndex,
    segment: input.segment,
    scored: input.scored,
    meta: {},
    scolia_event_id: null,
    impact_x_mm: null,
    impact_y_mm: null,
    angle_horizontal_deg: null,
    angle_vertical_deg: null,
    created_at: '2026-09-01T10:00:00.000Z',
    ...extra,
  };
}

/**
 * Replay a script through the cricket engine, stamping each dart with the
 * open turn's indices exactly like `appendGameThrow` does.
 */
export function scriptCricketRows(
  order: string[],
  darts: ScriptedDart[],
  sessionId = SESSION_ID,
  config: CricketConfig = CRICKET_CONFIG
): GameThrowRow[] {
  const log: GameThrowInput[] = [];
  for (const [playerId, segment] of darts) {
    const state = cricketEngine.deriveState(config, order, log);
    if (state.currentPlayerId !== playerId) {
      throw new Error(`Script expects ${playerId} to throw but engine says ${state.currentPlayerId}`);
    }
    log.push({
      id: `throw-${log.length + 1}`,
      playerId,
      roundNumber: state.round,
      turnIndex: state.turnIndex,
      dartIndex: state.dartsThrownInTurn + 1,
      segment,
      scored: scoreFromSegment(segment) ?? 0,
    });
  }
  return log.map((input) => throwRow(input, sessionId));
}

/** Two-player cricket where A closes everything; the final `SB` wins the game. */
export const CRICKET_WIN_SCRIPT: ScriptedDart[] = [
  [PLAYER_A, 'T20'], [PLAYER_A, 'T19'], [PLAYER_A, 'T18'],
  [PLAYER_B, 'Miss'], [PLAYER_B, 'Miss'], [PLAYER_B, 'Miss'],
  [PLAYER_A, 'T17'], [PLAYER_A, 'T16'], [PLAYER_A, 'T15'],
  [PLAYER_B, 'Miss'], [PLAYER_B, 'Miss'], [PLAYER_B, 'Miss'],
  [PLAYER_A, 'DB'], [PLAYER_A, 'SB'],
];

export function buildSnapshot(
  rows: GameThrowRow[],
  order: string[] = [PLAYER_A, PLAYER_B],
  session: GameSessionRow = cricketSession()
): GameSnapshot {
  const sorted = rows.slice().sort((a, b) => a.turn_index - b.turn_index || a.dart_index - b.dart_index);
  const inputs: GameThrowInput[] = sorted.map((row) => ({
    id: row.id,
    playerId: row.player_id,
    roundNumber: row.round_number,
    turnIndex: row.turn_index,
    dartIndex: row.dart_index,
    segment: row.segment,
    scored: row.scored,
  }));
  return {
    session,
    players: order.map((player_id, play_order) => ({ player_id, play_order, display_name: `Player ${play_order + 1}` })),
    orderedPlayerIds: order,
    throws: rows,
    engine: cricketEngine as never,
    state: cricketEngine.deriveState(session.config as unknown as CricketConfig, order, inputs),
  };
}

/** Rows shaped like the `game_session_players(..., players(display_name))` join. */
export function sessionPlayerRows(order: string[], sessionId = SESSION_ID) {
  return order.map((player_id, play_order) => ({
    session_id: sessionId,
    player_id,
    play_order,
    players: { display_name: `Player ${play_order + 1}` },
  }));
}
