import type { FetchInfiniteQueryOptions, FetchQueryOptions, QueryClient } from '@tanstack/react-query';

type RoutePrefetch = (queryClient: QueryClient) => Promise<unknown>;
/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyQuery = FetchQueryOptions<any, any, any, any> | FetchInfiniteQueryOptions<any, any, any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Prefetches each query, or the first page of a paged (infinite) one; fresh data is skipped. */
const prefetchAll = (queryClient: QueryClient, queries: AnyQuery[]) =>
  Promise.all(queries.map((query) => ('getNextPageParam' in query
    ? queryClient.prefetchInfiniteQuery(query)
    : queryClient.prefetchQuery(query as FetchQueryOptions))));

/**
 * What each page loads on arrival, started when a link to it is hovered, focused or touched. The
 * query code is imported lazily, so it stays out of the shared bundle until then. /boards is left
 * out: its live status is always refetched on arrival, so a prefetch would only double the calls to
 * the Scolia API.
 */
const ROUTE_PREFETCH: Record<string, RoutePrefetch> = {
  '/': async (queryClient) => {
    // Next's Link does not prefetch the client-only grid chunk, so warm it too.
    void import('@/components/GridLeaderboard');
    const { prefetchHomeLeaderboard } = await import('./homeLeaderboard');
    return prefetchHomeLeaderboard(queryClient);
  },
  '/bengt': async (queryClient) => {
    const [{ highdartsQuery }, { meQuery }] = await Promise.all([import('./highdarts'), import('./me')]);
    return prefetchAll(queryClient, [highdartsQuery(), meQuery()]);
  },
  '/games': async (queryClient) => prefetchAll(queryClient, (await import('./games')).gamesPageQueries()),
  '/leaderboards': async (queryClient) =>
    prefetchAll(queryClient, (await import('./leaderboards')).leaderboardsPageQueries()),
  '/new': async (queryClient) => {
    const [{ newMatchPlayersQuery }, { meQuery }] = await Promise.all([import('./newMatch'), import('./me')]);
    return prefetchAll(queryClient, [newMatchPlayersQuery(), meQuery()]);
  },
  '/players': async (queryClient) => prefetchAll(queryClient, [(await import('./players')).playerListQuery()]),
  '/stats': async (queryClient) => prefetchAll(queryClient, [(await import('@/hooks/useStatsData')).statsGlobalQuery()]),
};

export function routePrefetch(pathname: string): RoutePrefetch | undefined {
  return ROUTE_PREFETCH[pathname];
}
