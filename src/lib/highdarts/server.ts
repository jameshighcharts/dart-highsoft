import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Snapshot } from './standings';

export async function loadHighdarts(
  supabase: SupabaseClient,
): Promise<Snapshot> {
  const { data, error } = await supabase.rpc('highdarts_snapshot');
  if (error) throw new Error(error.message);
  if (!data || !Array.isArray(data.fixtures) || !Array.isArray(data.players))
    throw new Error('Invalid Highdarts snapshot');
  return data;
}
export function highdartsErrorStatus(code: string) {
  if (code === '23505' || code === '55000') return 409;
  if (
    code === '22023' ||
    code === '22P02' ||
    code === '23514' ||
    code === '23503'
  )
    return 400;
  if (code === 'P0002') return 404;
  return 500;
}
export function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
