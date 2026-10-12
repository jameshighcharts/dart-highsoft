import type { QueryClient } from '@tanstack/react-query';

import { leaderboardQuery, qualifyingPlayerIds } from '@/lib/queries/leaderboardData';
import { eloHistoryQuery } from '@/lib/queries/eloHistory';

/**
 * Loads the home leaderboard and then, straight away, its players' Elo trends: the two requests the
 * grid needs, started without waiting for the grid's code. Fresh cached data is not refetched.
 */
export async function prefetchHomeLeaderboard(queryClient: QueryClient): Promise<void> {
  const data = await queryClient.fetchQuery(leaderboardQuery());
  const playerIds = qualifyingPlayerIds(data);
  if (playerIds.length > 0) await queryClient.prefetchQuery(eloHistoryQuery(playerIds));
}
