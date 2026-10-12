import { getSupabaseClient } from '@/lib/supabaseClient';
import { computeGamesPerDayFromRange } from './computations';
import type {
  LegRow, MatchRow, OverallStats, PlayerAdjacencyRow, PlayerRow, PlayerSegmentRow, SummaryRow, ThrowRow, TurnRow,
} from './types';

/** Global totals for the overview cards, from `stats_overview()`. */
export type StatsOverview = {
  totalMatches: number;
  completedMatches: number;
  totalLegs: number;
  totalTurns: number;
  totalThrows: number;
  firstMatchAt: string | null;
  lastMatchAt: string | null;
};

/**
 * The rows the statistics computations read for one player, from `stats_player_detail()`: their
 * turns and darts, the legs those turns belong to or the player won, those legs' matches plus the
 * matches the player won, and their segment and adjacency summaries. The computations only look
 * legs and matches up through the player's own turns or count the player's wins, so this gives the
 * same numbers as the full history the page used to download.
 */
export type PlayerStatsDetail = {
  turns: TurnRow[];
  throws: ThrowRow[];
  legs: LegRow[];
  matches: MatchRow[];
  segments: PlayerSegmentRow[];
  adjacency: PlayerAdjacencyRow[];
};

/** The history the page downloaded before the stats functions existed. */
export type LegacyStatsGlobal = {
  legs: LegRow[];
  matches: MatchRow[];
  counts: { turns: number; throws: number };
  playerSegments: PlayerSegmentRow[];
  playerAdjacency: PlayerAdjacencyRow[];
};

type RawOverview = {
  total_matches: number;
  completed_matches: number;
  total_legs: number;
  total_turns: number;
  total_throws: number;
  first_match_at: string | null;
  last_match_at: string | null;
};
/** [id, leg_id, total_scored, busted, turn_number, created_at, [dart_index, segment, scored][]] */
type RawTurn = [string, string, number, boolean, number, string, [number, string, number][]];
/** [id, match_id, leg_number, created_at, winner_player_id] */
type RawLeg = [string, string, number, string, string | null];
/** [id, created_at, winner_player_id, start_score, finish] */
type RawMatch = [string, string, string | null, string, MatchRow['finish']];
export type RawPlayerDetail = {
  turns: RawTurn[];
  legs: RawLeg[];
  matches: RawMatch[];
  segments: PlayerSegmentRow[];
  adjacency: PlayerAdjacencyRow[];
};

type DatabaseError = { code?: string | null; message?: string } | null;

/**
 * True when the stats functions are not deployed yet. Migrations reach production on their own
 * schedule, so a newer client falls back to downloading the history as before until they are.
 */
export function isMissingStatsFunction(error: DatabaseError): boolean {
  return error?.code === 'PGRST202' || error?.code === '42883';
}

export function decodeStatsOverview(raw: RawOverview): StatsOverview {
  return {
    totalMatches: Number(raw.total_matches),
    completedMatches: Number(raw.completed_matches),
    totalLegs: Number(raw.total_legs),
    totalTurns: Number(raw.total_turns),
    totalThrows: Number(raw.total_throws),
    firstMatchAt: raw.first_match_at,
    lastMatchAt: raw.last_match_at,
  };
}

export function decodePlayerDetail(playerId: string, raw: RawPlayerDetail): PlayerStatsDetail {
  const turns: TurnRow[] = [];
  const throws: ThrowRow[] = [];
  for (const [id, legId, totalScored, busted, turnNumber, createdAt, darts] of raw.turns) {
    turns.push({
      id, leg_id: legId, player_id: playerId, total_scored: totalScored, busted, turn_number: turnNumber, created_at: createdAt,
    });
    for (const [dartIndex, segment, scored] of darts) {
      // (turn_id, dart_index) is unique, so it identifies the throw without sending its id.
      throws.push({ id: `${id}:${dartIndex}`, turn_id: id, dart_index: dartIndex, segment, scored });
    }
  }
  return {
    turns,
    throws,
    legs: raw.legs.map(([id, matchId, legNumber, createdAt, winnerPlayerId]) => ({
      id, match_id: matchId, leg_number: legNumber, created_at: createdAt, winner_player_id: winnerPlayerId,
    })),
    matches: raw.matches.map(([id, createdAt, winnerPlayerId, startScore, finish]) => ({
      id, created_at: createdAt, winner_player_id: winnerPlayerId, start_score: startScore, finish,
    })),
    segments: raw.segments,
    adjacency: raw.adjacency,
  };
}

/** The overview the page derived from the downloaded history (legacy path). */
export function overviewFromLegacy(legacy: LegacyStatsGlobal): StatsOverview {
  const { matches, legs, counts } = legacy;
  return {
    totalMatches: matches.length,
    completedMatches: matches.filter(m => m.winner_player_id).length,
    totalLegs: legs.length,
    totalTurns: counts.turns,
    totalThrows: counts.throws,
    firstMatchAt: matches[0]?.created_at ?? null,
    lastMatchAt: matches[matches.length - 1]?.created_at ?? null,
  };
}

