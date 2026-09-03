import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GAME_SESSION_STATUSES } from '@/lib/games/types';
import GamesPage from './page';

const getSupabaseClientMock = vi.fn();
const queryInCalls: Array<{ table: string; column: string; values: unknown[] }> = [];

vi.mock('@/lib/supabaseClient', () => ({
  getSupabaseClient: () => getSupabaseClientMock(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const rowsByTable: Record<string, unknown[]> = {
  matches: [],
  game_sessions: [
    {
      id: 'game-ended',
      mode: 'cricket',
      status: 'ended_early',
      created_at: new Date().toISOString(),
      winner_player_id: null,
      game_session_players: [
        { play_order: 0, players: { id: 'player-one', display_name: 'Ada' } },
      ],
    },
  ],
  tournaments: [],
  tournament_players: [],
};

function makeQuery(table: string) {
  const result = { data: rowsByTable[table] ?? [] };
  const query = {
    select: vi.fn(() => query),
    in: vi.fn((column: string, values: unknown[]) => {
      queryInCalls.push({ table, column, values });
      return query;
    }),
    or: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn(() => query),
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  };
  return query;
}

describe('GamesPage party-game history', () => {
  beforeEach(() => {
    queryInCalls.length = 0;
    getSupabaseClientMock.mockResolvedValue({
      from: (table: string) => makeQuery(table),
    });
  });

  it('loads and labels sessions that ended early', async () => {
    render(<GamesPage />);

    expect(await screen.findByText('Ended early')).toBeInTheDocument();
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Recent Games' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View' })).toHaveAttribute('href', '/game/game-ended');
    expect(screen.queryByText('No winner')).not.toBeInTheDocument();

    await waitFor(() => {
      expect(queryInCalls).toContainEqual({
        table: 'game_sessions',
        column: 'status',
        values: [...GAME_SESSION_STATUSES],
      });
    });
  });
});
