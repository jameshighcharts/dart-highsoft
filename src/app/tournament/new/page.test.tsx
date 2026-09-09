import { act, cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import NewTournamentPage from './page';
import { LOCATIONS } from '@/utils/locations';

const mocks = vi.hoisted(() => ({ api: vi.fn(), push: vi.fn() }));
vi.mock('@/lib/apiClient', () => ({ apiRequest: mocks.api }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.api.mockImplementation(async (path: string) => path === '/api/scolia/boards/available'
    ? { boards: [{ id: 'board', name: 'Bergen', selectable: true, workerConnectionStatus: 'connected', boardStatus: 'Ready', activeMatchId: null, activeGameSessionId: null }] }
    : { tournamentId: 'created' });
});
vi.mock('@/hooks/useScoliaBoardRealtime', () => ({ useScoliaBoardRealtime: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/supabaseClient', () => ({
  getSupabaseClient: async () => ({ from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: [{ id: "a", display_name: "Alice", location: null }, { id: "b", display_name: "Bob", location: null }, { id: "c", display_name: "Carol", location: null }] }) }) }) }) }),
}));

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

it('hydrates identical location buttons before restoring the saved filter without overwriting it', async () => {
  const saved = JSON.stringify([LOCATIONS[0].value]);
  localStorage.setItem('match-location-filter', saved);
  const writes = vi.spyOn(Storage.prototype, 'setItem');
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const container = document.createElement('div');
  container.innerHTML = renderToString(<NewTournamentPage />);
  document.body.appendChild(container);
  const recoverable = vi.fn();
  let root: ReturnType<typeof hydrateRoot>;
  try {
    await act(async () => { root = hydrateRoot(container, <NewTournamentPage />, { onRecoverableError: recoverable }); });
    expect(screen.getByRole('button', { name: LOCATIONS[0].label })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: LOCATIONS[1].label })).toHaveAttribute('aria-pressed', 'false');
    expect(localStorage.getItem('match-location-filter')).toBe(saved);
    expect(writes.mock.calls.filter(([key]) => key === 'match-location-filter').every(([, value]) => value === saved)).toBe(true);
    expect(recoverable).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
  } finally {
    await act(async () => { root!.unmount(); });
    container.remove();
  }
});

it('restores an intentionally empty location selection', async () => {
  localStorage.setItem('match-location-filter', '[]');
  await act(async () => { render(<NewTournamentPage />); });
  for (const location of LOCATIONS) {
    expect(screen.getByRole('button', { name: location.label })).toHaveAttribute('aria-pressed', 'false');
  }
  expect(localStorage.getItem('match-location-filter')).toBe('[]');
});

it('restores saved board/commentary and includes them in tournament creation', async () => {
  localStorage.setItem('new-match-board', 'board');
  localStorage.setItem('tournament-auto-commentary', 'true');
  render(<NewTournamentPage />);
  await screen.findByRole('button', { name: 'Alice' });
  expect(screen.getByRole('switch', { name: 'Commentary' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('combobox', { name: 'Board' })).toHaveTextContent('Scolia Bergen');
  fireEvent.change(screen.getByRole('textbox', { name: 'Tournament name' }), { target: { value: 'Office Cup' } });
  for (const name of ['Alice', 'Bob', 'Carol']) fireEvent.click(screen.getByRole('button', { name }));
  fireEvent.click(screen.getByRole('button', { name: 'Start Tournament' }));
  await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('/api/tournaments', { body: expect.objectContaining({ scoliaBoardId: 'board', commentaryEnabled: true, playerIds: ['a', 'b', 'c'] }) }));
  expect(mocks.push).toHaveBeenCalledWith('/tournament/created');
});
