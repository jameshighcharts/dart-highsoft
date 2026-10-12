import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { leaderboardListsQuery } from '@/hooks/useLeaderboardData';
import {
  bullersQuery,
  gameModeLeadersQuery,
  highestCheckoutsQuery,
  quickestLegsQuery,
  topRoundScoresQuery,
} from '@/lib/queries/leaderboards';
import LeaderboardsPage from './page';

// Every query hangs, so anything on screen came from the cache.
const { pending } = vi.hoisted(() => {
  const pending: unknown = new Proxy(() => {}, {
    get: (_target, prop) => (prop === 'then' ? (() => {}) : pending),
    apply: () => pending,
  });
  return { pending };
});
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: async () => pending }));

afterEach(() => cleanup());

it('shows every leaderboard cached from an earlier visit without waiting for a fetch', () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const player = (name: string) => ({ player_id: `${name}-id`, display_name: name });
  client.setQueryData(leaderboardListsQuery(10).queryKey, {
    leaders: [{ ...player('Winner'), wins: 9, avg_per_turn: 50 }],
    avgLeaders: [],
    eloLeaders: [],
    eloMultiLeaders: [],
  });
  client.setQueryData(bullersQuery().queryKey, [{ ...player('Buller'), measured_darts: 4, misses: 0, bull_offs: 2, average_inches: 1.2 }]);
  client.setQueryData(topRoundScoresQuery().queryKey, [{ id: 't1', ...player('Topscorer'), total_scored: 180, created_at: '2026-10-01T10:00:00Z', leg_id: 'l1', match_id: 'm1' }]);
  client.setQueryData(highestCheckoutsQuery().queryKey, [{ ...player('Checkouter'), score: 170, date: '2026-10-01T10:00:00Z', darts_used: 3 }]);
  client.setQueryData(quickestLegsQuery().queryKey, {
    double: [{ ...player('Doubler'), dart_count: 9, date: '2026-10-01T10:00:00Z', start_score: '501' }],
    single: [{ ...player('Singler'), dart_count: 6, date: '2026-10-01T10:00:00Z', start_score: '301' }],
  });
  client.setQueryData(gameModeLeadersQuery().queryKey, {
    cricket: [{ ...player('Cricketer'), games_played: 3, wins: 2, win_rate: 66 }],
    killer: [], shanghai: [], around_the_clock: [],
  });

  render(<QueryClientProvider client={client}><LeaderboardsPage /></QueryClientProvider>);

  for (const name of ['Winner', 'Buller', 'Topscorer', 'Checkouter', 'Doubler', 'Singler', 'Cricketer']) {
    expect(screen.getAllByText(name).length).toBeGreaterThan(0);
  }
  expect(screen.queryByText(/Loading/)).not.toBeInTheDocument();
});
