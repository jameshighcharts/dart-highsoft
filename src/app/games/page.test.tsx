import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GAME_SESSION_STATUSES } from '@/lib/games/types';
import {
  browserTimeZone,
  gameDateKey,
  gamesActivityQuery,
  liveGamesQuery,
  recentGamesQuery,
  RECENT_PAGE_SIZE,
  tournamentsQuery,
  type FeedRow,
  type RecentGames,
} from '@/lib/queries/games';
import { TestQueryProvider } from '@/test-utils/renderWithProviders';
import GamesPage from './page';
import { GameActivityHeatmap } from '@/components/games/GameActivityHeatmap';

const renderGamesPage = () => render(<TestQueryProvider><GamesPage /></TestQueryProvider>);

const getSupabaseClientMock = vi.fn();
const queryInCalls: Array<{ table: string; column: string; values: unknown[] }> = [];
const queriedTables: string[] = [];
const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
let rpcImpl: (name: string, args: Record<string, unknown>) => { data: unknown; error: { code: string; message: string } | null };
const featureMissing = () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });

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
  queriedTables.push(table);
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

function mockSupabase() {
  getSupabaseClientMock.mockResolvedValue({
    from: (table: string) => makeQuery(table),
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return rpcImpl(name, args);
    },
  });
}

beforeEach(() => {
  queryInCalls.length = 0;
  queriedTables.length = 0;
  rpcCalls.length = 0;
  rpcImpl = featureMissing;
  mockSupabase();
});

describe('GamesPage before the games feed migration is deployed', () => {
  afterEach(cleanup);

  it('finds players beyond the first page of history', async () => {
    const original = rowsByTable.game_sessions;
    rowsByTable.game_sessions = Array.from({ length: 501 }, (_, index) => ({
      id: `game-${index}`, mode: 'cricket', status: 'ended_early',
      created_at: new Date().toISOString(), winner_player_id: null,
      game_session_players: [{ play_order: 0, players: { id: `player-${index}`, display_name: index === 500 ? 'Older player' : 'Ada' } }],
    }));
    try {
      renderGamesPage();
      await screen.findByRole('textbox', { name: 'Search by player' });
      fireEvent.change(screen.getByRole('textbox', { name: 'Search by player' }), { target: { value: 'Older player' } });
      expect(await screen.findByText('Older player')).toBeInTheDocument();
      expect(await screen.findByText(/1 game since September 2026/)).toBeInTheDocument();
    } finally {
      rowsByTable.game_sessions = original;
    }
  });

  it('filters games and activity by player and clears the search', async () => {
    renderGamesPage();
    await screen.findByText('Ada');
    const search = screen.getByRole('textbox', { name: 'Search by player' });
    fireEvent.change(search, { target: { value: '  ADA  ' } });
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(await screen.findByText(/1 game since September 2026/)).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'Nobody' } });
    expect(await screen.findByText('No completed games match your filters')).toBeInTheDocument();
    expect(screen.queryByText('Ada')).not.toBeInTheDocument();
    expect(await screen.findByText(/0 games since September 2026/)).toBeInTheDocument();
    fireEvent.change(search, { target: { value: '' } });
    expect(await screen.findByText('Ada')).toBeInTheDocument();
  });

  it('filters history by a heatmap day and clears the date', async () => {
    renderGamesPage();
    await screen.findByText('Ada');
    const emptyDay = screen.getAllByRole('button', { name: /: 0 games$/ })[0];
    fireEvent.click(emptyDay);
    await waitFor(() => expect(screen.queryByText('Ada')).not.toBeInTheDocument());
    expect(emptyDay).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Clear date' }));
    expect(await screen.findByText('Ada')).toBeInTheDocument();
  });

  it('loads tournaments with their player counts in one request', async () => {
    rowsByTable.tournaments = [{
      id: 't1', name: 'Friday cup', status: 'in_progress', start_score: '501', finish: 'double_out',
      legs_to_win: 2, created_at: new Date().toISOString(), tournament_players: [{ count: 3 }],
    }];
    try {
      renderGamesPage();
      expect(await screen.findByText('Friday cup')).toBeInTheDocument();
      expect(screen.getByText('3 players')).toBeInTheDocument();
      expect(queriedTables).not.toContain('tournament_players');
    } finally {
      rowsByTable.tournaments = [];
    }
  });

  it('loads and labels sessions that ended early', async () => {
    renderGamesPage();

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

  it('downloads the old full history only once for all sections', async () => {
    renderGamesPage();
    await screen.findByText('Ada');
    await screen.findByText(/1 game since September 2026/);
    expect(queriedTables.filter((table) => table === 'game_sessions')).toHaveLength(1);
  });
});

const now = Date.now();
const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
const player = (id: string, display_name: string, play_order: number) => ({ id, display_name, avatar_url: null, play_order });

