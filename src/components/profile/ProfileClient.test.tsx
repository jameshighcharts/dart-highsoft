import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { apiRequest } from '@/lib/apiClient';
import { ProfileClient } from './ProfileClient';

afterEach(cleanup);

vi.mock('@/lib/apiClient', () => ({ apiRequest: vi.fn() }));
vi.mock('@/components/profile/ProfileSummaryCard', () => ({ ProfileSummaryCard: () => null }));
vi.mock('@/components/PlayerEloStats', () => ({ PlayerEloStats: () => null }));
vi.mock('@/components/PlayerMultiEloStats', () => ({ PlayerMultiEloStats: () => null }));

const player = { id: 'ada', display_name: 'Ada', nicknames: ['Ace'], avatar_url: null, location: null };
const user = { name: 'Ada', email: 'ada@example.com', isAdmin: false };

beforeEach(() => vi.resetAllMocks());

it('keeps the admin editor and admin API requests out of a member profile', async () => {
  vi.mocked(apiRequest).mockResolvedValueOnce({ player, user, unclaimedPlayers: [] });
  render(<ProfileClient />);
  await screen.findByRole('heading', { name: 'My profile' });
  expect(screen.queryByText('Player nicknames')).not.toBeInTheDocument();
  expect(apiRequest).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('Nicknames')).toHaveValue('Ace');
});

it('updates the own-profile nickname field when an admin edits their own player', async () => {
  vi.mocked(apiRequest)
    .mockResolvedValueOnce({ player, user: { ...user, isAdmin: true }, unclaimedPlayers: [] })
    .mockResolvedValueOnce({ players: [player] });
  render(<ProfileClient />);
  await screen.findByRole('option', { name: 'Ada' });
  fireEvent.change(screen.getByLabelText('Player'), { target: { value: 'ada' } });
  fireEvent.change(screen.getByLabelText('Nicknames for Ada'), { target: { value: 'The Ace' } });
  vi.mocked(apiRequest).mockResolvedValueOnce({ player: { ...player, nicknames: ['The Ace'] } });
  fireEvent.click(screen.getByRole('button', { name: 'Save nicknames' }));
  await screen.findByText('Nicknames saved for Ada.');
  expect(screen.getByLabelText('Nicknames')).toHaveValue('The Ace');
});
