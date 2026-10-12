import { queryOptions } from '@tanstack/react-query';

import { batchEloHistory, batchMultiEloHistory } from '@/utils/eloHistory';

/** The last Elo ratings of each player, for the home leaderboard's trend sparklines. */
export const eloHistoryQuery = (playerIds: string[]) => queryOptions({
  queryKey: ['eloHistory', playerIds],
  queryFn: () => Promise.all([batchEloHistory(playerIds), batchMultiEloHistory(playerIds)])
    .then(([elo, multi]) => ({ elo, multi })),
  meta: { persist: true },
});
