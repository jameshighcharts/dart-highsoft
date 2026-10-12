"use client";

import { queryOptions, useQuery } from '@tanstack/react-query';
import { isMissingDatabaseObject } from '@/lib/missingDatabaseObject';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { getEloLeaderboard, type EloLeaderboardEntry } from '@/utils/eloRating';
import { getMultiEloLeaderboard, type MultiEloLeaderboardEntry } from '@/utils/eloRatingMultiplayer';

export type PlayerSummaryEntry = {
  player_id: string;
  display_name: string;
  wins: number;
  avg_per_turn: number;
};

export type PlayerGameStats = {
  games_played: number;
  game_win_rate: number;
};

type PlayerLocationRow = {
  id: string;
  location: string | null;
  avatar_url: string | null;
  created_at: string;
  is_active: boolean;
};

type RecentFormRow = {
  player_id: string;
  last_10_results: number[] | null;
};

type MatchParticipationRow = {
  player_id: string;
  matches:
    | {
        ended_early: boolean | null;
        winner_player_id: string | null;
      }
    | Array<{
        ended_early: boolean | null;
        winner_player_id: string | null;
      }>
    | null;
};

type WeeklyEloChangeRow = {
  created_at: string;
  player_id: string;
  rating_before: number | null;
  rating_after: number | null;
  rating_change: number | null;
};

type MatchCreatedRow = {
  created_at: string;
};

export type WeeklyEloClimber = {
  player_id: string;
  display_name: string;
  rating_change: number;
  rating_history: number[];
};

export type MatchActivity = {
  sevenDayCounts: number[];
  sevenDayTotal: number;
  sevenDayDelta: number;
  thirtyDayCounts: number[];
  thirtyDayTotal: number;
  thirtyDayDelta: number;
};

function buildRecentWinsByPlayer(rows: RecentFormRow[]): Map<string, number[]> {
  const recentWinsByPlayer = new Map<string, number[]>();
  for (const row of rows) {
    recentWinsByPlayer.set(row.player_id, row.last_10_results ?? []);
  }
  return recentWinsByPlayer;
}

function buildGameStatsByPlayer(rows: MatchParticipationRow[]): Map<string, PlayerGameStats> {
  const counts = new Map<string, { games_played: number; wins: number }>();

  for (const row of rows) {
    const match = Array.isArray(row.matches) ? row.matches[0] : row.matches;
    if (!match || match.ended_early || !match.winner_player_id) continue;

    const current = counts.get(row.player_id) ?? { games_played: 0, wins: 0 };
    current.games_played += 1;
    if (match.winner_player_id === row.player_id) {
      current.wins += 1;
    }
    counts.set(row.player_id, current);
  }

  const stats = new Map<string, PlayerGameStats>();
  for (const [playerId, value] of counts) {
    const game_win_rate = value.games_played > 0
      ? Number(((value.wins / value.games_played) * 100).toFixed(1))
      : 0;
    stats.set(playerId, {
      games_played: value.games_played,
      game_win_rate,
    });
  }

  return stats;
}

function buildWeeklyEloClimber(
  rows: WeeklyEloChangeRow[],
  playerNames: Map<string, string>
): WeeklyEloClimber | null {
  const changes = new Map<string, { ratingChange: number; rows: WeeklyEloChangeRow[] }>();
  for (const row of rows) {
    if (typeof row.rating_change !== 'number' || !Number.isFinite(row.rating_change)) continue;
    const current = changes.get(row.player_id) ?? { ratingChange: 0, rows: [] };
    current.ratingChange += row.rating_change;
    current.rows.push(row);
    changes.set(row.player_id, current);
  }

  let best: WeeklyEloClimber | null = null;
  for (const [playerId, value] of changes) {
    const ratingChange = Math.round(value.ratingChange);
    if (ratingChange <= 0) continue;
    const displayName = playerNames.get(playerId);
    if (!displayName) continue;

    const sortedRows = value.rows
      .slice()
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const firstBefore = sortedRows[0]?.rating_before;
    const ratingHistory = [
      typeof firstBefore === 'number' && Number.isFinite(firstBefore) ? firstBefore : 0,
      ...sortedRows
        .map((row) => row.rating_after)
        .filter((rating): rating is number => typeof rating === 'number' && Number.isFinite(rating)),
    ];

    if (!best || ratingChange > best.rating_change) {
      best = {
        player_id: playerId,
        display_name: displayName,
        rating_change: ratingChange,
        rating_history: ratingHistory.length > 1 ? ratingHistory : [0, ratingChange],
      };
    }
  }

  return best;
}

