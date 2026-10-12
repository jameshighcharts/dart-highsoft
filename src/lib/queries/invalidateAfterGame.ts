import type { QueryClient } from '@tanstack/react-query';

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
  for (const queryKey of AFFECTED_QUERIES) void queryClient.invalidateQueries({ queryKey });
}
