import type { FetchQueryOptions } from '@tanstack/react-query';

type RouteQueries = () => Promise<FetchQueryOptions<any, any, any, any>[]>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * The queries each page reads on arrival, loaded lazily so the query code stays out of the shared
 * bundle until a link to that page is hovered or focused.
 */
const ROUTE_QUERIES: Record<string, RouteQueries> = {
  '/': async () => [(await import('@/hooks/useLeaderboardData')).leaderboardQuery()],
  '/bengt': async () => {
    const [{ highdartsQuery }, { meQuery }] = await Promise.all([import('./highdarts'), import('./me')]);
    return [highdartsQuery(), meQuery()];
  },
  '/boards': async () => [(await import('./boards')).scoliaBoardsQuery()],
  '/games': async () => (await import('./games')).gamesPageQueries(),
  '/leaderboards': async () => (await import('./leaderboards')).leaderboardsPageQueries(),
  '/new': async () => {
    const [{ newMatchPlayersQuery }, { meQuery }] = await Promise.all([import('./newMatch'), import('./me')]);
    return [newMatchPlayersQuery(), meQuery()];
  },
  '/players': async () => [(await import('./players')).playerListQuery()],
  '/stats': async () => [(await import('@/hooks/useStatsData')).statsGlobalQuery()],
};

export function routeQueries(pathname: string): RouteQueries | undefined {
  return ROUTE_QUERIES[pathname];
}
