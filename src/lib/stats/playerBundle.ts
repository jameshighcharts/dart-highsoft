import {
  computeAccuracy20Trend,
  computeAvgScoreTrend,
  computeBustAnalysis,
  computeBustRateTrend,
  computeCheckoutRateTrend,
  computeDartsPerLeg,
  computeDartsPerLegTrend,
  computeFirstNineTrend,
  computeHitDistribution,
  computePerDartStats,
  computePeriodComparison,
  computePlayerCoreStats,
  computeScoreConsistency,
  computeScoreDistributionChartData,
  computeT20GroupingTrend,
  computeTonCounts,
  computeTonRateOverTime,
  computeTrebleDoubleByNumber,
} from './computations';
import { fetchLegacyStatsGlobal, fetchPlayerDetailData } from './remote';
import type {
  LegRow, MatchRow, PlayerAdjacencyRow, PlayerCoreStats, PlayerSegmentRow, ThrowRow, TurnRow,
} from './types';

export type DartsPerLegFinish = 'all' | 'single_out' | 'double_out';

/** The player's core numbers, without the turns, darts and legs they were counted from. */
export type PlayerCoreSummary = Omit<PlayerCoreStats, 'playerTurns' | 'playerThrows' | 'playerLegs'>;

/** One player's row in the Compare view's head-to-head table. */
export type CompareRow = {
  gamesPlayed: number;
  gameWinRate: number;
  legWinRate: number;
  avgScore: number;
  avgScore30: number;
  first9: number;
  first9_30: number;
  t20Grouping: number;
  t20Grouping30: number;
  checkoutRate: number;
  bustRate: number;
  dartsPerLeg: number;
  count180: number;
  highestCheckout: number;
};

/**
 * Everything the statistics page shows for one player, computed from their turns and darts
 * (on the server, see `loadPlayerStatsBundle`) so the browser receives the results instead of
 * the rows: the Overview, Performance, Target Analysis and Trends tabs and both Compare views.
 */
export type PlayerStatsBundle = {
  core: PlayerCoreSummary;
  performance: {
    hitDistribution: ReturnType<typeof computeHitDistribution>;
    scoreDistribution: ReturnType<typeof computeScoreDistributionChartData>;
    bustAnalysis: ReturnType<typeof computeBustAnalysis>;
    dartsPerLeg: ReturnType<typeof computeDartsPerLeg>;
    consistency: ReturnType<typeof computeScoreConsistency>;
    perDart: ReturnType<typeof computePerDartStats>;
    tonCounts: ReturnType<typeof computeTonCounts>;
  };
  target: {
    trebleDoubleByNumber: ReturnType<typeof computeTrebleDoubleByNumber>;
    adjacency: PlayerAdjacencyRow | null;
  };
  trends: {
    comparison: ReturnType<typeof computePeriodComparison>;
    avgScore: ReturnType<typeof computeAvgScoreTrend>;
    firstNine: ReturnType<typeof computeFirstNineTrend>;
    accuracy20: ReturnType<typeof computeAccuracy20Trend>;
    t20Grouping: ReturnType<typeof computeT20GroupingTrend>;
    checkoutRate: ReturnType<typeof computeCheckoutRateTrend>;
    bustRate: ReturnType<typeof computeBustRateTrend>;
    tonRate: ReturnType<typeof computeTonRateOverTime>;
    /** Darts per leg for each finish rule the Trends tab can filter by. */
    dartsPerLeg: Record<DartsPerLegFinish, ReturnType<typeof computeDartsPerLegTrend>>;
  };
  compare: CompareRow;
  /** Which rows hit the legacy path's 100,000-row download limit (never on the stats functions). */
  truncated: { turns: boolean; legs: boolean; matches: boolean };
};

export type PlayerStatsInput = {
  turns: TurnRow[];
  throws: ThrowRow[];
  legs: LegRow[];
  matches: MatchRow[];
  segments: PlayerSegmentRow[];
  adjacency: PlayerAdjacencyRow[];
};

