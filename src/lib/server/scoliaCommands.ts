import type { SupabaseClient } from '@supabase/supabase-js';

import type { MatchRow } from './matchGuards.ts';
import type { GameSessionRow } from './gameGuards.ts';

export type ScoliaThrowCommandType = 'DELETE_THROW' | 'THROW_CORRECTED';

type ThrowCommandTarget = {
  dartIndex: number;
  scoliaEventId: number | null;
};

/** What the command is about: the board plus the match or game that owns the dart. */
export type ScoliaCommandSource = {
  boardId: string | null;
  matchId?: string | null;
  gameSessionId?: string | null;
};

export function commandSourceForMatch(match: MatchRow): ScoliaCommandSource {
  return { boardId: match.scolia_board_id ?? null, matchId: match.id };
}

export function commandSourceForGameSession(session: GameSessionRow): ScoliaCommandSource {
  return { boardId: session.scolia_board_id, gameSessionId: session.id };
}

/** True when the board finished a takeout after the given event, i.e. the round is over. */
export async function hasTakeoutSinceEvent(
  supabase: SupabaseClient,
  boardId: string,
  eventId: number,
  beforeEventId?: number
): Promise<boolean | null> {
  const { data: sourceEvent, error: sourceError } = await supabase
    .from('scolia_events')
    .select('board_id')
    .eq('id', eventId)
    .eq('board_id', boardId)
    .maybeSingle();
  if (sourceError) throw new Error(sourceError.message);
  if (!sourceEvent) return null;

  let takeoutQuery = supabase
    .from('scolia_events')
    .select('id')
    .eq('board_id', boardId)
    .eq('event_type', 'TAKEOUT_FINISHED')
    .gt('id', eventId);
  if (beforeEventId !== undefined) {
    takeoutQuery = takeoutQuery.lt('id', beforeEventId);
  }
  const { data: laterTakeout, error: takeoutError } = await takeoutQuery
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (takeoutError) throw new Error(takeoutError.message);
  return Boolean(laterTakeout);
}

/**
 * Queue a correction only when the throw came from Scolia and is still part
 * of the SBC's current physical round (no TAKEOUT_FINISHED has followed it).
 */
export async function enqueueCurrentRoundScoliaThrowCommand(
  supabase: SupabaseClient,
  source: ScoliaCommandSource,
  target: ThrowCommandTarget,
  commandType: ScoliaThrowCommandType
): Promise<void> {
  if (!source.boardId || target.scoliaEventId == null) return;

  const takenOut = await hasTakeoutSinceEvent(supabase, source.boardId, target.scoliaEventId);
  if (takenOut === null || takenOut) return;

  const { error: insertError } = await supabase.from('scolia_commands').insert({
    board_id: source.boardId,
    match_id: source.matchId ?? null,
    game_session_id: source.gameSessionId ?? null,
    command_type: commandType,
    payload: { throwIndex: target.dartIndex - 1 },
  });
  if (insertError) throw new Error(insertError.message);
}
