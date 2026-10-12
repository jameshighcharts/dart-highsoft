import { queryOptions } from '@tanstack/react-query';

import { apiRequest } from '@/lib/apiClient';
import type { Snapshot } from '@/lib/highdarts/standings';
import type { ScoliaBoardOption } from '@/lib/scolia/types';
import { getSupabaseClient } from '@/lib/supabaseClient';

export type NewMatchPlayer = {
  id: string;
  display_name: string;
  location: string | null;
  avatar_url?: string | null;
  gamesPlayed?: number;
};

/** Active players with how many games each has played, for ordering the picker. */
export const newMatchPlayersQuery = () => queryOptions({
  queryKey: ['players', 'active-with-games'],
  queryFn: async (): Promise<NewMatchPlayer[]> => {
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase
      .from('players')
      .select('id, display_name, location, avatar_url, match_players(count), game_session_players(count)')
      .eq('is_active', true)
      .order('display_name');
    if (error) throw error;
    return (data ?? []).map((player) => ({
      id: player.id,
      display_name: player.display_name,
      location: player.location,
      avatar_url: player.avatar_url,
      gamesPlayed: (player.match_players[0]?.count ?? 0) + (player.game_session_players[0]?.count ?? 0),
    }));
  },
  meta: { persist: true },
});

export type AvailableBoards = { boards: ScoliaBoardOption[]; simulated?: boolean };

export function fetchAvailableBoards(): Promise<AvailableBoards> {
  return apiRequest<AvailableBoards>('/api/scolia/boards/available', { method: 'GET' });
}

/**
 * Board availability decides whether a match can start on a board and whether the manual-scoring
 * warnings show, so it is never shown from an earlier visit: it is not persisted and is dropped as
 * soon as no page reads it. A hover prefetch still counts if it is in flight when the page mounts.
 * Failures show at once rather than after retries.
 */
export const availableBoardsQuery = () => queryOptions({
  queryKey: ['new-match', 'available-boards'],
  queryFn: fetchAvailableBoards,
  staleTime: 0,
  gcTime: 0,
  retry: false,
  meta: { persist: false },
});

/**
 * Highdarts fixtures lock the match format and decide whether a fixture may start, so like the
 * boards they are never shown from an earlier visit.
 */
export const highdartsSnapshotQuery = () => queryOptions({
  queryKey: ['new-match', 'highdarts'],
  queryFn: () => apiRequest<Snapshot>('/api/highdarts', { method: 'GET' }),
  staleTime: 0,
  gcTime: 0,
  retry: false,
  meta: { persist: false },
});
