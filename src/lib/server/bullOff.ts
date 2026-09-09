import type { SupabaseClient } from '@supabase/supabase-js';
import { finishBullOffTakeout, recordBullOffShot, type BullOffState } from '../match/bullOff.ts';

export async function updateBullOff(supabase: SupabaseClient, matchId: string, state: BullOffState, action: { playerId: string; distanceMm: number | null } | 'takeout', eventId?: number) {
  if (eventId !== undefined) {
    const { data: existing, error } = await supabase.from('bull_off_events').select('match_id').eq('event_id', eventId).maybeSingle();
    if (error) throw new Error(error.message);
    if (existing) return state;
  }
  const next = action === 'takeout' ? finishBullOffTakeout(state) : recordBullOffShot(state, { ...action, ...(eventId === undefined ? {} : { eventId }) });
  if (next === state) return state;
  const { data, error } = await supabase.rpc('update_bull_off_atomic', {
    p_match_id: matchId, p_revision: state.revision, p_state: next, p_event_id: eventId ?? null,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Bull-off changed; refresh and try again');
  return next;
}
