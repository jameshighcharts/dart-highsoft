import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  computeAccuracy20Trend, computeAvgScoreTrend, computeBustAnalysis, computeBustRateTrend, computeCheckoutRateTrend,
  computeDartsPerLeg, computeDartsPerLegTrend, computeFirstNineTrend, computeGamesPerDay, computeHitDistribution,
  computePeriodComparison, computePerDartStats, computePlayerCoreStats, computeScoreConsistency, computeT20GroupingTrend,
  computeTonBandsOverTime, computeTonCounts, computeTonRateOverTime, computeTrebleDoubleByNumber,
} from './computations';
import {
  decodePlayerDetail, decodeStatsOverview, gamesPerDayFrom, isMissingStatsFunction, overallStatsFrom, overviewFromLegacy,
  type RawPlayerDetail,
} from './remote';
import type { LegRow, MatchRow, PlayerSegmentRow, ThrowRow, TurnRow } from './types';

// --- A deterministic history with the edge cases the database regression also seeds ---

const NOW = new Date('2026-10-12T12:00:00.000Z');
const PLAYERS = ['p-ada', 'p-ben', 'p-cyd', 'p-dan'];
const SEGMENTS: Array<[string, number]> = [
  ['T20', 60], ['20', 20], ['S20', 20], ['D20', 40], ['1', 1], ['S1', 1], ['5', 5], ['S5', 5],
  ['T19', 57], ['19', 19], ['S19', 19], ['D19', 38], ['3', 3], ['S3', 3], ['7', 7], ['S7', 7],
  ['T5', 15], ['D12', 24], ['S12', 12], ['OuterBull', 25], ['InnerBull', 50], ['Miss', 0], ['MISS', 0],
];

function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type History = { matches: (MatchRow & { ended_early: boolean })[]; legs: LegRow[]; turns: TurnRow[]; throws: ThrowRow[] };

function buildHistory(seed: number): History {
  const rnd = random(seed);
  const pick = <T,>(items: T[]) => items[Math.floor(rnd() * items.length)];
  const history: History = { matches: [], legs: [], turns: [], throws: [] };
  for (let m = 0; m < 70; m++) {
    const start = new Date(NOW.getTime() - (95 - m * 1.3) * 86_400_000 - Math.floor(rnd() * 5) * 3_600_000);
    const players = PLAYERS.filter(() => rnd() < 0.6);
    if (players.length < 2) players.splice(0, players.length, PLAYERS[m % 4], PLAYERS[(m + 1) % 4]);
    const match = {
      id: `m-${String(m).padStart(3, '0')}`,
      created_at: start.toISOString(),
      // Some matches are won by someone who never threw in them.
      winner_player_id: rnd() < 0.15 ? null : rnd() < 0.05 ? pick(PLAYERS) : pick(players),
      start_score: pick(['201', '301', '501']),
      finish: pick(['single_out', 'double_out'] as const),
      ended_early: rnd() < 0.1,
    };
    history.matches.push(match);
    const legCount = 1 + Math.floor(rnd() * 3);
    for (let l = 0; l < legCount; l++) {
      const legAt = start.getTime() + l * 900_000;
      const leg = {
        id: `l-${match.id}-${l}`,
        match_id: match.id,
        leg_number: l + 1,
        created_at: new Date(legAt).toISOString(),
        winner_player_id: rnd() < 0.1 ? null : rnd() < 0.05 ? pick(PLAYERS) : pick(players),
      };
      history.legs.push(leg);
      const turnCount = Math.floor(rnd() * 14);
      for (let t = 0; t < turnCount; t++) {
        // Every fifth turn shares its timestamp with the previous one: the id breaks the tie.
        const at = new Date(legAt + (t - (t % 5 === 4 ? 1 : 0)) * 40_000).toISOString();
        const busted = rnd() < 0.08;
        const dartCount = rnd() < 0.05 ? 0 : rnd() < 0.15 ? 1 + Math.floor(rnd() * 2) : 3;
        const turnId = `t-${leg.id}-${String(t).padStart(2, '0')}`;
        let total = 0;
        for (let d = 1; d <= dartCount; d++) {
          const [segment, scored] = pick(SEGMENTS);
          total += scored;
          history.throws.push({ id: `th-${turnId}-${d}`, turn_id: turnId, dart_index: d, segment, scored });
        }
        history.turns.push({
          id: turnId, leg_id: leg.id, player_id: players[t % players.length], total_scored: busted ? 0 : total,
          busted, turn_number: t + 1, created_at: at,
        });
      }
    }
  }
  return history;
}

