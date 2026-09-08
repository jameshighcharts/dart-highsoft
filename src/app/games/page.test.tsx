import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GAME_SESSION_STATUSES } from '@/lib/games/types';
import GamesPage from './page';
import { GameActivityHeatmap } from '@/components/games/GameActivityHeatmap';

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
  const result = { data: rowsByTable[table] ?? [], error: null };
  const query = {
    select: vi.fn(() => query),
    in: vi.fn((column: string, values: unknown[]) => {
      queryInCalls.push({ table, column, values });
      return query;
    }),
    or: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn(() => query),
    range: vi.fn((start: number, end: number) => {
      result.data = (rowsByTable[table] ?? []).slice(start, end + 1);
      return query;
    }),
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  };
  return query;
}

describe('GamesPage party-game history', () => {
  afterEach(cleanup);
  beforeEach(() => {
    queryInCalls.length = 0;
    getSupabaseClientMock.mockResolvedValue({
      from: (table: string) => makeQuery(table),
    });
  });

  it('finds players beyond the first page of history', async () => {
    const original = rowsByTable.game_sessions;
    rowsByTable.game_sessions = Array.from({ length: 501 }, (_, index) => ({
      id: `game-${index}`, mode: 'cricket', status: 'ended_early',
      created_at: new Date().toISOString(), winner_player_id: null,
      game_session_players: [{ play_order: 0, players: { id: `player-${index}`, display_name: index === 500 ? 'Older player' : 'Ada' } }],
    }));
    try {
      render(<GamesPage />);
      await screen.findByRole('textbox', { name: 'Search by player' });
      fireEvent.change(screen.getByRole('textbox', { name: 'Search by player' }), { target: { value: 'Older player' } });
      expect(screen.getByText('Older player')).toBeInTheDocument();
      expect(screen.getByText(/1 game since September 2026/)).toBeInTheDocument();
    } finally {
      rowsByTable.game_sessions = original;
    }
  });

  it('filters games and activity by player and clears the search', async () => {
    render(<GamesPage />);
    await screen.findByText('Ada');
    const search = screen.getByRole('textbox', { name: 'Search by player' });
    fireEvent.change(search, { target: { value: '  ADA  ' } });
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByText(/1 game since September 2026/)).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'Nobody' } });
    expect(screen.queryByText('Ada')).not.toBeInTheDocument();
    expect(screen.getByText('No completed games match your filters')).toBeInTheDocument();
    expect(screen.getByText(/0 games since September 2026/)).toBeInTheDocument();
    fireEvent.change(search, { target: { value: '' } });
    expect(screen.getByText('Ada')).toBeInTheDocument();
  });

  it('filters history by a heatmap day and clears the date', async () => {
    render(<GamesPage />);
    await screen.findByText('Ada');
    const emptyDay = screen.getAllByRole('button', { name: /: 0 games$/ })[0];
    fireEvent.click(emptyDay);
    expect(screen.queryByText('Ada')).not.toBeInTheDocument();
    expect(emptyDay).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Clear date' }));
    expect(screen.getByText('Ada')).toBeInTheDocument();
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


describe('Game activity calendar', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('starts in September with Monday first and adds only elapsed days', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 8, 12));
    const props = {
      dates: [new Date(2026, 7, 31, 12).toISOString(), new Date(2026, 8, 1, 12).toISOString(), new Date(2026, 8, 9, 12).toISOString()],
      selectedDate: null,
      onSelectDate: vi.fn(),
    };
    const { rerender } = render(<GameActivityHeatmap {...props} />);
    expect(screen.getAllByRole('button')).toHaveLength(8);
    expect(screen.getByText(/1 game since September 2026/)).toBeInTheDocument();
    const labels = screen.getByText('Mon').parentElement;
    expect(labels?.textContent).toBe('MonWedFri');
    const firstDay = screen.getAllByRole('button')[0];
    expect(firstDay).toHaveAccessibleName(/September 1, 2026/);
    expect(firstDay.parentElement?.children[1].tagName).toBe('SPAN');
    vi.setSystemTime(new Date(2026, 8, 9, 12));
    rerender(<GameActivityHeatmap {...props} />);
    expect(screen.getAllByRole('button')).toHaveLength(9);
    expect(screen.getByText(/2 games since September 2026/)).toBeInTheDocument();
  });
});
