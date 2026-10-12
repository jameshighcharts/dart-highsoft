import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { serializeQueryCache } from '@/lib/queryCacheSerialization';

import {
  computeAccuracy20Trend, computeAvgScoreTrend, computeBustAnalysis, computeBustRateTrend, computeCheckoutRateTrend,
  computeDartsPerLeg, computeDartsPerLegTrend, computeFirstNineTrend, computeHitDistribution, computePeriodComparison,
  computePerDartStats, computePlayerCoreStats, computeScoreConsistency, computeScoreDistributionChartData,
  computeT20GroupingTrend, computeTonCounts, computeTonRateOverTime, computeTrebleDoubleByNumber,
} from './computations';
import { computePlayerStatsBundle, loadPlayerStatsBundle } from './playerBundle';
import { decodePlayerDetail, type RawPlayerDetail } from './remote';
import { NOW, PLAYERS, buildHistory, legacyView, playerDetailPayload, segmentSummary } from './testHistory';
import type { LegRow, MatchRow, PlayerAdjacencyRow, PlayerSegmentRow, ThrowRow, TurnRow } from './types';

type Result = { data?: unknown; error?: { code: string; message: string } | null; count?: number };

const { db } = vi.hoisted(() => ({
  db: { tables: {} as Record<string, Result>, rpcs: {} as Record<string, Result> },
}));

/**
 * A chainable PostgREST stand-in: `in` filters the table's rows (the throws are loaded in batches
 * of turns), every other filter returns itself, and awaiting it yields the result.
 */
function query(table: string) {
  let result = db.tables[table] ?? { data: [] };
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'order', 'eq', 'limit']) chain[method] = () => chain;
  chain.in = (column: string, values: string[]) => {
    const rows = (result.data as Record<string, unknown>[] | undefined) ?? [];
    result = { ...result, data: rows.filter((row) => values.includes(row[column] as string)) };
    return chain;
  };
  chain.then = (resolve: (value: Result) => unknown) => resolve({ error: null, ...result });
  return chain;
}

vi.mock('@/lib/supabaseClient', () => ({
  getSupabaseClient: async () => ({
    from: (table: string) => query(table),
    rpc: async (name: string) => ({ error: null, ...(db.rpcs[name] ?? { data: null }) }),
  }),
}));

// --- What the page computed in the browser before, frozen from the components it lived in ---

const T20_GROUP_SEGMENTS = new Set(['20', 'S20', 'D20', 'T20', '1', 'S1', 'D1', 'T1', '5', 'S5', 'D5', 'T5']);