export function overallStatsFrom(overview: StatsOverview): OverallStats {
  const { totalMatches, totalLegs, totalTurns, totalThrows, completedMatches } = overview;
  const avgTurnsPerLeg = totalLegs > 0 ? Math.round((totalTurns / totalLegs) * 10) / 10 : 0;
  const avgThrowsPerTurn = totalTurns > 0 ? Math.round((totalThrows / totalTurns) * 10) / 10 : 0;
  return { totalMatches, totalLegs, totalTurns, totalThrows, completedMatches, avgTurnsPerLeg, avgThrowsPerTurn };
}

export function gamesPerDayFrom(overview: StatsOverview): number {
  return computeGamesPerDayFromRange(overview.totalMatches, overview.firstMatchAt, overview.lastMatchAt);
}

// --- Fetching ---

export type StatsGlobalData = {
  summary: SummaryRow[];
  players: PlayerRow[];
  /** Null until `stats_overview()` is deployed; the page then uses the legacy history. */
  overview: StatsOverview | null;
};

export async function fetchStatsGlobalData(): Promise<StatsGlobalData> {
  const supabase = await getSupabaseClient();
  const [summary, players, overview] = await Promise.all([
    supabase.from('player_summary').select('*').order('wins', { ascending: false }),
    supabase.from('players').select('id, display_name, avatar_url').eq('is_active', true).order('display_name'),
    supabase.rpc('stats_overview'),
  ]);
  if (summary.error) throw summary.error;
  if (players.error) throw players.error;
  if (overview.error && !isMissingStatsFunction(overview.error)) throw overview.error;
  return {
    summary: (summary.data as unknown as SummaryRow[]) ?? [],
    players: (players.data as unknown as PlayerRow[]) ?? [],
    overview: overview.error ? null : decodeStatsOverview(overview.data as RawOverview),
  };
}

export type PlayerDetailData = {
  turns: TurnRow[];
  throws: ThrowRow[];
  /** The player's legs, matches and summaries; null on the legacy path, which uses the full history. */
  scoped: Omit<PlayerStatsDetail, 'turns' | 'throws'> | null;
};

export async function fetchPlayerDetailData(playerId: string): Promise<PlayerDetailData> {
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.rpc('stats_player_detail', { p_player_id: playerId });
  if (error && !isMissingStatsFunction(error)) throw error;
  if (!error) {
    const { turns, throws, ...scoped } = decodePlayerDetail(playerId, data as RawPlayerDetail);
    return { turns, throws, scoped };
  }
  return { ...(await fetchLegacyPlayerTurns(playerId)), scoped: null };
}

/** Every turn of one player and all their throws, as the page loaded them before `stats_player_detail()`. */
async function fetchLegacyPlayerTurns(playerId: string): Promise<{ turns: TurnRow[]; throws: ThrowRow[] }> {
  const supabase = await getSupabaseClient();
  const { data: t, error } = await supabase
    .from('turns')
    .select('id, leg_id, player_id, total_scored, busted, turn_number, created_at, legs!inner(matches!inner(ended_early))')
    .eq('player_id', playerId)
    .eq('legs.matches.ended_early', false)
    .order('created_at')
    .limit(100000);
  if (error) throw error;
  const turns = (t as unknown as TurnRow[]) ?? [];
  if (turns.length === 0) return { turns: [], throws: [] };

  const turnIds = turns.map(turn => turn.id);
  const batches: string[][] = [];
  for (let i = 0; i < turnIds.length; i += 200) batches.push(turnIds.slice(i, i + 200));
  const results = await Promise.all(batches.map((batch) =>
    supabase.from('throws').select('id, turn_id, dart_index, segment, scored').in('turn_id', batch)));
  const failed = results.find((result) => result.error);
  if (failed?.error) throw failed.error;
  return { turns, throws: results.flatMap(({ data }) => (data as unknown as ThrowRow[]) ?? []) };
}

/** The full history the page downloaded before `stats_overview()`; only used until it is deployed. */
export async function fetchLegacyStatsGlobal(): Promise<LegacyStatsGlobal> {
  const supabase = await getSupabaseClient();
  const [legs, matches, turns, throws, segments, adjacency] = await Promise.all([
    supabase.from('legs').select('*, matches!inner(ended_early)').eq('matches.ended_early', false).order('created_at').limit(100000),
    supabase.from('matches').select('id, created_at, winner_player_id, start_score, finish').eq('ended_early', false).order('created_at').limit(100000),
    supabase.from('turns').select('legs!inner(matches!inner(ended_early))', { count: 'exact', head: true }).eq('legs.matches.ended_early', false),
    supabase.from('throws').select('turns!inner(legs!inner(matches!inner(ended_early)))', { count: 'exact', head: true }).eq('turns.legs.matches.ended_early', false),
    supabase.from('player_segment_summary').select('*').limit(100000),
    supabase.from('player_adjacency_stats').select('*').limit(100000),
  ]);
  const failed = [legs, matches, turns, throws, segments, adjacency].find((result) => result.error);
  if (failed?.error) throw failed.error;
  return {
    legs: (legs.data as unknown as LegRow[]) ?? [],
    matches: (matches.data as unknown as MatchRow[]) ?? [],
    counts: { turns: turns.count ?? 0, throws: throws.count ?? 0 },
    playerSegments: (segments.data as unknown as PlayerSegmentRow[]) ?? [],
    playerAdjacency: (adjacency.data as unknown as PlayerAdjacencyRow[]) ?? [],
  };
}
