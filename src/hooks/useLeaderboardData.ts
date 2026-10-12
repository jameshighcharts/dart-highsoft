"use client";

import { useQuery } from '@tanstack/react-query';

import { leaderboardQuery, type MatchActivity, type PlayerGameStats } from '@/lib/queries/leaderboardData';

const emptyRecentWinsByPlayer = new Map<string, number[]>();
const emptyPlayerGameStats = new Map<string, PlayerGameStats>();
const emptyPlayerLocations = new Map<string, string | null>();
const emptyPlayerAvatarUrls = new Map<string, string | null>();
const emptyMatchActivity: MatchActivity = {
  sevenDayCounts: [0, 0, 0, 0, 0, 0, 0],
  sevenDayTotal: 0,
  sevenDayDelta: 0,
  thirtyDayCounts: Array.from({ length: 30 }, () => 0),
  thirtyDayTotal: 0,
  thirtyDayDelta: 0,
};

export function useLeaderboardData(limit?: number) {
  const { data, isLoading } = useQuery(leaderboardQuery(limit));

  return {
    leaders: data?.leaders ?? [],
    avgLeaders: data?.avgLeaders ?? [],
    eloLeaders: data?.eloLeaders ?? [],
    eloMultiLeaders: data?.eloMultiLeaders ?? [],
    recentWinsByPlayer: data?.recentWinsByPlayer ?? emptyRecentWinsByPlayer,
    playerGameStats: data?.playerGameStats ?? emptyPlayerGameStats,
    playerLocations: data?.playerLocations ?? emptyPlayerLocations,
    playerAvatarUrls: data?.playerAvatarUrls ?? emptyPlayerAvatarUrls,
    activePlayerCount: data?.activePlayerCount ?? 0,
    newPlayersThisWeek: data?.newPlayersThisWeek ?? 0,
    matchesThisWeek: data?.matchesThisWeek ?? 0,
    matchesThisWeekDelta: data?.matchesThisWeekDelta ?? 0,
    weeklyMatchCounts: data?.weeklyMatchCounts ?? [0, 0, 0, 0, 0, 0, 0],
    matchActivity: data?.matchActivity ?? emptyMatchActivity,
    weeklyEloClimber: data?.weeklyEloClimber ?? null,
    loading: isLoading,
  };
}