function oldT20GroupingAllTime(turns: TurnRow[], throws: ThrowRow[]): number {
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

function oldFirst9(turns: TurnRow[], throws: ThrowRow[]): number {
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

/** CompareKpiTable's computeRow. */
function oldCompareRow(playerId: string, turns: TurnRow[], throws: ThrowRow[], legs: LegRow[], matches: MatchRow[]) {
  const core = computePlayerCoreStats(playerId, turns, throws, legs, matches);
  const dplTrend = computeDartsPerLegTrend(core.playerTurns, core.playerThrows, core.playerLegs, legs, matches, playerId, 'all');
  const tons = computeTonCounts(core.playerTurns);
  const bustRate = core.playerTurns.length > 0
    ? Math.round((core.playerTurns.filter(t => t.busted).length / core.playerTurns.length) * 1000) / 10
    : 0;
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recentTurns = core.playerTurns.filter(t => new Date(t.created_at).getTime() >= cutoff);
  const recentTurnIds = new Set(recentTurns.map(t => t.id));
  const recentThrows = core.playerThrows.filter(th => recentTurnIds.has(th.turn_id));
  const validRecent = recentTurns.filter(t => !t.busted);
  return {
    gamesPlayed: core.gamesPlayed,
    gameWinRate: core.gameWinRate,
    legWinRate: core.legWinRate,
    avgScore: core.avgScore,
    avgScore30: validRecent.length > 0
      ? Math.round((validRecent.reduce((s, t) => s + t.total_scored, 0) / validRecent.length) * 100) / 100
      : 0,
    first9: oldFirst9(core.playerTurns, core.playerThrows),
    first9_30: oldFirst9(recentTurns, recentThrows),
    t20Grouping: oldT20GroupingAllTime(core.playerTurns, core.playerThrows),
    t20Grouping30: oldT20GroupingAllTime(recentTurns, recentThrows),
    checkoutRate: core.checkoutRate,
    bustRate,
    dartsPerLeg: dplTrend.allTimeAvg,
    count180: tons.ton180,
    highestCheckout: core.highestCheckout,
  };
}

/** Every value the Overview, Performance, Target Analysis, Trends and Compare views computed. */
function oldPageStats(
  playerId: string, turns: TurnRow[], throws: ThrowRow[], legs: LegRow[], matches: MatchRow[],
  segments: PlayerSegmentRow[], adjacency: PlayerAdjacencyRow[],
) {
  const { playerTurns, playerThrows, playerLegs, ...core } = computePlayerCoreStats(playerId, turns, throws, legs, matches);
  const dpl = (finish: 'all' | 'single_out' | 'double_out') =>
    computeDartsPerLegTrend(playerTurns, playerThrows, playerLegs, legs, matches, playerId, finish);
  return {
    core,
    performance: {
      hitDistribution: computeHitDistribution(playerId, segments, playerThrows),
      scoreDistribution: computeScoreDistributionChartData(core.scoreDistribution),
      bustAnalysis: computeBustAnalysis(playerTurns),
      dartsPerLeg: computeDartsPerLeg(playerTurns, playerThrows, playerLegs, playerId),
      consistency: computeScoreConsistency(playerTurns),
      perDart: computePerDartStats(playerThrows),
      tonCounts: computeTonCounts(playerTurns),
    },
    target: {
      trebleDoubleByNumber: computeTrebleDoubleByNumber(playerId, segments, playerThrows),
      adjacency: adjacency.find(pa => pa.player_id === playerId) ?? null,
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
      dartsPerLeg: { all: dpl('all'), single_out: dpl('single_out'), double_out: dpl('double_out') },
    },
    compare: oldCompareRow(playerId, turns, throws, legs, matches),
    truncated: { turns: false, legs: false, matches: false },
  };
}

function adjacencyFor(playerId: string): PlayerAdjacencyRow {
  return {
    player_id: playerId, display_name: playerId, hits_20: 12, hits_1: 3, hits_5: 4, hits_20_area: 19, hits_19: 8, hits_3: 2,
    hits_7: 1, hits_19_area: 11, total_throws: 120, accuracy_20_in_area: 63.2, accuracy_19_in_area: 72.7,
  };
}

/** Arrays anywhere in `value` holding rows the bundle was computed from. */
function rawRowArrays(value: unknown, path = 'bundle'): string[] {
  if (Array.isArray(value)) {
    const rows = value.filter((item) => item && typeof item === 'object' && ('turn_id' in item || 'leg_id' in item || 'match_id' in item));
    const own = rows.length > 0 ? [`${path} (${rows.length})`] : [];
    return [...own, ...value.flatMap((item, index) => rawRowArrays(item, `${path}[${index}]`))];
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => rawRowArrays(child, `${path}.${key}`));
  }
  return [];
}

beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterAll(() => { vi.useRealTimers(); });

beforeEach(() => {
  db.tables = {};
  db.rpcs = {};
});

describe('computePlayerStatsBundle', () => {
  it.each([1, 2, 3])('gives every player the numbers the page computed in the browser (history %i)', (seed) => {
    const history = buildHistory(seed);
    const segments = segmentSummary(history);
    const adjacency = PLAYERS.slice(0, 2).map(adjacencyFor);
    for (const player of [...PLAYERS, 'p-nobody']) {
      // The stats function path: the player's own rows.
      const detail = decodePlayerDetail(player, playerDetailPayload(history, player, segments));
      const scopedAdjacency = adjacency.filter((row) => row.player_id === player);
      const bundle = computePlayerStatsBundle(player, { ...detail, adjacency: scopedAdjacency });
      expect(bundle).toEqual(oldPageStats(player, detail.turns, detail.throws, detail.legs, detail.matches, detail.segments, scopedAdjacency));

      // The legacy path: the player's turns with the full history.
      const old = legacyView(history, player);
      const legacy = computePlayerStatsBundle(player, { ...old, segments, adjacency });
      expect(legacy).toEqual(oldPageStats(player, old.turns, old.throws, old.legs, old.matches, segments, adjacency));
      if (player !== 'p-nobody') expect(bundle.core.totalTurns).toBeGreaterThan(0);
    }
  });

  it('carries results only, never the turns, darts, legs or matches', () => {
    const history = buildHistory(1);
    const detail = decodePlayerDetail('p-ada', playerDetailPayload(history, 'p-ada', segmentSummary(history)));
    const bundle = computePlayerStatsBundle('p-ada', { ...detail, adjacency: [] });
    expect(detail.turns.length).toBeGreaterThan(50);
    // The Overview tab's top three rounds are the only turns it shows.
    expect(rawRowArrays(bundle)).toEqual(['bundle.core.topRounds (3)']);
    expect(bundle).not.toHaveProperty('core.playerTurns');
    expect(bundle).not.toHaveProperty('core.playerThrows');
    expect(bundle).not.toHaveProperty('core.playerLegs');
  });

  it('is a small fraction of the rows it replaces for an active player', () => {
    // About a year of office darts: ~5,700 turns and ~15,000 darts for this player (~770 KB of rows).
    const history = buildHistory(9, { matches: 1800, days: 365 });
    const segments = segmentSummary(history);
    const raw: RawPlayerDetail = playerDetailPayload(history, 'p-ada', segments);
    const detail = decodePlayerDetail('p-ada', raw);
    const bundle = computePlayerStatsBundle('p-ada', { ...detail, adjacency: [adjacencyFor('p-ada')] });
    const rawBytes = JSON.stringify(raw).length;
    const bundleBytes = serializeQueryCache(bundle).length;
    expect(detail.turns.length).toBeGreaterThan(5000);
    expect(bundleBytes).toBeLessThan(rawBytes / 4);
  });
});

describe('loadPlayerStatsBundle', () => {
  const history = buildHistory(2);
  const segments = segmentSummary(history);

  it('computes from the player’s rows in stats_player_detail()', async () => {
    const raw = playerDetailPayload(history, 'p-ben', segments);
    db.rpcs.stats_player_detail = { data: { ...raw, adjacency: [adjacencyFor('p-ben')] } };
    const detail = decodePlayerDetail('p-ben', raw);
    expect(await loadPlayerStatsBundle('p-ben')).toEqual(
      computePlayerStatsBundle('p-ben', { ...detail, adjacency: [adjacencyFor('p-ben')] }),
    );
  });

  it('falls back to the full history until the stats functions are deployed', async () => {
    db.rpcs.stats_player_detail = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
    const old = legacyView(history, 'p-ben');
    db.tables = {
      turns: { data: old.turns, count: old.turns.length },
      throws: { data: old.throws, count: old.throws.length },
      legs: { data: old.legs },
      matches: { data: old.matches },
      player_segment_summary: { data: segments },
      player_adjacency_stats: { data: [adjacencyFor('p-ben')] },
    };
    const bundle = await loadPlayerStatsBundle('p-ben');
    expect(bundle).toEqual(oldPageStats('p-ben', old.turns, old.throws, old.legs, old.matches, segments, [adjacencyFor('p-ben')]));
    expect(bundle.core.totalTurns).toBeGreaterThan(0);
  });
});
