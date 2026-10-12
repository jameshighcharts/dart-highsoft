import { infiniteQueryOptions, queryOptions, type InfiniteData } from '@tanstack/react-query';

import {
  GAME_SESSION_STATUSES,
  isGameMode,
  isGameSessionStatus,
  type GameMode,
  type GameSessionStatus,
} from '@/lib/games/types';
import { getSupabaseClient } from '@/lib/supabaseClient';

type GamePlayer = {
  id: string;
  display_name: string;
  avatar_url?: string | null;
  play_order: number;
};

export type MatchWithDetails = {
  id: string;
  mode: string;
  start_score: string;
  finish: string;
  legs_to_win: number;
  created_at: string;
  winner_player_id: string | null;
  completed_at: string | null;
  ended_early: boolean;
  players: GamePlayer[];
  /** Legs with a winner. */
  legs_won: number;
  winner_name?: string;
};

export type GameSessionWithDetails = {
  id: string;
  mode: GameMode;
  status: GameSessionStatus;
  created_at: string;
  winner_player_id: string | null;
  players: GamePlayer[];
  winner_name?: string;
};

export type ListedGame =
  | { kind: 'match'; created_at: string; match: MatchWithDetails }
  | { kind: 'game'; created_at: string; game: GameSessionWithDetails };

export type TournamentSummary = {
  id: string;
  name: string;
  status: string;
  start_score: string;
  finish: string;
  legs_to_win: number;
  created_at: string;
  player_count: number;
};

/** The last game of a page: the next page starts right after it. */
export type FeedCursor = { created_at: string; kind: 'match' | 'game'; id: string };

/** One page of finished games and where the next page starts (null when there is none). */
export type RecentGamesPage = { games: ListedGame[]; nextCursor: FeedCursor | null };
export type RecentGames = InfiniteData<RecentGamesPage, FeedCursor | null>;

/** Games per calendar day ("YYYY-MM-DD" in the viewer's time zone). */
export type GameActivity = Record<string, number>;

export const RECENT_PAGE_SIZE = 20;
/** First day of the activity heatmap. */
export const ACTIVITY_START_DAY = '2026-09-01';

/** A game as the games_feed RPC returns it. */
export type FeedRow = {
  kind: 'match' | 'game';
  id: string;
  created_at: string;
  mode: string;
  start_score: string | null;
  finish: string | null;
  legs_to_win: number | null;
  winner_player_id: string | null;
  completed_at: string | null;
  ended_early: boolean;
  status: string | null;
  legs_won: number | null;
  players: GamePlayer[];
};

/** Search- and day-specific results and the old full download are only worth keeping briefly. */
const SHORT_GC_TIME_MS = 10 * 60 * 1000;

/** "YYYY-MM-DD" of the date in the viewer's time zone. */
export function gameDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function browserTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function listedGamePlayers(entry: ListedGame) {
  return entry.kind === 'match' ? entry.match.players : entry.game.players;
}

/** Case-insensitive substring of any player's name; a blank search matches every game. */
export function matchesPlayerSearch(entry: ListedGame, search: string) {
  const needle = search.trim().toLocaleLowerCase();
  return listedGamePlayers(entry).some((player) => player.display_name.toLocaleLowerCase().includes(needle));
}

export function toListedGame(row: FeedRow): ListedGame | null {
  const players = row.players;
  const winnerName = row.winner_player_id
    ? players.find((player) => player.id === row.winner_player_id)?.display_name || 'Unknown'
    : undefined;
  if (row.kind === 'match') {
    const match: MatchWithDetails = {
      id: row.id,
      mode: row.mode,
      start_score: row.start_score ?? '',
      finish: row.finish ?? '',
      legs_to_win: row.legs_to_win ?? 0,
      created_at: row.created_at,
      winner_player_id: row.winner_player_id,
      completed_at: row.completed_at,
      ended_early: row.ended_early,
      players,
      legs_won: row.legs_won ?? 0,
      ...(winnerName ? { winner_name: winnerName } : {}),
    };
    return { kind: 'match', created_at: row.created_at, match };
  }
  if (!isGameMode(row.mode) || !isGameSessionStatus(row.status)) return null;
  return {
    kind: 'game',
    created_at: row.created_at,
    game: {
      id: row.id,
      mode: row.mode,
      status: row.status,
      created_at: row.created_at,
      winner_player_id: row.winner_player_id,
      players,
      winner_name: winnerName,
    },
  };
}

const toListedGames = (rows: FeedRow[]) => rows.flatMap((row) => toListedGame(row) ?? []);

/**
 * Newest first, a match before a party game started at the same moment. The database already
 * returns this order; sorting again (stable, so exact ties keep it) does not depend on the plan.
 */
const inFeedOrder = (rows: FeedRow[]) => [...rows].sort((a, b) =>
  Date.parse(b.created_at) - Date.parse(a.created_at) || (a.kind === b.kind ? 0 : a.kind === 'match' ? -1 : 1));

