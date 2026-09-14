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
