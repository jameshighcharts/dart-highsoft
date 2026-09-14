import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { HighdartsDashboard } from './Dashboard';
const snapshot = { fixtures: [], players: [] };
afterEach(() => vi.unstubAllGlobals());
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
    'Leaderboard',
    'Sheet',
  ]);
  await act(async () => {});
});
