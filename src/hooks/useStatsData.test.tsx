import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestQueryClient } from '@/test-utils/renderWithProviders';

type Result = { data?: unknown; error?: { code: string; message: string } | null; count?: number };

const { db } = vi.hoisted(() => ({
  db: {
    tables: {} as Record<string, Result>,
    rpcs: {} as Record<string, Result>,
    calls: [] as string[],
  },
}));

/** A chainable PostgREST stand-in: every filter returns itself, awaiting it yields the table's result. */
function query(table: string) {
  const result = db.tables[table] ?? { data: [] };
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'order', 'eq', 'limit', 'in']) chain[method] = () => chain;
  chain.then = (resolve: (value: Result) => unknown) => resolve({ error: null, ...result });
  return chain;
}

vi.mock('@/lib/supabaseClient', () => ({
  getSupabaseClient: async () => ({
    from: (table: string) => { db.calls.push(`from:${table}`); return query(table); },
    rpc: async (name: string) => { db.calls.push(`rpc:${name}`); return { error: null, ...(db.rpcs[name] ?? { data: null }) }; },
  }),
}));

import { statsGlobalQuery, useStatsData } from './useStatsData';

const missing = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
const overview = {
  total_matches: 2, completed_matches: 1, total_legs: 3, total_turns: 9, total_throws: 25,
  first_match_at: '2026-10-01T10:00:00+00:00', last_match_at: '2026-10-03T10:00:00+00:00',
};
const ada = '00000000-0000-0000-0000-00000000000a';
const legacyMatches = [
  { id: 'm1', created_at: '2026-10-01T10:00:00+00:00', winner_player_id: ada, start_score: '501', finish: 'double_out' },
  { id: 'm2', created_at: '2026-10-03T10:00:00+00:00', winner_player_id: null, start_score: '301', finish: 'single_out' },
];
const legacyLegs = [
  { id: 'l1', match_id: 'm1', leg_number: 1, created_at: '2026-10-01T10:00:00+00:00', winner_player_id: ada },
  { id: 'l2', match_id: 'm1', leg_number: 2, created_at: '2026-10-01T10:20:00+00:00', winner_player_id: null },
  { id: 'l3', match_id: 'm2', leg_number: 1, created_at: '2026-10-03T10:00:00+00:00', winner_player_id: null },
];
const turn = { id: 't1', leg_id: 'l1', player_id: ada, total_scored: 60, busted: false, turn_number: 1, created_at: '2026-10-01T10:01:00+00:00' };

function renderStats(client = createTestQueryClient()) {
  return renderHook(() => useStatsData(), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
}

beforeEach(() => {
  db.tables = {
    player_summary: { data: [{ player_id: ada, display_name: 'Ada', wins: 1, avg_per_turn: 60 }] },
    players: { data: [{ id: ada, display_name: 'Ada', avatar_url: null }] },
    legs: { data: legacyLegs },
    matches: { data: legacyMatches },
    turns: { data: [turn], count: 9 },
    throws: { data: [{ id: 'x1', turn_id: 't1', dart_index: 1, segment: 'T20', scored: 60 }], count: 25 },
    player_segment_summary: { data: [] },
    player_adjacency_stats: { data: [] },
  };
  db.rpcs = {};
  db.calls = [];
});

describe('useStatsData', () => {
  it('reads the totals and one player’s rows from the stats functions, never the whole history', async () => {
    db.rpcs.stats_overview = { data: overview };
    db.rpcs.stats_player_detail = {
      data: {
        turns: [['t1', 'l1', 60, false, 1, '2026-10-01T10:01:00+00:00', [[1, 'T20', 60]]]],
        legs: [['l1', 'm1', 1, '2026-10-01T10:00:00+00:00', ada]],
        matches: [['m1', '2026-10-01T10:00:00+00:00', ada, '501', 'double_out']],
        segments: [], adjacency: [],
      },
    };
    const { result } = renderStats();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.overallStats).toEqual({
      totalMatches: 2, totalLegs: 3, totalTurns: 9, totalThrows: 25, completedMatches: 1, avgTurnsPerLeg: 3, avgThrowsPerTurn: 2.8,
    });
    expect(result.current.gamesPerDay).toBe(1);

    act(() => result.current.setSelectedPlayer(ada));
    await waitFor(() => expect(result.current.playerCoreStats?.totalTurns).toBe(1));
    expect(result.current.playerCoreStats).toMatchObject({ legsWon: 1, matchesWon: 1, gamesPlayed: 1, legsPlayed: 1, totalThrows: 1 });
    expect(db.calls).not.toContain('from:legs');
    expect(db.calls).not.toContain('from:matches');
    expect(db.calls).not.toContain('from:throws');
    expect(result.current.dataLimitWarnings.anyWarning).toBe(false);
  });

  it('falls back to the full history until the stats functions are deployed', async () => {
    db.rpcs.stats_overview = missing;
    db.rpcs.stats_player_detail = missing;
    const { result } = renderStats();
    await waitFor(() => expect(result.current.overallStats.totalLegs).toBe(3));
    expect(result.current.overallStats).toEqual({
      totalMatches: 2, totalLegs: 3, totalTurns: 9, totalThrows: 25, completedMatches: 1, avgTurnsPerLeg: 3, avgThrowsPerTurn: 2.8,
    });
    expect(result.current.gamesPerDay).toBe(1);

    act(() => result.current.setSelectedPlayer(ada));
    await waitFor(() => expect(result.current.playerCoreStats?.totalTurns).toBe(1));
    expect(result.current.playerCoreStats).toMatchObject({ legsWon: 1, matchesWon: 1, gamesPlayed: 1, legsPlayed: 1, totalThrows: 1 });
    expect(db.calls).toContain('from:throws');
  });

  it('shows cached totals at once, before any request answers', () => {
    const client = createTestQueryClient();
    client.setQueryData(statsGlobalQuery().queryKey, {
      summary: [], players: [{ id: ada, display_name: 'Ada' }],
      overview: { totalMatches: 2, completedMatches: 1, totalLegs: 3, totalTurns: 9, totalThrows: 25, firstMatchAt: null, lastMatchAt: null },
    });
    db.rpcs.stats_overview = { data: overview };
    const { result } = renderStats(client);
    expect(result.current.loading).toBe(false);
    expect(result.current.overallStats.totalLegs).toBe(3);
    expect(result.current.players).toHaveLength(1);
  });

  it('keeps the overview small enough to restore from storage', () => {
    expect(statsGlobalQuery().meta).toEqual({ persist: true });
  });
});
