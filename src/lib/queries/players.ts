import { queryOptions } from '@tanstack/react-query';

import { getSupabaseClient } from '@/lib/supabaseClient';

export type PlayerListItem = { id: string; display_name: string; location: string | null; avatar_url?: string | null };

export const playerListQuery = () => queryOptions({
  queryKey: ['players', 'list'],
  queryFn: async (): Promise<PlayerListItem[]> => {
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase.from('players').select('*').eq('is_test', false).order('display_name');
    if (error) throw error;
    return data ?? [];
  },
  meta: { persist: true },
});
