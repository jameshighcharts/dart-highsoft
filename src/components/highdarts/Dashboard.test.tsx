import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import type { FixtureResult, Snapshot } from '@/lib/highdarts/standings';
import { fixture, finish } from '@/test-utils/highdartsFixtures';
import { HighdartsDashboard } from './Dashboard';
const snapshot = { fixtures: [], players: [] };
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('refreshes results and the linked player with GET, preserving the required tab order', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => snapshot });
  vi.stubGlobal('fetch', fetch);
  render(<HighdartsDashboard initial={snapshot} isAdmin={false} />);
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      '/api/highdarts',
      expect.objectContaining({ method: 'GET' }),
    ),
  );
  expect(fetch).toHaveBeenCalledWith(
    '/api/me',
    expect.objectContaining({ method: 'GET' }),
  );
  expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
    "How's it going",
    'Tabell',
    'Sluttspill',
    'Sheet',
  ]);
  await act(async () => {});
});

function openFixture(
  no: number,
  office: 'bergen' | 'vik' = 'bergen',
): FixtureResult {
  return {
    id: `${office}-${no}`,
    event_id: 'event',
    office,
    stage: 'group',
    fixture_no: no,
    player_a_id: null,
    player_b_id: null,
    player_a_name: `${office} player ${no}`,
    player_b_name: 'Opponent',
    match_id: null,
    match: null,
  };
}
function renderFixtures() {
  const data: Snapshot = {
    players: [],
    fixtures: [
      ...Array.from({ length: 8 }, (_, i) => openFixture(i + 1)),
      openFixture(1, 'vik'),
    ],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => data }),
  );
  render(<HighdartsDashboard initial={data} isAdmin={false} />);
  return within(screen.getByRole('region', { name: 'Upcoming fixtures' }));
}
it('paginates one office and resets the page when switching office', async () => {
  const list = renderFixtures();
  expect(list.getByText('1–6 of 8 fixtures')).toBeInTheDocument();
  expect(list.queryByText('bergen player 7')).not.toBeInTheDocument();
  fireEvent.click(list.getByRole('button', { name: 'Next fixtures' }));
  expect(list.getByText('7–8 of 8 fixtures')).toBeInTheDocument();
  fireEvent.click(list.getByRole('button', { name: 'Vik' }));
  expect(list.getAllByTitle('vik player 1').length).toBeGreaterThan(0);
  expect(list.getByText('1–1 of 1 fixtures')).toBeInTheDocument();
  expect(
    list.getByRole('button', { name: 'Previous fixtures' }),
  ).toBeDisabled();
  await act(async () => {});
});
it('searches fixtures and resets pagination rather than showing an empty later page', async () => {
  const list = renderFixtures();
  fireEvent.click(list.getByRole('button', { name: 'Next fixtures' }));
  fireEvent.change(list.getByRole('textbox', { name: 'Search fixtures' }), {
    target: { value: 'BERGEN player 2' },
  });
  expect(list.getAllByTitle('bergen player 2').length).toBeGreaterThan(0);
  expect(list.queryByText('bergen player 8')).not.toBeInTheDocument();
  expect(list.getByText('1–1 of 1 fixtures')).toBeInTheDocument();
  fireEvent.change(list.getByRole('textbox', { name: 'Search fixtures' }), {
    target: { value: 'Missing name' },
  });
  expect(list.getByText('No fixtures match this search.')).toBeInTheDocument();
  await act(async () => {});
});
it('keeps an unplayed tournament free of result and qualification claims', async () => {
  renderFixtures();
  expect(screen.getByText('No results yet')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('tab', { name: 'Tabell' }));
  expect(screen.queryByText('Tied for 4th')).not.toBeInTheDocument();
  expect(screen.queryByText('Bye')).not.toBeInTheDocument();
  expect(screen.getAllByText('Awaiting results')).toHaveLength(2);
});

it('keeps the two reported scores visible after refresh with leg totals and unknown averages', async () => {
  const data: Snapshot = { players: [], fixtures: [
    fixture('sogndal', 'Sindre Jensen', 'Jon Skjerdal', 1),
    fixture('sogndal', 'Johan Flo', 'Jon Skjerdal', 12),
    fixture('sogndal', 'Jon Skjerdal', 'Johan Flo', 13),
  ] };
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => data });
  vi.stubGlobal('fetch', fetch);
  render(<HighdartsDashboard initial={data} isAdmin={false} />);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(screen.getAllByText('Reported result')).toHaveLength(2);
  expect(screen.getByRole('progressbar', { name: 'Fixtures completed' })).toHaveAttribute('aria-valuenow', '2');
  expect(screen.getAllByText('Leg breakdowns')).toHaveLength(2);
  expect(screen.getByText('Leg 3 · Sindre Jensen won')).toBeInTheDocument();
  expect(screen.getByText('Leg 3 · Jon Skjerdal won')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'View result' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('tab', { name: 'Tabell' }));
  const table = screen.getByRole('table', { name: 'Sogndal standings' });
  expect(within(table).getAllByText('—')).toHaveLength(3);
});

