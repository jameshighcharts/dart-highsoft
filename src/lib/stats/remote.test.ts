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
import {
  NOW, PLAYERS, buildHistory, byTimeThenId, legacyView, playerDetailPayload, segmentSummary,
} from './testHistory';
import type { LegRow, MatchRow, PlayerSegmentRow, ThrowRow, TurnRow } from './types';

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
