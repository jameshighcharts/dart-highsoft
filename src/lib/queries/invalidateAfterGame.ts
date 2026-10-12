import type { QueryClient } from '@tanstack/react-query';

import { refreshAfterChange } from '@/lib/queries/refreshAfterChange';
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

/**
 * Refreshes this browser's copies of everything a finished match or game changes. With
 * `resultJustHappened` (the game finished while it was open, not when opening a finished one) the
 * server's shared copies are purged first, so the refetches don't get them back from before it.
 */
export function invalidateAfterGame(queryClient: QueryClient, { resultJustHappened }: { resultJustHappened: boolean }): void {
  const refresh = () => {
    for (const queryKey of AFFECTED_QUERIES) refreshAfterChange(queryClient, queryKey);
  };
  if (resultJustHappened) void expireSharedData().then(refresh);
  else refresh();
}