const byTimeThenId = <T extends { created_at: string; id: string }>(a: T, b: T) =>
  a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);

/** What the page downloaded before: every leg and match, and the player's turns and throws. */
function legacyView(history: History, playerId: string) {
  const live = new Set(history.matches.filter((m) => !m.ended_early).map((m) => m.id));
  const legs = history.legs.filter((l) => live.has(l.match_id)).sort(byTimeThenId);
  const liveLegs = new Set(legs.map((l) => l.id));
  const matches = history.matches.filter((m) => !m.ended_early).sort(byTimeThenId)
    .map(({ id, created_at, winner_player_id, start_score, finish }) => ({ id, created_at, winner_player_id, start_score, finish }));
  const turns = history.turns.filter((t) => t.player_id === playerId && liveLegs.has(t.leg_id)).sort(byTimeThenId);
  const turnIds = new Set(turns.map((t) => t.id));
  // The batched throw requests came back in no particular order.
  const rnd = random(7);
  const throws = history.throws.filter((th) => turnIds.has(th.turn_id))
    .map((th) => ({ th, key: rnd() })).sort((a, b) => a.key - b.key).map(({ th }) => th);
  return { legs, matches, turns, throws };
}

/** What `stats_player_detail()` returns for the same history (mirrors the SQL). */
function playerDetailPayload(history: History, playerId: string, segments: PlayerSegmentRow[]): RawPlayerDetail {
  const { legs, matches, turns } = legacyView(history, playerId);
  const playedLegs = new Set(turns.map((t) => t.leg_id));
  const playerLegs = legs.filter((l) => playedLegs.has(l.id) || l.winner_player_id === playerId);
  const legMatches = new Set(playerLegs.map((l) => l.match_id));
  const playerMatches = matches.filter((m) => legMatches.has(m.id) || m.winner_player_id === playerId);
  return {
    turns: turns.map((t) => [t.id, t.leg_id, t.total_scored, t.busted, t.turn_number, t.created_at,
      history.throws.filter((th) => th.turn_id === t.id).sort((a, b) => a.dart_index - b.dart_index)
        .map((th) => [th.dart_index, th.segment, th.scored] as [number, string, number])]),
    legs: playerLegs.map((l) => [l.id, l.match_id, l.leg_number, l.created_at, l.winner_player_id]),
    matches: playerMatches.map((m) => [m.id, m.created_at, m.winner_player_id, m.start_score, m.finish]),
    segments: segments.filter((s) => s.player_id === playerId),
    adjacency: [],
  };
}

/** player_segment_summary for every player, computed from the history like the view does. */
function segmentSummary(history: History): PlayerSegmentRow[] {
  const rows = new Map<string, PlayerSegmentRow>();
  for (const player of PLAYERS) {
    const { throws } = legacyView(history, player);
    for (const th of throws) {
      const key = `${player}|${th.segment}`;
      const row = rows.get(key) ?? {
        player_id: player, display_name: player, segment: th.segment, total_hits: 0, total_score: 0, avg_score: 0, segment_number: null,
      };
      row.total_hits += 1;
      row.total_score += th.scored;
      row.avg_score = row.total_score / row.total_hits;
      rows.set(key, row);
    }
  }
  return [...rows.values()];
}

/** Every number and chart series the stats page shows for one player. */
function displayedStats(playerId: string, turns: TurnRow[], throws: ThrowRow[], legs: LegRow[], matches: MatchRow[], segments: PlayerSegmentRow[]) {
  const core = computePlayerCoreStats(playerId, turns, throws, legs, matches);
  const { playerTurns, playerThrows, playerLegs } = core;
  return {
    // The decoded throws carry a synthetic id; everything they are counted by is the same.
    core: { ...core, playerThrows: core.playerThrows.map(({ turn_id, dart_index, segment, scored }) => ({ turn_id, dart_index, segment, scored })).sort((a, b) =>
      a.turn_id.localeCompare(b.turn_id) || a.dart_index - b.dart_index) },
    hitDistribution: computeHitDistribution(playerId, segments, playerThrows),
    trebleDouble: computeTrebleDoubleByNumber(playerId, segments, playerThrows),
    tonBands: computeTonBandsOverTime(playerTurns),
    avgScoreTrend: computeAvgScoreTrend(playerTurns),
    firstNineTrend: computeFirstNineTrend(playerTurns, playerThrows),
    accuracy20Trend: computeAccuracy20Trend(playerTurns, playerThrows),
    t20GroupingTrend: computeT20GroupingTrend(playerTurns, playerThrows),
    periodComparison: computePeriodComparison(playerTurns, playerThrows, playerLegs, legs, matches, playerId),
    checkoutTrend: computeCheckoutRateTrend(playerTurns, playerLegs, legs, matches, playerId),
    bustTrend: computeBustRateTrend(playerTurns),
    tonRate: computeTonRateOverTime(playerTurns),
    dartsPerLegTrend: (['all', 'single_out', 'double_out'] as const).map((finish) =>
      computeDartsPerLegTrend(playerTurns, playerThrows, playerLegs, legs, matches, playerId, finish)),
    bustAnalysis: computeBustAnalysis(playerTurns),
    dartsPerLeg: computeDartsPerLeg(playerTurns, playerThrows, playerLegs, playerId),
    consistency: computeScoreConsistency(playerTurns),
    perDart: computePerDartStats(playerThrows),
    tons: computeTonCounts(playerTurns),
  };
}

beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterAll(() => { vi.useRealTimers(); });

describe('stats from the database functions', () => {
  it.each([1, 2, 3])('shows every player the same numbers as the full history did (history %i)', (seed) => {
    const history = buildHistory(seed);
    const segments = segmentSummary(history);
    for (const player of [...PLAYERS, 'p-nobody']) {
      const old = legacyView(history, player);
      const detail = decodePlayerDetail(player, playerDetailPayload(history, player, segments));
      const before = displayedStats(player, old.turns, old.throws, old.legs, old.matches, segments);
      const after = displayedStats(player, detail.turns, detail.throws, detail.legs, detail.matches, detail.segments);
      expect(after).toEqual(before);
      if (player !== 'p-nobody') expect(before.core.totalTurns).toBeGreaterThan(0);
    }
  });

  it('includes legs and matches the player won without throwing in them', () => {
    const history = buildHistory(4);
    // A match and leg Ada is recorded as winning, with only Ben's darts in it.
    history.matches.push({ id: 'm-walkover', created_at: '2026-10-01T10:00:00.000Z', winner_player_id: 'p-ada', start_score: '301', finish: 'double_out', ended_early: false });
    history.legs.push({ id: 'l-walkover', match_id: 'm-walkover', leg_number: 1, created_at: '2026-10-01T10:00:00.000Z', winner_player_id: 'p-ada' });
    history.turns.push({ id: 't-walkover', leg_id: 'l-walkover', player_id: 'p-ben', total_scored: 60, busted: false, turn_number: 1, created_at: '2026-10-01T10:01:00.000Z' });
    const legacy = legacyView(history, 'p-ada');
    const detail = decodePlayerDetail('p-ada', playerDetailPayload(history, 'p-ada', []));
    const old = computePlayerCoreStats('p-ada', legacy.turns, legacy.throws, legacy.legs, legacy.matches);
    const now = computePlayerCoreStats('p-ada', detail.turns, detail.throws, detail.legs, detail.matches);
    const playedMatches = new Set(old.playerLegs.map((l) => l.match_id));
    expect(legacy.matches.some((m) => m.winner_player_id === 'p-ada' && !playedMatches.has(m.id))).toBe(true);
    expect(now.matchesWon).toBe(old.matchesWon);
    expect(now.legsWon).toBe(old.legsWon);
  });

  it('shows the same overview totals and games per day', () => {
    const history = buildHistory(5);
    const live = history.matches.filter((m) => !m.ended_early).sort(byTimeThenId);
    const liveIds = new Set(live.map((m) => m.id));
    const legs = history.legs.filter((l) => liveIds.has(l.match_id));
    const legIds = new Set(legs.map((l) => l.id));
    const turns = history.turns.filter((t) => legIds.has(t.leg_id));
    const turnIds = new Set(turns.map((t) => t.id));
    const counts = { turns: turns.length, throws: history.throws.filter((th) => turnIds.has(th.turn_id)).length };

    // The old hook's computation, verbatim.
    const old = {
      totalMatches: live.length, totalLegs: legs.length, totalTurns: counts.turns, totalThrows: counts.throws,
      completedMatches: live.filter((m) => m.winner_player_id).length,
      avgTurnsPerLeg: legs.length > 0 ? Math.round((counts.turns / legs.length) * 10) / 10 : 0,
      avgThrowsPerTurn: counts.turns > 0 ? Math.round((counts.throws / counts.turns) * 10) / 10 : 0,
    };
    const overview = decodeStatsOverview({
      total_matches: live.length, completed_matches: old.completedMatches, total_legs: legs.length,
      total_turns: counts.turns, total_throws: counts.throws,
      first_match_at: live[0].created_at, last_match_at: live[live.length - 1].created_at,
    });
    expect(overallStatsFrom(overview)).toEqual(old);
    expect(gamesPerDayFrom(overview)).toBe(computeGamesPerDay(live));
    const legacy = overviewFromLegacy({ legs, matches: live, counts, playerSegments: [], playerAdjacency: [] });
    expect(overallStatsFrom(legacy)).toEqual(old);
    expect(gamesPerDayFrom(legacy)).toBe(computeGamesPerDay(live));
  });

  it('shows zeros with no history', () => {
    const empty = decodeStatsOverview({
      total_matches: 0, completed_matches: 0, total_legs: 0, total_turns: 0, total_throws: 0, first_match_at: null, last_match_at: null,
    });
    expect(overallStatsFrom(empty)).toEqual({
      totalMatches: 0, totalLegs: 0, totalTurns: 0, totalThrows: 0, completedMatches: 0, avgTurnsPerLeg: 0, avgThrowsPerTurn: 0,
    });
    expect(gamesPerDayFrom(empty)).toBe(computeGamesPerDay([]));
  });
});

