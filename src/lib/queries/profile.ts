import { queryOptions } from '@tanstack/react-query';

import { getSupabaseClient } from '@/lib/supabaseClient';

export type ProfileSummary = {
  matches: number;
  wins: number;
  avgPerTurn: number | null;
  last10: number[];
  legsWon: number;
};

type ParticipationRow = {
  matches: MatchResult | MatchResult[] | null;
};
type MatchResult = { ended_early: boolean | null; winner_player_id: string | null };

/** A player's headline numbers for their profile. Small, so a revisit shows them at once. */
export const profileSummaryQuery = (playerId: string) => queryOptions({
  queryKey: ['profile', 'summary', playerId],
  queryFn: async (): Promise<ProfileSummary> => {
    const supabase = await getSupabaseClient();
    const [participations, summaryRow, form, legs] = await Promise.all([
      supabase.from('match_players').select('match_id, matches!inner(id, ended_early, winner_player_id)').eq('player_id', playerId),
      supabase.from('player_summary').select('wins, avg_per_turn').eq('player_id', playerId).maybeSingle(),
      supabase.from('player_recent_form').select('last_10_results').eq('player_id', playerId).maybeSingle(),
      supabase.from('legs').select('id', { count: 'exact', head: true }).eq('winner_player_id', playerId),
    ]);
    if (participations.error) throw new Error(participations.error.message);
    if (summaryRow.error) throw new Error(summaryRow.error.message);
    if (form.error) throw new Error(form.error.message);
    if (legs.error) throw new Error(legs.error.message);

    let matches = 0;
    let wins = 0;
    for (const row of (participations.data ?? []) as ParticipationRow[]) {
      const match = Array.isArray(row.matches) ? row.matches[0] : row.matches;
      if (!match || match.ended_early || !match.winner_player_id) continue;
      matches += 1;
      if (match.winner_player_id === playerId) wins += 1;
    }
    return {
      matches,
      wins: summaryRow.data ? Number(summaryRow.data.wins ?? wins) : wins,
      avgPerTurn: summaryRow.data?.avg_per_turn != null ? Number(summaryRow.data.avg_per_turn) : null,
      last10: (form.data?.last_10_results as number[] | undefined) ?? [],
      legsWon: legs.count ?? 0,
    };
  },
  enabled: Boolean(playerId),
  meta: { persist: true },
});
