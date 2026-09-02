import type { SupabaseClient } from '@supabase/supabase-js';

import { getEngine } from '../games/registry.ts';
import type { GameMode } from '../games/types.ts';
import { GAME_SESSION_COLUMNS, type GameSessionRow } from './gameGuards.ts';
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
    .from('game_sessions')
    .insert({ mode: input.mode, config, scolia_board_id: input.scoliaBoardId })
    .select(GAME_SESSION_COLUMNS)
    .single();
  if (sessionError || !session) {
    if (sessionError?.code === '23505' && input.scoliaBoardId) {
      return { ok: false, status: 409, error: 'This Scolia board is already assigned to an active match or game' };
    }
    throw new Error(sessionError?.message ?? 'Failed to create game');
  }

  const { error: gspError } = await supabase.from('game_session_players').insert(
    playerIds.map((playerId, index) => ({ session_id: session.id, player_id: playerId, play_order: index }))
  );
  if (gspError) {
    await supabase.from('game_sessions').delete().eq('id', session.id);
    throw new Error(gspError.message);
  }

  return { ok: true, session: session as GameSessionRow };
}