/** Rows at which the legacy download is assumed to have been cut off. */
const DATA_LIMIT_THRESHOLD = 95000;

const T20_GROUP_SEGMENTS = new Set([
  '20', 'S20', 'D20', 'T20',
  '1',  'S1',  'D1',  'T1',
  '5',  'S5',  'D5',  'T5',
]);

function computeT20GroupingAllTime(turns: TurnRow[], throws: ThrowRow[]): number {
  const turnsByLeg = new Map<string, TurnRow[]>();
  for (const t of turns) {
    let arr = turnsByLeg.get(t.leg_id);
    if (!arr) { arr = []; turnsByLeg.set(t.leg_id, arr); }
    arr.push(t);
  }

  const firstNineTurnIds = new Set<string>();
  for (const legTurns of turnsByLeg.values()) {
    const sorted = [...legTurns].sort((a, b) => a.turn_number - b.turn_number).slice(0, 3);
    for (const t of sorted) firstNineTurnIds.add(t.id);
  }

  let hits = 0, total = 0;
  for (const th of throws) {
    if (!firstNineTurnIds.has(th.turn_id)) continue;
    if (!th.segment) continue;
    total++;
    if (T20_GROUP_SEGMENTS.has(th.segment)) hits++;
  }
  return total > 0 ? Math.round((hits / total) * 1000) / 10 : 0;
}

function computeFirst9(turns: TurnRow[], throws: ThrowRow[]): number {
  const throwsByTurn = new Map<string, number>();
  for (const th of throws) throwsByTurn.set(th.turn_id, (throwsByTurn.get(th.turn_id) ?? 0) + 1);

  const turnsByLeg = new Map<string, TurnRow[]>();
  for (const t of turns) {
    let arr = turnsByLeg.get(t.leg_id);
    if (!arr) { arr = []; turnsByLeg.set(t.leg_id, arr); }
    arr.push(t);
  }

  let totalF9 = 0, countF9 = 0;
  for (const legTurns of turnsByLeg.values()) {
    const sorted = [...legTurns].sort((a, b) => a.turn_number - b.turn_number).slice(0, 3);
    let pts = 0, darts = 0;
    for (const t of sorted) {
      darts += throwsByTurn.get(t.id) ?? 3;
      pts += t.busted ? 0 : t.total_scored;
    }
    if (darts > 0) {
      totalF9 += (pts / darts) * 3;
      countF9++;
    }
  }
  return countF9 > 0 ? Math.round((totalF9 / countF9) * 100) / 100 : 0;
}

function computeCompareRow(
  core: PlayerCoreStats,
  allTimeDartsPerLeg: number,
  tons: ReturnType<typeof computeTonCounts>,
): CompareRow {
  const bustRate = core.playerTurns.length > 0
    ? Math.round((core.playerTurns.filter(t => t.busted).length / core.playerTurns.length) * 1000) / 10
    : 0;
  const first9 = computeFirst9(core.playerTurns, core.playerThrows);
  const t20Grouping = computeT20GroupingAllTime(core.playerTurns, core.playerThrows);

  // Last-30-days slice
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recentTurns = core.playerTurns.filter(t => new Date(t.created_at).getTime() >= cutoff);
  const recentTurnIds = new Set(recentTurns.map(t => t.id));
  const recentThrows = core.playerThrows.filter(th => recentTurnIds.has(th.turn_id));
  const validRecent = recentTurns.filter(t => !t.busted);
  const avgScore30 = validRecent.length > 0
    ? Math.round((validRecent.reduce((s, t) => s + t.total_scored, 0) / validRecent.length) * 100) / 100
    : 0;
  const first9_30 = computeFirst9(recentTurns, recentThrows);
  const t20Grouping30 = computeT20GroupingAllTime(recentTurns, recentThrows);

  return {
    gamesPlayed: core.gamesPlayed,
    gameWinRate: core.gameWinRate,
    legWinRate: core.legWinRate,
    avgScore: core.avgScore,
    avgScore30,
    first9,
    first9_30,
    t20Grouping,
    t20Grouping30,
    checkoutRate: core.checkoutRate,
    bustRate,
    dartsPerLeg: allTimeDartsPerLeg,
    count180: tons.ton180,
    highestCheckout: core.highestCheckout,
  };
}