/** Games started per day in the viewer's time zone. */
export function countGamesByDay(games: ListedGame[]): GameActivity {
  const counts: GameActivity = {};
  for (const game of games) {
    const key = gameDateKey(new Date(game.created_at));
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

// PostgREST answers PGRST202 (Postgres 42883) while the games_feed migration has not reached
// the database yet; the pages then use the old full download until it has.
const MISSING_FUNCTION_CODES = new Set(['PGRST202', '42883']);

/** Rows from a feed function, or null when that function is not deployed yet. */
async function callFeed<T>(name: 'games_feed' | 'games_live' | 'games_activity', args: Record<string, unknown>): Promise<T[] | null> {
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    if (MISSING_FUNCTION_CODES.has(error.code)) return null;
    throw error;
  }
  return (data ?? []) as T[];
}

type LegacyGames = { liveGames: ListedGame[]; recentGames: ListedGame[] };

type PlayerRelation = Array<{
  play_order: number;
  players: { id: string; display_name: string; avatar_url?: string | null };
}>;

async function loadAllRows<T>(query: (offset: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 500) {
    const result = await query(offset);
    if (result.error) throw new Error(result.error.message);
    rows.push(...(result.data ?? []));
    if (!result.data || result.data.length < 500) return rows;
  }
}

const mapPlayers = (relation: PlayerRelation): GamePlayer[] =>
  relation
    .map((mp) => ({
      id: mp.players.id,
      display_name: mp.players.display_name,
      avatar_url: mp.players.avatar_url ?? null,
      play_order: mp.play_order,
    }))
    .sort((a, b) => a.play_order - b.play_order);

/** The whole history, as the page loaded it before games_feed existed. Only used as a fallback. */
async function loadLegacyGames(): Promise<LegacyGames> {
  const supabase = await getSupabaseClient();
  const [matches, sessions] = await Promise.all([
    loadAllRows(offset => supabase
      .from('matches')
      .select(`
        id,
        mode,
        start_score,
        finish,
        legs_to_win,
        created_at,
        winner_player_id,
        completed_at,
        ended_early,
        match_players!inner (
          play_order,
          players!inner (
            id,
            display_name,
            avatar_url
          )
        ),
        legs (
          id,
          winner_player_id
        )
      `)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + 499)),
    loadAllRows(offset => supabase
      .from('game_sessions')
      .select(`
        id,
        mode,
        status,
        created_at,
        winner_player_id,
        game_session_players!inner (
          play_order,
          players!inner (
            id,
            display_name,
            avatar_url
          )
        )
      `)
      .in('status', [...GAME_SESSION_STATUSES])
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + 499)),
  ]);

  type MatchRow = Omit<FeedRow, 'kind' | 'status' | 'legs_won' | 'players'> & {
    match_players: PlayerRelation;
    legs: Array<{ winner_player_id: string | null }> | null;
  };
  type SessionRow = { id: string; mode: string; status: string; created_at: string; winner_player_id: string | null; game_session_players: PlayerRelation };
  const rows: FeedRow[] = [
    ...(matches as unknown as MatchRow[]).map(({ match_players, legs, ...match }): FeedRow => ({
      ...match,
      kind: 'match',
      status: null,
      legs_won: (legs ?? []).filter((leg) => leg.winner_player_id).length,
      players: mapPlayers(match_players),
    })),
    ...(sessions as unknown as SessionRow[]).map((session): FeedRow => ({
      kind: 'game',
      id: session.id,
      created_at: session.created_at,
      mode: session.mode,
      start_score: null,
      finish: null,
      legs_to_win: null,
      winner_player_id: session.winner_player_id,
      completed_at: null,
      ended_early: session.status === 'ended_early',
      status: session.status,
      legs_won: null,
      players: mapPlayers(session.game_session_players),
    })),
  ];
  const games = toListedGames(rows);

  const isLive = (entry: ListedGame) => entry.kind === 'match'
    ? !entry.match.winner_player_id && !entry.match.completed_at && !entry.match.ended_early
    : entry.game.status === 'active';
  // Matches before party games, as concatenated before sorting; the sort is stable.
  const byNewest = (a: ListedGame, b: ListedGame) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  const ordered = [...games.filter((g) => g.kind === 'match'), ...games.filter((g) => g.kind === 'game')].sort(byNewest);
  return {
    liveGames: ordered.filter(isLive),
    recentGames: ordered.filter((entry) => !isLive(entry)),
  };
}

const legacyGamesQuery = () => queryOptions({
  queryKey: ['games', 'legacy'],
  queryFn: loadLegacyGames,
  // Shared by the live, recent and activity queries while they fall back, so it downloads once.
  staleTime: 30_000,
  gcTime: SHORT_GC_TIME_MS,
  meta: { persist: false },
});

export const liveGamesQuery = () => queryOptions({
  queryKey: ['games', 'live'],
  queryFn: async ({ client }): Promise<ListedGame[]> => {
    const rows = await callFeed<FeedRow>('games_live', {});
    if (rows) return toListedGames(inFeedOrder(rows));
    return (await client.fetchQuery(legacyGamesQuery())).liveGames;
  },
  // Not persisted: after a reload a finished game must not show as live until the refetch lands.
  meta: { persist: false },
});

