import type { SupabaseClient } from '@supabase/supabase-js';

import type { MatchRow } from './matchGuards';

export type ScoliaThrowCommandType = 'DELETE_THROW' | 'THROW_CORRECTED';

type ThrowCommandTarget = {
  dartIndex: number;
  scoliaEventId: number | null;
};

/**
 * Queue a correction only when the throw came from Scolia and is still part
 * of the SBC's current physical round (no TAKEOUT_FINISHED has followed it).
 */
export async function enqueueCurrentRoundScoliaThrowCommand(
  supabase: SupabaseClient,
  match: MatchRow,
  target: ThrowCommandTarget,
  commandType: ScoliaThrowCommandType
): Promise<void> {
  if (!match.scolia_board_id || target.scoliaEventId == null) return;

  const { data: sourceEvent, error: sourceError } = await supabase
    .from('scolia_events')
    .select('board_id, received_at')
    .eq('id', target.scoliaEventId)
    .eq('board_id', match.scolia_board_id)
    .maybeSingle();
  if (sourceError) throw new Error(sourceError.message);
  if (!sourceEvent) return;

  const { data: laterTakeout, error: takeoutError } = await supabase
    .from('scolia_events')
    .select('id')
    .eq('board_id', match.scolia_board_id)
    .eq('event_type', 'TAKEOUT_FINISHED')
    .gt('received_at', sourceEvent.received_at)
    .order('received_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (takeoutError) throw new Error(takeoutError.message);
  if (laterTakeout) return;

  const { error: insertError } = await supabase.from('scolia_commands').insert({
    board_id: match.scolia_board_id,
    match_id: match.id,
    command_type: commandType,
    payload: { throwIndex: target.dartIndex - 1 },
  });
  if (insertError) throw new Error(insertError.message);
}