describe('decoding stats_player_detail()', () => {
  // Captured from the function on PostgreSQL 15 (supabase/tests/20261012150100_stats_aggregates.sql seed).
  const sample: RawPlayerDetail = {
    turns: [
      ['5c000000-0000-0000-0000-000000000001', '5b000000-0000-0000-0000-000000000001', 180, false, 1, '2026-01-01T10:01:00+00:00',
        [[1, 'T20', 60], [2, 'T20', 60], [3, 'T20', 60]]],
      ['5c000000-0000-0000-0000-000000000013', '5b000000-0000-0000-0000-000000000005', 45, false, 2, '2026-01-03T10:02:00+00:00', []],
    ],
    legs: [['5b000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000001', 1, '2026-01-01T10:00:00+00:00', '51000000-0000-0000-0000-000000000001']],
    matches: [['5a000000-0000-0000-0000-000000000003', '2026-01-03T10:00:00+00:00', null, '201', 'single_out']],
    segments: [{
      player_id: '51000000-0000-0000-0000-000000000001', display_name: 'Stats Alice', segment: 'T20', total_hits: 7, total_score: 420,
      avg_score: 60.0000000000000000, segment_number: 20,
    }],
    adjacency: [],
  };

  it('restores the row shapes the computations read', () => {
    const detail = decodePlayerDetail('51000000-0000-0000-0000-000000000001', sample);
    expect(detail.turns[0]).toEqual({
      id: '5c000000-0000-0000-0000-000000000001', leg_id: '5b000000-0000-0000-0000-000000000001',
      player_id: '51000000-0000-0000-0000-000000000001', total_scored: 180, busted: false, turn_number: 1,
      created_at: '2026-01-01T10:01:00+00:00',
    });
    expect(detail.throws).toHaveLength(3);
    expect(detail.throws[2]).toEqual({
      id: '5c000000-0000-0000-0000-000000000001:3', turn_id: '5c000000-0000-0000-0000-000000000001', dart_index: 3, segment: 'T20', scored: 60,
    });
    expect(detail.legs[0]).toEqual({
      id: '5b000000-0000-0000-0000-000000000001', match_id: '5a000000-0000-0000-0000-000000000001', leg_number: 1,
      created_at: '2026-01-01T10:00:00+00:00', winner_player_id: '51000000-0000-0000-0000-000000000001',
    });
    expect(detail.matches[0]).toEqual({
      id: '5a000000-0000-0000-0000-000000000003', created_at: '2026-01-03T10:00:00+00:00', winner_player_id: null,
      start_score: '201', finish: 'single_out',
    });
    expect(detail.segments).toBe(sample.segments);
  });

  it('recognises a database without the stats functions', () => {
    expect(isMissingStatsFunction({ code: 'PGRST202', message: 'Could not find the function public.stats_overview' })).toBe(true);
    expect(isMissingStatsFunction({ code: '42883' })).toBe(true);
    expect(isMissingStatsFunction({ code: '57014' })).toBe(false);
    expect(isMissingStatsFunction(null)).toBe(false);
  });
});