export type RecentGamesFilters = {
  /** Already trimmed; '' for no search. */
  search: string;
  day: string | null;
  timeZone: string;
};

const cursorOf = (entry: ListedGame): FeedCursor => ({
  created_at: entry.created_at,
  kind: entry.kind,
  id: entry.kind === 'match' ? entry.match.id : entry.game.id,
});

/**
 * Finished games, RECENT_PAGE_SIZE at a time ("Show more" loads the next page). Pages are keyset
 * paginated on (created_at, kind, id), so each page is one small indexed read however deep it is.
 */
export const recentGamesQuery = (filters: RecentGamesFilters) => infiniteQueryOptions({
  queryKey: ['games', 'recent', filters],
  initialPageParam: null as FeedCursor | null,
  queryFn: async ({ client, pageParam }): Promise<RecentGamesPage> => {
    const { search, day, timeZone } = filters;
    // One extra row tells whether there is a next page.
    const rows = await callFeed<FeedRow>('games_feed', {
      p_search: search || null,
      p_day: day,
      p_time_zone: timeZone,
      p_limit: RECENT_PAGE_SIZE + 1,
      p_before_created_at: pageParam?.created_at ?? null,
      p_before_kind: pageParam?.kind ?? null,
      p_before_id: pageParam?.id ?? null,
    });
    let games: ListedGame[];
    if (rows) {
      games = toListedGames(inFeedOrder(rows));
    } else {
      const matching = (await client.fetchQuery(legacyGamesQuery())).recentGames
        .filter((entry) => matchesPlayerSearch(entry, search))
        .filter((entry) => !day || gameDateKey(new Date(entry.created_at)) === day);
      const start = pageParam
        ? matching.findIndex((entry) => entry.kind === pageParam.kind && cursorOf(entry).id === pageParam.id) + 1
        : 0;
      games = matching.slice(start, start + RECENT_PAGE_SIZE + 1);
    }
    const page = games.slice(0, RECENT_PAGE_SIZE);
    return { games: page, nextCursor: games.length > RECENT_PAGE_SIZE ? cursorOf(page[page.length - 1]) : null };
  },
  getNextPageParam: (lastPage) => lastPage.nextCursor,
  // Only the unfiltered list is restored on the next visit (the page trims it to its first page
  // when you leave); search and day results are dropped soon after they are no longer shown.
  ...(filters.search || filters.day ? { gcTime: SHORT_GC_TIME_MS } : {}),
  meta: { persist: !filters.search && !filters.day },
});

/** Keeps only the first page of every cached finished-games list, so a revisit refetches one page. */
export function trimRecentGamesToFirstPage(data: RecentGames | undefined): RecentGames | undefined {
  if (!data || data.pages.length <= 1) return data;
  return { pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) };
}

export type GameActivityFilters = { search: string; timeZone: string };

export const gamesActivityQuery = (filters: GameActivityFilters) => queryOptions({
  queryKey: ['games', 'activity', filters],
  queryFn: async ({ client }): Promise<GameActivity> => {
    const rows = await callFeed<{ day: string; games: number }>('games_activity', {
      p_from: ACTIVITY_START_DAY, p_search: filters.search || null, p_time_zone: filters.timeZone,
    });
    if (rows) return Object.fromEntries(rows.map((row) => [row.day, row.games]));
    const { liveGames, recentGames } = await client.fetchQuery(legacyGamesQuery());
    return countGamesByDay([...liveGames, ...recentGames].filter((entry) => matchesPlayerSearch(entry, filters.search)));
  },
  ...(filters.search ? { gcTime: SHORT_GC_TIME_MS } : {}),
  meta: { persist: !filters.search },
});

/** Live tournaments plus those completed in the last 24h; the player count is embedded, not a second request. */
async function loadTournaments(): Promise<TournamentSummary[]> {
  const supabase = await getSupabaseClient();
  const completedCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('tournaments')
    .select('id, name, status, start_score, finish, legs_to_win, created_at, tournament_players(count)')
    .or(`status.eq.in_progress,and(status.eq.completed,completed_at.gte.${completedCutoff})`)
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) throw error;
  return (data ?? []).map(({ tournament_players: players, ...tournament }) => ({
    ...tournament,
    player_count: (players as unknown as Array<{ count: number }> | null)?.[0]?.count ?? 0,
  }));
}

export const tournamentsQuery = () => queryOptions({
  queryKey: ['games', 'tournaments'],
  // Errors are thrown, not turned into an empty list, so a failure is never cached or persisted.
  // The page shows the panel only when there are tournaments, so a failed load just hides it.
  queryFn: loadTournaments,
  meta: { persist: true },
});

/** What /games shows before any search, date or "Show more": for hover prefetch. */
export const gamesPageQueries = () => {
  const timeZone = browserTimeZone();
  return [
    liveGamesQuery(),
    recentGamesQuery({ search: '', day: null, timeZone }),
    gamesActivityQuery({ search: '', timeZone }),
    tournamentsQuery(),
  ];
};
