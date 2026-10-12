import type { QueryClient } from '@tanstack/react-query';

import { expireSharedData } from '@/lib/shared/fetchShared';

/**
 * Everything a finished match or game changes. Cached data is otherwise reused for up to 30s and
 * persisted across reloads, so a result must reach every page that shows it on the next visit.
 */
const AFFECTED_QUERIES = [
  ['leaderboard'],
  ['eloHistory'],
  ['leaderboards'],
  ['stats'],
  ['games'],
  ['highdarts'],
  ['players'],
] as const;

export function invalidateAfterGame(queryClient: QueryClient): void {
  // The server's shared copies go first, so the refetches below don't get them back.
  void expireSharedData().then(() => {
    for (const queryKey of AFFECTED_QUERIES) void queryClient.invalidateQueries({ queryKey });
  });
}
