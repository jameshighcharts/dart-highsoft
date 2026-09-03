import type { SupabaseClient } from '@supabase/supabase-js';

import { getEngine } from '../games/registry.ts';
import { isGameMode, isGameSessionStatus, type GameMode } from '../games/types.ts';
import type { GameSessionRow } from './gameGuards.ts';
import { assertScoliaBoardAvailable } from './scoliaBoardTarget.ts';

export type CreateGameSessionInput = {
  mode: GameMode;
  /** Raw config from the client; parsed and finalized here. */
  config: unknown;
  /** Player ids in the desired seating order (already shuffled by the caller). */
  orderedPlayerIds: string[];
  scoliaBoardId: string | null;
  random?: () => number;
};

export type CreateGameSessionResult =
  | { ok: true; session: GameSessionRow }
  | { ok: false; status: 400 | 404 | 409; error: string };

export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function gameSessionFromRpc(value: unknown): GameSessionRow {
  if (!value || typeof value !== 'object') throw new Error('Game creation returned no session');
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== 'string'
    || !isGameMode(row.mode)
    || !row.config
    || typeof row.config !== 'object'
    || Array.isArray(row.config)
    || !isGameSessionStatus(row.status)
    || typeof row.created_at !== 'string'
  ) {
    throw new Error('Game creation returned an invalid session');
  }
  return {
    id: row.id,
    mode: row.mode,
    config: row.config as Record<string, unknown>,
    status: row.status,
    winner_player_id: typeof row.winner_player_id === 'string' ? row.winner_player_id : null,
    scolia_board_id: typeof row.scolia_board_id === 'string' ? row.scolia_board_id : null,
    created_at: row.created_at,
    completed_at: typeof row.completed_at === 'string' ? row.completed_at : null,
  };
}

export async function createGameSession(
  supabase: SupabaseClient,
  input: CreateGameSessionInput
): Promise<CreateGameSessionResult> {
  const engine = getEngine(input.mode);
  const parsed = engine.parseConfig(input.config);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };

  const playerIds = input.orderedPlayerIds;
  if (new Set(playerIds).size !== playerIds.length) {
    return { ok: false, status: 400, error: 'Players must be unique' };
  }
  if (playerIds.length < engine.minPlayers) {
    return { ok: false, status: 400, error: `This game needs at least ${engine.minPlayers} player${engine.minPlayers === 1 ? '' : 's'}` };
  }
  if (playerIds.length > engine.maxPlayers) {
    return { ok: false, status: 400, error: `This game allows at most ${engine.maxPlayers} players` };
  }

  const { data: existingPlayers, error: playersError } = await supabase
    .from('players')
    .select('id')
    .in('id', playerIds);
  if (playersError) throw new Error(playersError.message);
  if ((existingPlayers ?? []).length !== playerIds.length) {
    return { ok: false, status: 404, error: 'One or more players were not found' };
  }

  if (input.scoliaBoardId) {
    const availability = await assertScoliaBoardAvailable(supabase, input.scoliaBoardId);
    if (!availability.ok) return availability;
  }

  const config = engine.finalizeConfig(parsed.config, playerIds, input.random ?? Math.random);

  const { data: session, error: sessionError } = await supabase
    .rpc('create_game_session_atomic', {
      p_mode: input.mode,
      p_config: config,
      p_player_ids: playerIds,
      p_scolia_board_id: input.scoliaBoardId,
    })
    .single();
  if (sessionError || !session) {
    if (sessionError?.code === '23505' && input.scoliaBoardId) {
      return { ok: false, status: 409, error: 'This Scolia board is already assigned to an active match or game' };
    }
    if (sessionError?.code === '23503' || sessionError?.code === 'P0002') {
      return { ok: false, status: 404, error: 'One or more players were not found' };
    }
    throw new Error(sessionError?.message ?? 'Failed to create game');
  }

  return { ok: true, session: gameSessionFromRpc(session) };
}
