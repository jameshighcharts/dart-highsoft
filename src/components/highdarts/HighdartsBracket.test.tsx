import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { completedGroups } from '@/test-utils/highdartsFixtures';
import { HighdartsBracket } from './HighdartsBracket';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('sends an editable reviewed draw as an object and refreshes after saving', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal('fetch', fetch);
  const refresh = vi.fn().mockResolvedValue(undefined);
  render(
    <HighdartsBracket
      snapshot={completedGroups()}
      isAdmin
      onRefresh={refresh}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Edit pairings' }));
  expect(screen.getAllByRole('combobox')).toHaveLength(12);
  await userEvent.click(screen.getByRole('button', { name: 'Lock the draw' }));
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  const options = fetch.mock.calls[0][1];
  const body = JSON.parse(options.body);
  expect(options.method).toBe('POST');
  expect(body.byes).toHaveLength(4);
  expect(body.playoffs).toHaveLength(4);
});
it('keeps administrative draw controls out of member views', () => {
  render(
    <HighdartsBracket
      snapshot={completedGroups()}
      isAdmin={false}
      onRefresh={async () => {}}
    />,
  );
  expect(
    screen.queryByRole('button', { name: 'Lock the draw' }),
  ).not.toBeInTheDocument();
  expect(screen.getAllByRole('article')).toHaveLength(11);
});
