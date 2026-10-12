import { queryOptions } from '@tanstack/react-query';

import type { BullerEntry } from '@/components/leaderboard/BullersLeaderboard';
import type { GameModeLeaderboardEntry } from '@/components/leaderboard';
import { leaderboardListsQuery } from '@/hooks/useLeaderboardData';
import { GAME_MODE_ORDER } from '@/lib/games/labels';
import type { GameMode } from '@/lib/games/types';
import { getSupabaseClient } from '@/lib/supabaseClient';

const GAME_MODE_VIEWS: Record<GameMode, string> = {
  cricket: 'cricket_leaderboard',
  killer: 'killer_leaderboard',
  shanghai: 'shanghai_leaderboard',
  around_the_clock: 'around_the_clock_leaderboard',
};

export type TopRoundScore = {
  id: string;
  player_id: string;
  display_name: string;
  total_scored: number;
  created_at: string;
  leg_id: string;
  match_id: string;
};

export type HighestCheckout = { player_id: string; display_name: string; score: number; date: string; darts_used: number };
export type QuickestLeg = { player_id: string; display_name: string; dart_count: number; date: string; start_score: string };

type Relation<T> = T | T[] | null;

type TopRoundScorePayload = {
  id: string;
  player_id: string;
  total_scored: number;
  created_at: string;
  leg_id: string;
  legs: Relation<{ id: string; match_id: string; matches: { id: string; ended_early: boolean } }>;
  players: Relation<{ id: string; display_name: string }>;
};

function mapTopRoundScore(row: TopRoundScorePayload): TopRoundScore | null {
  const playerRelation = Array.isArray(row.players) ? row.players[0] : row.players;
  const legRelation = Array.isArray(row.legs) ? row.legs[0] : row.legs;
  if (!playerRelation || !legRelation) return null;
  return {
    id: row.id,
    player_id: row.player_id,
    display_name: playerRelation.display_name,
    total_scored: row.total_scored,
    created_at: row.created_at,
    leg_id: row.leg_id,
    match_id: legRelation.match_id,
  };
}

// Small, bounded top-10 lists: restored from storage so a revisit or reload shows them at once.
export const bullersQuery = () => queryOptions({
  queryKey: ['leaderboards', 'bullers'],
  meta: { persist: true },
  queryFn: async (): Promise<BullerEntry[]> => {
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase.from('bull_off_leaderboard')
      .select('player_id, display_name, measured_darts, misses, bull_offs, average_inches')
      .order('average_inches', { ascending: true })
      .order('measured_darts', { ascending: false })
      .order('display_name', { ascending: true })
      .order('player_id', { ascending: true })
      .limit(10);
    if (error) throw error;
    return (data ?? []) as BullerEntry[];
  },
});

export const topRoundScoresQuery = () => queryOptions({
  queryKey: ['leaderboards', 'topRoundScores'],
  meta: { persist: true },
  queryFn: async (): Promise<TopRoundScore[]> => {
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase
      .from('turns')
      .select(`
        id,
        player_id,
        total_scored,
        created_at,
        leg_id,
        legs!inner (
          id,
          match_id,
          matches!inner (
            id,
            ended_early
          )
        ),
        players!inner (
          id,
          display_name
        )
      `)
      .eq('busted', false)
      .eq('legs.matches.ended_early', false)
      .not('players.display_name', 'ilike', '%test%')
      .order('total_scored', { ascending: false })
      .limit(10);
    if (error) throw error;
    return ((data ?? []) as unknown as TopRoundScorePayload[])
      .map(mapTopRoundScore)
      .filter((row): row is TopRoundScore => row !== null);
  },
});

export const highestCheckoutsQuery = () => queryOptions({
  queryKey: ['leaderboards', 'highestCheckouts'],
  meta: { persist: true },
  queryFn: async (): Promise<HighestCheckout[]> => {
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase
      .from('checkout_leaderboard')
      .select('*')
      .order('score', { ascending: false })
      .limit(10);
    if (error) throw error;
    return (data ?? []) as HighestCheckout[];
  },
});

export const quickestLegsQuery = () => queryOptions({
  queryKey: ['leaderboards', 'quickestLegs'],
  meta: { persist: true },
  queryFn: async (): Promise<{ double: QuickestLeg[]; single: QuickestLeg[] }> => {
    const supabase = await getSupabaseClient();
    const quickest = (finishRule: 'double_out' | 'single_out') => supabase
      .from('quickest_legs_leaderboard')
      .select('*')
      .eq('finish_rule', finishRule)
      .order('dart_count', { ascending: true })
      .limit(10);
    const [double, single] = await Promise.all([quickest('double_out'), quickest('single_out')]);
    if (double.error) throw double.error;
    if (single.error) throw single.error;
    return { double: (double.data ?? []) as QuickestLeg[], single: (single.data ?? []) as QuickestLeg[] };
  },
});

export const gameModeLeadersQuery = () => queryOptions({
  queryKey: ['leaderboards', 'gameModes'],
  meta: { persist: true },
  queryFn: async (): Promise<Record<GameMode, GameModeLeaderboardEntry[]>> => {
    const supabase = await getSupabaseClient();
    const results = await Promise.all(
      GAME_MODE_ORDER.map((mode) =>
        supabase
          .from(GAME_MODE_VIEWS[mode])
          .select('*')
          .order('wins', { ascending: false })
          .order('win_rate', { ascending: false })
          .limit(10)
      )
    );
    const leaders = { cricket: [], killer: [], shanghai: [], around_the_clock: [] } as Record<GameMode, GameModeLeaderboardEntry[]>;
    GAME_MODE_ORDER.forEach((mode, index) => {
      const { data, error } = results[index];
      if (error) throw error;
      leaders[mode] = (data as GameModeLeaderboardEntry[] | null) ?? [];
    });
    return leaders;
  },
});

/** Everything the /leaderboards page reads on arrival. */
export const leaderboardsPageQueries = () => [
  leaderboardListsQuery(10),
  bullersQuery(),
  topRoundScoresQuery(),
  highestCheckoutsQuery(),
  quickestLegsQuery(),
  gameModeLeadersQuery(),
];