function feedMatch(id: string, minutesAgo: number, overrides: Partial<FeedRow> = {}): FeedRow {
  return {
    kind: 'match', id, created_at: iso(minutesAgo), mode: 'x01', start_score: '501', finish: 'double_out', legs_to_win: 2,
    winner_player_id: 'p-bea', completed_at: iso(minutesAgo - 10), ended_early: false, status: null, legs_won: 2,
    players: [player('p-al', `Al ${id}`, 0), player('p-bea', 'Bea', 1)],
    ...overrides,
  };
}

describe('GamesPage with the games feed', () => {
  afterEach(cleanup);

  const live = feedMatch('live-match', 5, { winner_player_id: null, completed_at: null, legs_won: 1 });
  const finished = Array.from({ length: 45 }, (_, index) => feedMatch(`done-${index}`, 60 + index));

  beforeEach(() => {
    rpcImpl = (name, args) => {
      if (name === 'games_activity') return { data: [{ day: gameDateKey(new Date(now)), games: 46 }], error: null };
      if (name === 'games_live') return { data: [live], error: null };
      const search = String(args.p_search ?? '').toLowerCase();
      const rows = finished.filter((row) => row.players.some((p) => p.display_name.toLowerCase().includes(search)));
      // Keyset: the page starts right after the cursor row.
      const start = args.p_before_id ? rows.findIndex((row) => row.id === args.p_before_id) + 1 : 0;
      return { data: rows.slice(start, start + Number(args.p_limit)), error: null };
    };
  });

  it('asks the database for one page of finished games instead of the whole history', async () => {
    renderGamesPage();
    expect(await screen.findByText('Al done-0')).toBeInTheDocument();
    expect(screen.getByText('Al live-match')).toBeInTheDocument();
    expect(screen.getByText('1/3 legs')).toBeInTheDocument();
    expect(screen.queryByText('Al done-20')).not.toBeInTheDocument();
    expect(await screen.findByText(/46 games since September 2026/)).toBeInTheDocument();
    expect(queriedTables).not.toContain('matches');
    expect(queriedTables).not.toContain('game_sessions');
    expect(rpcCalls).toContainEqual({
      name: 'games_feed',
      args: {
        p_search: null, p_day: null, p_time_zone: browserTimeZone(), p_limit: RECENT_PAGE_SIZE + 1,
        p_before_created_at: null, p_before_kind: null, p_before_id: null,
      },
    });
    expect(rpcCalls).toContainEqual({ name: 'games_live', args: {} });
  });

  it('shows more games on request and stops when there are no more', async () => {
    renderGamesPage();
    await screen.findByText('Al done-19');
    fireEvent.click(screen.getByRole('button', { name: 'Show more games' }));
    expect(await screen.findByText('Al done-39')).toBeInTheDocument();
    expect(screen.getByText('Al done-0')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show more games' }));
    expect(await screen.findByText('Al done-44')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show more games' })).not.toBeInTheDocument();
    // Each "Show more" asks for the next page after the last row shown, never the whole list again.
    const pages = rpcCalls.filter((call) => call.name === 'games_feed');
    expect(pages.map((call) => [call.args.p_before_id, call.args.p_limit])).toEqual([
      [null, RECENT_PAGE_SIZE + 1], ['done-19', RECENT_PAGE_SIZE + 1], ['done-39', RECENT_PAGE_SIZE + 1],
    ]);
    expect(pages[1].args).toMatchObject({ p_before_kind: 'match', p_before_created_at: finished[19].created_at });
  });

  it('keeps only the first page cached after leaving, so a revisit refetches one page', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={queryClient}><GamesPage /></QueryClientProvider>);
    await screen.findByText('Al done-19');
    fireEvent.click(screen.getByRole('button', { name: 'Show more games' }));
    await screen.findByText('Al done-39');
    view.unmount();
    const cached = queryClient.getQueryData<RecentGames>(recentGamesQuery({ search: '', day: null, timeZone: browserTimeZone() }).queryKey);
    expect(cached?.pages).toHaveLength(1);
    expect(cached?.pages[0].games).toHaveLength(RECENT_PAGE_SIZE);
  });

  it('searches in the database once typing pauses, trimmed', async () => {
    renderGamesPage();
    await screen.findByText('Al done-0');
    fireEvent.change(screen.getByRole('textbox', { name: 'Search by player' }), { target: { value: '  done-3  ' } });
    expect(await screen.findByText('Al done-30')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Al done-0')).not.toBeInTheDocument());
    const searches = rpcCalls.filter((call) => call.args.p_search != null);
    expect(searches.map((call) => call.args.p_search)).toEqual(['done-3', 'done-3']);
    expect(searches.map((call) => call.name).sort()).toEqual(['games_activity', 'games_feed']);
  });
});

describe('GamesPage cache', () => {
  afterEach(cleanup);

  it('shows cached games at once while it refreshes them in the background', () => {
    const neverAnswers = new Promise(() => {});
    getSupabaseClientMock.mockReturnValue(neverAnswers);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const created_at = new Date().toISOString();
    const timeZone = browserTimeZone();
    const updatedAt = Date.now() - 60_000;
    queryClient.setQueryData(liveGamesQuery().queryKey, [], { updatedAt });
    queryClient.setQueryData(recentGamesQuery({ search: '', day: null, timeZone }).queryKey, {
      pages: [{
        games: [{
          kind: 'game', created_at,
          game: { id: 'cached-game', mode: 'cricket', status: 'ended_early', created_at, winner_player_id: null,
            players: [{ id: 'cached-player', display_name: 'Cached player', play_order: 0 }] },
        }],
        nextCursor: null,
      }],
      pageParams: [null],
    }, { updatedAt });
    queryClient.setQueryData(gamesActivityQuery({ search: '', timeZone }).queryKey, { [gameDateKey(new Date())]: 7 }, { updatedAt });
    queryClient.setQueryData(tournamentsQuery().queryKey, [{ id: 't1', name: 'Cached cup', status: 'in_progress', start_score: '501',
      finish: 'double_out', legs_to_win: 2, created_at, player_count: 4 }], { updatedAt });

    render(<QueryClientProvider client={queryClient}><GamesPage /></QueryClientProvider>);

    expect(screen.queryByText('Loading games...')).not.toBeInTheDocument();
    expect(screen.getByText('Cached player')).toBeInTheDocument();
    expect(screen.getByText('Cached cup')).toBeInTheDocument();
    expect(screen.getByText('4 players')).toBeInTheDocument();
    expect(screen.getByText(/7 games since September 2026/)).toBeInTheDocument();
    expect(getSupabaseClientMock).toHaveBeenCalled();
  });

  it('never restores live games from storage, and persists only the unfiltered lists', () => {
    const timeZone = browserTimeZone();
    expect(liveGamesQuery().meta?.persist).toBe(false);
    expect(recentGamesQuery({ search: '', day: null, timeZone }).meta?.persist).toBe(true);
    expect(recentGamesQuery({ search: 'ada', day: null, timeZone }).meta?.persist).toBe(false);
    expect(recentGamesQuery({ search: '', day: '2026-10-01', timeZone }).meta?.persist).toBe(false);
  });

  it('does not cache a failed tournaments load as an empty list', async () => {
    getSupabaseClientMock.mockResolvedValue({
      from: () => ({ select: () => ({ or: () => ({ order: () => ({ limit: async () => ({ data: null, error: { code: '57014', message: 'timeout' } }) }) }) }) }),
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await expect(queryClient.fetchQuery(tournamentsQuery())).rejects.toMatchObject({ code: '57014' });
    expect(queryClient.getQueryData(tournamentsQuery().queryKey)).toBeUndefined();
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
      activity: { '2026-08-31': 1, '2026-09-01': 1, '2026-09-09': 1 },
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

describe('Game deletion confirmation', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); rowsByTable.matches = []; });
  it('uses confirmation without requesting or sending a password', async () => {
    rowsByTable.matches = [{
      id: 'delete-me', legs: [], mode: 'x01', start_score: '301', finish: 'single_out', legs_to_win: 1,
      created_at: new Date().toISOString(), ended_early: true, completed_at: new Date().toISOString(), winner_player_id: null,
      match_players: [{ play_order: 0, players: { id: 'delete-player', display_name: 'Delete player' } }],
    }];
    const confirm = vi.fn().mockReturnValue(false);
    vi.stubGlobal('confirm', confirm);
    const prompt = vi.fn();
    vi.stubGlobal('prompt', prompt);
    const fetch = vi.fn().mockImplementation(async () => {
      rowsByTable.matches = [];
      return { ok: true };
    });
    vi.stubGlobal('fetch', fetch);
    renderGamesPage();
    const remove = await screen.findByRole('button', { name: 'Delete game' });
    fireEvent.click(remove);
    expect(fetch).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(remove);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/matches/delete-me', { method: 'DELETE' }));
    expect(prompt).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('Delete player')).not.toBeInTheDocument());
  });
});

describe('Games feed order', () => {
  afterEach(cleanup);

  it('lists the newest games first and a match before a party game started at the same moment', async () => {
    const at = iso(30);
    const game: FeedRow = { ...feedMatch('same-time-game', 30), kind: 'game', mode: 'cricket', status: 'completed',
      start_score: null, finish: null, legs_to_win: null, legs_won: null, created_at: at };
    rpcImpl = (name) => {
      if (name === 'games_activity' || name === 'games_live') return { data: [], error: null };
      // Deliberately out of order.
      return { data: [feedMatch('older', 90), game, { ...feedMatch('same-time-match', 30), created_at: at }, feedMatch('newest', 10)], error: null };
    };
    renderGamesPage();
    await screen.findByText('Al newest');
    const names = screen.getAllByText(/^Al (newest|older|same-time-match|same-time-game)$/).map((node) => node.textContent);
    expect(names).toEqual(['Al newest', 'Al same-time-match', 'Al same-time-game', 'Al older']);
  });
});
