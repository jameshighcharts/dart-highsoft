import { queryOptions } from '@tanstack/react-query';

import { fetchShared } from '@/lib/shared/fetchShared';
import { batchEloHistory, batchMultiEloHistory } from '@/utils/eloHistory';

export type EloHistories = { elo: Map<string, number[]>; multi: Map<string, number[]> };

export async function loadEloHistories(playerIds: string[]): Promise<EloHistories> {
  const [elo, multi] = await Promise.all([batchEloHistory(playerIds), batchMultiEloHistory(playerIds)]);
  return { elo, multi };
}

/** The last Elo ratings of each player, for the home leaderboard's trend sparklines. */
export const eloHistoryQuery = (playerIds: string[]) => queryOptions({
  queryKey: ['eloHistory', playerIds],
  queryFn: () => fetchShared('elo-history', { ids: playerIds.join(',') }, () => loadEloHistories(playerIds)),
  meta: { persist: true },
});