it('replaces a reported result with the real active match on refresh without offering a duplicate start', async () => {
  const data: Snapshot = { players: [], fixtures: [
    fixture('sogndal', 'Sindre Jensen', 'Jon Skjerdal', 1),
    fixture('sogndal', 'Johan Flo', 'Jon Skjerdal', 12),
  ] };
  const active: Snapshot = { ...data, fixtures: [data.fixtures[0], { ...data.fixtures[1], match_id: 'canonical-live' }] };
  const fetch = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => data })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ player: { id: 'Jon Skjerdal' } }) })
    .mockResolvedValue({ ok: true, json: async () => active });
  vi.stubGlobal('fetch', fetch);
  render(<HighdartsDashboard initial={data} isAdmin={false} />);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(screen.getAllByText('Reported result')).toHaveLength(2);
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(screen.getAllByText('Reported result')).toHaveLength(1);
  expect(screen.getByRole('progressbar', { name: 'Fixtures completed' })).toHaveAttribute('aria-valuenow', '1');
  expect(screen.getByRole('link', { name: 'Watch live' })).toHaveAttribute('href', '/match/canonical-live');
  expect(screen.queryByRole('link', { name: /Start.*Johan/ })).not.toBeInTheDocument();
});

it('shows only ongoing matches in the header and removes them when finished', async () => {
  const live = { ...finish(fixture('bergen', 'Ada', 'Ben'), 'Ada'), match_id: 'live-match' };
  live.match = { ...live.match!, completed_at: null, winner_player_id: null };
  const paused = { ...finish(fixture('vik', 'Cara', 'Dan'), 'Cara'), match_id: 'paused-match' };
  paused.match = { ...paused.match!, completed_at: null, winner_player_id: null, paused_at: '2026-09-15T10:00:00Z' };
  const ended = finish(fixture('bergen', 'Eve', 'Finn', 2), 'Eve');
  ended.match = { ...ended.match!, ended_early: true };
  const done = finish(fixture('vik', 'Gia', 'Hal', 2), 'Gia');
  const data: Snapshot = { players: [], fixtures: [live, paused, ended, done] };
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => data });
  vi.stubGlobal('fetch', fetch);
  render(<HighdartsDashboard initial={data} isAdmin={false} />);
  const status = within(screen.getByRole('region', { name: 'Tournament match status' }));
  expect(within(screen.getByLabelText('Live games')).getByText('1')).toBeInTheDocument();
  expect(status.getByText('Bergen')).toBeInTheDocument();
  expect(status.queryByRole('heading')).not.toBeInTheDocument();
  expect(status.queryByText(/played/)).not.toBeInTheDocument();
  expect(status.getByRole('link', { name: 'Live: Bergen #1' })).toHaveAttribute('href', '/match/live-match?spectator=true');
  expect(status.getByRole('link', { name: 'Paused: Vik #1' })).toBeInTheDocument();
  expect(status.queryByText(/Finished games/)).not.toBeInTheDocument();
  expect(status.queryByText('Gia')).not.toBeInTheDocument();
  expect(status.queryByText('Eve')).not.toBeInTheDocument();
  await act(async () => {});
  const updated = { ...data, fixtures: [finish(live, 'Ada'), finish(paused, 'Cara'), ended, done] };
  fetch.mockResolvedValue({ ok: true, json: async () => updated });
  fireEvent.focus(window);
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Tournament match status' })).not.toBeInTheDocument());
  expect(screen.queryByText('No games in progress.')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Live games')).not.toBeInTheDocument();
});

it('shows tournament status for six-fixture players while retaining their counting controls', async () => {
  const sindre = Array.from({ length: 6 }, (_, n) => fixture('sogndal', 'Sindre', `Opponent ${n}`, n + 1));
  sindre[0] = finish(sindre[0], 'Sindre');
  const data: Snapshot = { players: [], fixtures: [
    ...sindre,
    ...Array.from({ length: 6 }, (_, n) => fixture('vik', 'Gjertrud', `Vik opponent ${n}`, n + 1)),
  ] };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => data }));
  render(<HighdartsDashboard initial={data} isAdmin={false} />);
  await userEvent.click(screen.getByRole('tab', { name: 'Tabell' }));
  const sogndal = within(screen.getByRole('table', { name: 'Sogndal standings' }));
  const vik = within(screen.getByRole('table', { name: 'Vik standings' }));
  expect(within(sogndal.getByRole('row', { name: /Sindre/ })).getByText('Bye')).toBeInTheDocument();
  expect(within(vik.getByRole('row', { name: /Gjertrud/ })).getByText('Not started')).toBeInTheDocument();
  expect(screen.queryByText('Choose 1 to exclude')).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Counting matches' })).toBeInTheDocument();
});