/** Runs every computation the statistics page shows for `playerId` over their rows. */
export function computePlayerStatsBundle(
  playerId: string,
  { turns, throws, legs, matches, segments, adjacency }: PlayerStatsInput,
  truncated: PlayerStatsBundle['truncated'] = { turns: false, legs: false, matches: false },
): PlayerStatsBundle {
  const coreStats = computePlayerCoreStats(playerId, turns, throws, legs, matches);
  const { playerTurns, playerThrows, playerLegs, ...core } = coreStats;
  const dartsPerLegTrend = (finish: DartsPerLegFinish) =>
    computeDartsPerLegTrend(playerTurns, playerThrows, playerLegs, legs, matches, playerId, finish);
  const dartsPerLeg = {
    all: dartsPerLegTrend('all'),
    single_out: dartsPerLegTrend('single_out'),
    double_out: dartsPerLegTrend('double_out'),
  };
  const tonCounts = computeTonCounts(playerTurns);

  return {
    core,
    performance: {
      hitDistribution: computeHitDistribution(playerId, segments, playerThrows),
      scoreDistribution: computeScoreDistributionChartData(core.scoreDistribution),
      bustAnalysis: computeBustAnalysis(playerTurns),
      dartsPerLeg: computeDartsPerLeg(playerTurns, playerThrows, playerLegs, playerId),
      consistency: computeScoreConsistency(playerTurns),
      perDart: computePerDartStats(playerThrows),
      tonCounts,
    },
    target: {
      trebleDoubleByNumber: computeTrebleDoubleByNumber(playerId, segments, playerThrows),
      adjacency: adjacency.find(row => row.player_id === playerId) ?? null,
    },
    trends: {
      comparison: computePeriodComparison(playerTurns, playerThrows, playerLegs, legs, matches, playerId),
      avgScore: computeAvgScoreTrend(playerTurns),
      firstNine: computeFirstNineTrend(playerTurns, playerThrows),
      accuracy20: computeAccuracy20Trend(playerTurns, playerThrows),
      t20Grouping: computeT20GroupingTrend(playerTurns, playerThrows),
      checkoutRate: computeCheckoutRateTrend(playerTurns, playerLegs, legs, matches, playerId),
      bustRate: computeBustRateTrend(playerTurns),
      tonRate: computeTonRateOverTime(playerTurns),
      dartsPerLeg,
    },
    compare: computeCompareRow(coreStats, dartsPerLeg.all.allTimeAvg, tonCounts),
    truncated,
  };
}

/**
 * Loads one player's rows from `stats_player_detail()` and computes their statistics. Until that
 * function is deployed, it reads the player's turns and the full history like the page used to.
 */
export async function loadPlayerStatsBundle(playerId: string): Promise<PlayerStatsBundle> {
  const { turns, throws, scoped } = await fetchPlayerDetailData(playerId);
  if (scoped) return computePlayerStatsBundle(playerId, { turns, throws, ...scoped });
  const legacy = await fetchLegacyStatsGlobal();
  return computePlayerStatsBundle(
    playerId,
    {
      turns,
      throws,
      legs: legacy.legs,
      matches: legacy.matches,
      segments: legacy.playerSegments,
      adjacency: legacy.playerAdjacency,
    },
    {
      turns: turns.length >= DATA_LIMIT_THRESHOLD,
      legs: legacy.legs.length >= DATA_LIMIT_THRESHOLD,
      matches: legacy.matches.length >= DATA_LIMIT_THRESHOLD,
    },
  );
}
