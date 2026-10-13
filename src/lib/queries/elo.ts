import { queryOptions } from '@tanstack/react-query';

import { getEloLeaderboard, getRecentEloChanges } from '@/utils/eloRating';
import {
  getMultiEloLeaderboard,
  getPlayerMultiEloHistory,
  getPlayerMultiEloStats,
  getRecentMultiEloChanges,
} from '@/utils/eloRatingMultiplayer';

// Small, bounded Elo lists: restored from the browser's saved cache, so a revisit shows them at once
// while they refresh. A finished game refreshes them (invalidateAfterGame).

export const eloLeaderboardQuery = (limit: number, withRecentChanges: boolean) => queryOptions({
  queryKey: ['elo', 'leaderboard', limit, withRecentChanges],
  queryFn: async () => {
    const [leaderboard, recent] = await Promise.all([
      getEloLeaderboard(limit),
      withRecentChanges ? getRecentEloChanges(20) : Promise.resolve([]),
    ]);
    return { leaderboard, recent };
  },
  meta: { persist: true },
});

export const multiEloLeaderboardQuery = (limit: number, withRecentChanges: boolean) => queryOptions({
  queryKey: ['elo', 'multi-leaderboard', limit, withRecentChanges],
  queryFn: async () => {
    const [leaderboard, recent] = await Promise.all([
      getMultiEloLeaderboard(limit),
      withRecentChanges ? getRecentMultiEloChanges(20) : Promise.resolve([]),
    ]);
    return { leaderboard, recent };
  },
  meta: { persist: true },
});

export const playerMultiEloQuery = (playerId: string, withHistory: boolean) => queryOptions({
  queryKey: ['elo', 'multi-player', playerId, withHistory],
  queryFn: async () => {
    const [stats, history] = await Promise.all([
      getPlayerMultiEloStats(playerId),
      withHistory ? getPlayerMultiEloHistory(playerId, 10) : Promise.resolve([]),
    ]);
    return { stats, history };
  },
  meta: { persist: true },
});
