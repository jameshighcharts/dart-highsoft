import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GridOptions } from '@highcharts/grid-pro-react';
import { GridLeaderboard } from './GridLeaderboard';

vi.mock('@highcharts/grid-pro/css/grid-pro.css', () => ({}));
vi.mock('@highcharts/grid-pro-react', () => ({
  Grid: ({ options }: { options: GridOptions }) => (
    <output data-testid="leaderboard">{JSON.stringify(options.dataTable?.columns)}</output>
  ),
}));
vi.mock('@highcharts/grid-pro/es-modules/Grid/Pro/CellRendering/Renderers/SparklineRenderer', () => ({
  default: { useHighcharts: vi.fn() },
}));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: undefined }) }));
vi.mock('@/hooks/useLeaderboardData', () => ({
  useLeaderboardData: () => ({
    leaders: [0, 1, 2, 3, 4].map((count) => ({
      player_id: `player-${count}`, display_name: `Player ${count}`, wins: 0, avg_per_turn: 30,
    })),
    eloLeaders: [0, 1, 2, 3, 4, 5].map((count) => ({
      player_id: `player-${count}`, display_name: `Player ${count}`, current_rating: 1200 + count,
    })),
    eloMultiLeaders: [],
    playerGameStats: new Map([1, 2, 3, 4, 5].map((count) => [
      `player-${count}`, { games_played: count, game_win_rate: 0 },
    ])),
    recentWinsByPlayer: new Map(),
    playerLocations: new Map(),
    playerAvatarUrls: new Map(),
    weeklyEloClimber: null,
    matchActivity: {
      sevenDayCounts: [], sevenDayTotal: 0, sevenDayDelta: 0,
      thirtyDayCounts: [], thirtyDayTotal: 0, thirtyDayDelta: 0,
    },
    loading: false,
  }),
}));

describe('home leaderboard qualification', () => {
  it('shows players and Elo only after three completed matches, including Elo-only entries', () => {
    render(<GridLeaderboard />);
    const columns = JSON.parse(screen.getByTestId('leaderboard').textContent ?? '{}');
    expect(columns.playerId).toEqual(['player-3', 'player-4', 'player-5']);
    expect(columns.elo1v1).toEqual([1203, 1204, 1205]);
  });
});
