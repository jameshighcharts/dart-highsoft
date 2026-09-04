'use client';

import { useQuery } from '@tanstack/react-query';

import { getSupabaseClient } from '@/lib/supabaseClient';

export const PLAYER_AVATARS_QUERY_KEY = ['player-avatars'] as const;

async function fetchPlayerAvatars(): Promise<Record<string, string | null>> {
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.from('players').select('id, avatar_url');
  if (error) throw new Error(error.message);
  const map: Record<string, string | null> = {};
  for (const row of data ?? []) map[row.id as string] = (row.avatar_url as string | null) ?? null;
  return map;
}

/**
 * id -> avatar_url for every player, fetched once and shared. Lets rows that
 * come from SQL views (which only expose player_id + display_name) show the
 * same avatar as everywhere else without touching the views.
 */
export function usePlayerAvatars() {
  return useQuery({
    queryKey: PLAYER_AVATARS_QUERY_KEY,
    queryFn: fetchPlayerAvatars,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function usePlayerAvatarUrl(playerId: string | null | undefined): string | null {
  const { data } = usePlayerAvatars();
  if (!playerId || !data) return null;
  return data[playerId] ?? null;
}