function startOfLocalDay(date: Date): Date {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return day;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function buildRollingMatchCounts(rows: MatchCreatedRow[], rangeDays: number, now: Date): number[] {
  const counts = Array.from({ length: rangeDays }, () => 0);
  const today = startOfLocalDay(now);
  const rangeStart = addDays(today, -(rangeDays - 1));
  for (const row of rows) {
    const createdAt = new Date(row.created_at);
    if (Number.isNaN(createdAt.getTime())) continue;

    const diffMs = createdAt.getTime() - rangeStart.getTime();
    const dayIndex = Math.floor(diffMs / 86_400_000);
    if (dayIndex >= 0 && dayIndex < counts.length) {
      counts[dayIndex] += 1;
    }
  }
  return counts;
}

function countMatchesInWindow(rows: MatchCreatedRow[], start: Date, end: Date): number {
  let count = 0;
  for (const row of rows) {
    const createdAt = new Date(row.created_at);
    if (Number.isNaN(createdAt.getTime())) continue;
    if (createdAt >= start && createdAt < end) {
      count += 1;
    }
  }
  return count;
}

function buildMatchActivity(rows: MatchCreatedRow[], now: Date): MatchActivity {
  const today = startOfLocalDay(now);
  const sevenDayStart = addDays(today, -6);
  const previousSevenDayStart = addDays(sevenDayStart, -7);
  const thirtyDayStart = addDays(today, -29);
  const previousThirtyDayStart = addDays(thirtyDayStart, -30);

  const sevenDayCounts = buildRollingMatchCounts(rows, 7, now);
  const thirtyDayCounts = buildRollingMatchCounts(rows, 30, now);
  const sevenDayTotal = sevenDayCounts.reduce((sum, count) => sum + count, 0);
  const thirtyDayTotal = thirtyDayCounts.reduce((sum, count) => sum + count, 0);

  return {
    sevenDayCounts,
    sevenDayTotal,
    sevenDayDelta: sevenDayTotal - countMatchesInWindow(rows, previousSevenDayStart, sevenDayStart),
    thirtyDayCounts,
    thirtyDayTotal,
    thirtyDayDelta: thirtyDayTotal - countMatchesInWindow(rows, previousThirtyDayStart, thirtyDayStart),
  };
}

type PlayerMatchRecordRow = {
  player_id: string;
  games_played: number;
  wins: number;
};

type MultiEloClimbRow = {
  player_id: string;
  rating_change: number;
  rating_history: number[];
};

type TimeWindow = { start: Date; end: Date };

type SupabaseClient = Awaited<ReturnType<typeof getSupabaseClient>>;

function buildGameStatsFromRecords(rows: PlayerMatchRecordRow[]): Map<string, PlayerGameStats> {
  const stats = new Map<string, PlayerGameStats>();
  for (const row of rows) {
    const game_win_rate = row.games_played > 0
      ? Number(((row.wins / row.games_played) * 100).toFixed(1))
      : 0;
    stats.set(row.player_id, { games_played: row.games_played, game_win_rate });
  }
  return stats;
}

/**
 * The windows MatchActivity counts, in order: the 7 and 30 daily buckets (24-hour steps from the
 * range's local midnight, exactly as buildRollingMatchCounts buckets), then the previous 7 and 30
 * days between local midnights (as countMatchesInWindow).
 */
function matchActivityWindows(now: Date): TimeWindow[] {
  const today = startOfLocalDay(now);
  const dailyBuckets = (rangeDays: number) => {
    const rangeStart = addDays(today, -(rangeDays - 1)).getTime();
    return Array.from({ length: rangeDays }, (_, day) => ({
      start: new Date(rangeStart + day * 86_400_000),
      end: new Date(rangeStart + (day + 1) * 86_400_000),
    }));
  };
  const sevenDayStart = addDays(today, -6);
  const thirtyDayStart = addDays(today, -29);
  return [
    ...dailyBuckets(7),
    ...dailyBuckets(30),
    { start: addDays(sevenDayStart, -7), end: sevenDayStart },
    { start: addDays(thirtyDayStart, -30), end: thirtyDayStart },
  ];
}

function matchActivityFromWindowCounts(counts: number[]): MatchActivity {
  const sevenDayCounts = counts.slice(0, 7);
  const thirtyDayCounts = counts.slice(7, 37);
  const sevenDayTotal = sevenDayCounts.reduce((sum, count) => sum + count, 0);
  const thirtyDayTotal = thirtyDayCounts.reduce((sum, count) => sum + count, 0);
  return {
    sevenDayCounts,
    sevenDayTotal,
    sevenDayDelta: sevenDayTotal - counts[37],
    thirtyDayCounts,
    thirtyDayTotal,
    thirtyDayDelta: thirtyDayTotal - counts[38],
  };
}

function buildWeeklyEloClimberFromTotals(
  rows: MultiEloClimbRow[],
  playerNames: Map<string, string>
): WeeklyEloClimber | null {
  let best: WeeklyEloClimber | null = null;
  for (const row of rows) {
    const ratingChange = Math.round(row.rating_change);
    if (ratingChange <= 0) continue;
    const displayName = playerNames.get(row.player_id);
    if (!displayName) continue;
    const ratingHistory = row.rating_history.filter((rating) => Number.isFinite(rating));
    if (!best || ratingChange > best.rating_change) {
      best = {
        player_id: row.player_id,
        display_name: displayName,
        rating_change: ratingChange,
        rating_history: ratingHistory.length > 1 ? ratingHistory : [0, ratingChange],
      };
    }
  }
  return best;
}

// Each loader reads the database-side aggregate, and falls back to the raw rows it replaced while
// the migration that adds the aggregate is not deployed yet. Other errors yield empty data, as before.

async function fetchPlayerGameStats(supabase: SupabaseClient): Promise<Map<string, PlayerGameStats>> {
  const records = await supabase
    .from('player_match_records')
    .select('player_id, games_played, wins');
  if (!isMissingDatabaseObject(records.error)) {
    return buildGameStatsFromRecords((records.data as unknown as PlayerMatchRecordRow[] | null) ?? []);
  }
  const { data } = await supabase
    .from('match_players')
    .select('player_id, matches!inner(ended_early, winner_player_id)')
    .eq('matches.ended_early', false);
  return buildGameStatsByPlayer((data as unknown as MatchParticipationRow[]) ?? []);
}

async function fetchMatchActivity(supabase: SupabaseClient, now: Date): Promise<MatchActivity> {
  const windows = matchActivityWindows(now);
  const counts = await supabase.rpc('count_matches_in_windows', {
    p_starts: windows.map((window) => window.start.toISOString()),
    p_ends: windows.map((window) => window.end.toISOString()),
  });
  if (!isMissingDatabaseObject(counts.error)) {
    const data = counts.data as number[] | null;
    return data?.length === windows.length ? matchActivityFromWindowCounts(data) : buildMatchActivity([], now);
  }
  const sixtyDaysAgo = addDays(startOfLocalDay(now), -59);
  const { data } = await supabase
    .from('matches')
    .select('created_at')
    .eq('ended_early', false)
    .gte('created_at', sixtyDaysAgo.toISOString());
  return buildMatchActivity((data as unknown as MatchCreatedRow[]) ?? [], now);
}

/** Resolves to a function of the player names, which load in parallel. */
async function fetchWeeklyEloClimber(
  supabase: SupabaseClient,
  since: Date
): Promise<(playerNames: Map<string, string>) => WeeklyEloClimber | null> {
  const climbs = await supabase.rpc('get_multi_elo_climbs', { p_since: since.toISOString() });
  if (!isMissingDatabaseObject(climbs.error)) {
    const rows = (climbs.data as MultiEloClimbRow[] | null) ?? [];
    return (playerNames) => buildWeeklyEloClimberFromTotals(rows, playerNames);
  }
  const { data } = await supabase
    .from('elo_ratings_multi')
    .select('created_at, player_id, rating_before, rating_after, rating_change')
    .gte('created_at', since.toISOString());
  const rows = (data as unknown as WeeklyEloChangeRow[]) ?? [];
  return (playerNames) => buildWeeklyEloClimber(rows, playerNames);
}

type LeaderboardLists = {
  leaders: PlayerSummaryEntry[];
  avgLeaders: PlayerSummaryEntry[];
  eloLeaders: EloLeaderboardEntry[];
  eloMultiLeaders: MultiEloLeaderboardEntry[];
};

async function fetchLeaderboardLists(
  supabase: SupabaseClient,
  limit?: number
): Promise<{ lists: LeaderboardLists; playerNames: Map<string, string> }> {
  const [{ data: summaryData }, eloData, eloMultiData] = await Promise.all([
    supabase
      .from('player_summary')
      .select('*')
      .order('wins', { ascending: false }),
    getEloLeaderboard(limit),
    getMultiEloLeaderboard(limit),
  ]);

  const allSummary = (summaryData as unknown as PlayerSummaryEntry[]) ?? [];
  const playerNames = new Map<string, string>();
  for (const row of allSummary) {
    playerNames.set(row.player_id, row.display_name);
  }
  for (const row of eloData) {
    playerNames.set(row.player_id, row.display_name);
  }
  for (const row of eloMultiData) {
    playerNames.set(row.player_id, row.display_name);
  }
  const leaders = limit ? allSummary.slice(0, limit) : allSummary;
  const avgLeaders = [...allSummary]
    .sort((a, b) => b.avg_per_turn - a.avg_per_turn);
  return {
    lists: {
      leaders,
      avgLeaders: limit ? avgLeaders.slice(0, limit) : avgLeaders,
      eloLeaders: eloData,
      eloMultiLeaders: eloMultiData,
    },
    playerNames,
  };
}

type LeaderboardData = LeaderboardLists & {
  recentWinsByPlayer: Map<string, number[]>;
  playerGameStats: Map<string, PlayerGameStats>;
  playerLocations: Map<string, string | null>;
  playerAvatarUrls: Map<string, string | null>;
  activePlayerCount: number;
  newPlayersThisWeek: number;
  matchesThisWeek: number;
  matchesThisWeekDelta: number;
  weeklyMatchCounts: number[];
  matchActivity: MatchActivity;
  weeklyEloClimber: WeeklyEloClimber | null;
};

async function fetchLeaderboardData(limit?: number): Promise<LeaderboardData> {
  const supabase = await getSupabaseClient();
  const now = new Date();
  const startOfThisWeek = new Date(now);
  const daysSinceMonday = (startOfThisWeek.getDay() + 6) % 7;
  startOfThisWeek.setDate(startOfThisWeek.getDate() - daysSinceMonday);
  startOfThisWeek.setHours(0, 0, 0, 0);

  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const [
    { lists, playerNames },
    { data: locData },
    { data: recentFormData },
    playerGameStats,
    matchActivity,
    weeklyEloClimberFor,
  ] = await Promise.all([
    fetchLeaderboardLists(supabase, limit),
    supabase
      .from('players')
      .select('id, location, avatar_url, created_at, is_active'),
    supabase
      .from('player_recent_form')
      .select('player_id, last_10_results'),
    fetchPlayerGameStats(supabase),
    fetchMatchActivity(supabase, now),
    fetchWeeklyEloClimber(supabase, sevenDaysAgo),
  ]);

  const locMap = new Map<string, string | null>();
  const avatarMap = new Map<string, string | null>();
  const players = (locData as unknown as PlayerLocationRow[]) ?? [];
  for (const row of players) {
    locMap.set(row.id, row.location);
    avatarMap.set(row.id, row.avatar_url ?? null);
  }
  const activePlayers = players.filter((row) => row.is_active);
  const newPlayersThisWeek = activePlayers.filter((row) =>
    new Date(row.created_at).getTime() >= startOfThisWeek.getTime()
  ).length;

  return {
    ...lists,
    recentWinsByPlayer: buildRecentWinsByPlayer((recentFormData as unknown as RecentFormRow[]) ?? []),
    playerGameStats,
    playerLocations: locMap,
    playerAvatarUrls: avatarMap,
    activePlayerCount: activePlayers.length,
    newPlayersThisWeek,
    matchesThisWeek: matchActivity.sevenDayTotal,
    matchesThisWeekDelta: matchActivity.sevenDayDelta,
    weeklyMatchCounts: matchActivity.sevenDayCounts,
    matchActivity,
    weeklyEloClimber: weeklyEloClimberFor(playerNames),
  };
}

const emptyRecentWinsByPlayer = new Map<string, number[]>();
const emptyPlayerGameStats = new Map<string, PlayerGameStats>();
const emptyPlayerLocations = new Map<string, string | null>();
const emptyPlayerAvatarUrls = new Map<string, string | null>();
const emptyMatchActivity: MatchActivity = {
  sevenDayCounts: [0, 0, 0, 0, 0, 0, 0],
  sevenDayTotal: 0,
  sevenDayDelta: 0,
  thirtyDayCounts: Array.from({ length: 30 }, () => 0),
  thirtyDayTotal: 0,
  thirtyDayDelta: 0,
};

export const leaderboardQuery = (limit?: number) => queryOptions({
  queryKey: ['leaderboard', limit],
  queryFn: () => fetchLeaderboardData(limit),
  meta: { persist: true },
});

/** Only the four ranked lists, for pages that show nothing else (the /leaderboards page). */
export const leaderboardListsQuery = (limit?: number) => queryOptions({
  queryKey: ['leaderboard', 'lists', limit],
  queryFn: async (): Promise<LeaderboardLists> =>
    (await fetchLeaderboardLists(await getSupabaseClient(), limit)).lists,
  meta: { persist: true },
});

export function useLeaderboardData(limit?: number) {
  const { data, isLoading } = useQuery(leaderboardQuery(limit));

  return {
    leaders: data?.leaders ?? [],
    avgLeaders: data?.avgLeaders ?? [],
    eloLeaders: data?.eloLeaders ?? [],
    eloMultiLeaders: data?.eloMultiLeaders ?? [],
    recentWinsByPlayer: data?.recentWinsByPlayer ?? emptyRecentWinsByPlayer,
    playerGameStats: data?.playerGameStats ?? emptyPlayerGameStats,
    playerLocations: data?.playerLocations ?? emptyPlayerLocations,
    playerAvatarUrls: data?.playerAvatarUrls ?? emptyPlayerAvatarUrls,
    activePlayerCount: data?.activePlayerCount ?? 0,
    newPlayersThisWeek: data?.newPlayersThisWeek ?? 0,
    matchesThisWeek: data?.matchesThisWeek ?? 0,
    matchesThisWeekDelta: data?.matchesThisWeekDelta ?? 0,
    weeklyMatchCounts: data?.weeklyMatchCounts ?? [0, 0, 0, 0, 0, 0, 0],
    matchActivity: data?.matchActivity ?? emptyMatchActivity,
    weeklyEloClimber: data?.weeklyEloClimber ?? null,
    loading: isLoading,
  };
}
