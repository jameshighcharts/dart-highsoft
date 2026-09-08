import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RematchPanel } from './RematchPanel';

const mocks = vi.hoisted(() => ({ start: vi.fn(), create: vi.fn(), open: vi.fn() }));
const players = [
  { id: 'alex', display_name: 'Alex', location: 'bergen' },
  { id: 'jamie', display_name: 'Jamie', location: 'vik' },
  { id: 'morgan', display_name: 'Morgan', location: 'sogndal' },
  { id: 'sam', display_name: 'Sam', location: null },
];
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: async () => ({
  from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: players, error: null }) }) }) }),
}) }));
vi.mock('@/lib/apiClient', () => ({ apiRequest: (...args: unknown[]) => mocks.create(...args) }));

beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });
afterEach(cleanup);
async function edit() {
  const user = userEvent.setup();
  render(<RematchPanel players={players.slice(0, 2)} gameLabel="301" minPlayers={2} maxPlayers={4} open onOpenChange={mocks.open} onStart={mocks.start} />);
  await user.click(screen.getByRole('button', { name: 'Edit players', exact: true }));
  await screen.findByRole('checkbox', { name: 'Alex' });
  return user;
}

describe('rematch player picker', () => {
  it('filters by location without dropping selected players', async () => {
    const user = await edit();
    await user.click(screen.getByRole('button', { name: 'Vik', exact: true }));
    expect(screen.queryByRole('checkbox', { name: 'Jamie' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Jamie' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Sam' })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('match-location-filter') ?? 'null')).toEqual(['bergen', 'sogndal']);
    await user.click(screen.getByRole('button', { name: 'Start rematch' }));
    expect(mocks.start).toHaveBeenCalledWith(['alex', 'jamie']);
  });

  it('combines saved locations and search, and clears the search', async () => {
    localStorage.setItem('match-location-filter', JSON.stringify(['bergen']));
    const user = await edit();
    expect(screen.queryByRole('checkbox', { name: 'Morgan' })).not.toBeInTheDocument();
    await user.type(screen.getByRole('searchbox', { name: 'Search players' }), 'Morgan');
    expect(screen.getByText('No players match your search in these locations.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sogndal', exact: true }));
    await user.click(screen.getByRole('checkbox', { name: 'Morgan' }));
    expect(screen.getByRole('button', { name: 'Remove Morgan' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear player search' }));
    expect(screen.getByRole('checkbox', { name: 'Alex' })).toBeChecked();
  });

  it('adds a new player to the lineup and clears the search', async () => {
    mocks.create.mockResolvedValue({ player: { id: 'robin', display_name: 'Robin' } });
    const user = await edit();
    await user.type(screen.getByRole('searchbox', { name: 'Search players' }), 'nobody');
    await user.type(screen.getByRole('textbox', { name: 'New player name' }), 'Robin');
    await user.click(screen.getByRole('button', { name: 'Add new player' }));
    expect(mocks.create).toHaveBeenCalledWith('/api/players', { body: { displayName: 'Robin' } });
    expect(screen.getByRole('checkbox', { name: 'Robin' })).toBeChecked();
    expect(screen.getByRole('searchbox', { name: 'Search players' })).toHaveValue('');
  });
});
