import { queryOptions } from '@tanstack/react-query';

import { getSupabaseClient } from '@/lib/supabaseClient';

export type PracticePlayer = { id: string; display_name: string; avatar_url: string | null };

/** The active players to practice as, for /practice. */
export const practicePlayersQuery = () => queryOptions({
  queryKey: ['players', 'practice'],
  queryFn: async (): Promise<PracticePlayer[]> => {
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase
      .from('players')
      .select('id, display_name, avatar_url')
      .eq('is_active', true)
      .order('display_name', { ascending: true });
    if (error) throw error;
    return data ?? [];
  },
  meta: { persist: true },
});

/** One player, for /practice/<id>; null when there is no such player. */
export const practicePlayerQuery = (playerId: string) => queryOptions({
  queryKey: ['players', 'practice', playerId],
  queryFn: async (): Promise<PracticePlayer | null> => {
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase
      .from('players')
      .select('id, display_name, avatar_url')
      .eq('id', playerId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },
});
