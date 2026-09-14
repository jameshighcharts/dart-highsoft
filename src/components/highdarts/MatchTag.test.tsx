import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { HighdartsMatchTag } from './MatchTag';
import type { MatchRecord } from '@/lib/match/types';
const match: MatchRecord = {
  id: 'match-1',
  mode: 'x01',
  start_score: '501',
  finish: 'double_out',
  legs_to_win: 1,
};
const players = [
  { id: 'a', display_name: 'Ada' },
  { id: 'b', display_name: 'Ben' },
];
const fixture = {
  id: 'fixture-1',
  event_id: 'event',
  stage: 'group',
  office: 'bergen',
  fixture_no: 5,
  player_a_id: 'a',
  player_b_id: 'b',
  player_a_name: 'Ada',
  player_b_name: 'Ben',
  match_id: null,
  match: null,
};
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});
function setup(extra = {}) {
  const fetch = vi
    .fn()
    .mockResolvedValue({
      ok: true,
      json: async () => ({ fixtures: [fixture], players }),
    });
  vi.stubGlobal('fetch', fetch);
  const reload = vi.fn().mockResolvedValue(undefined);
  const props = {
    match,
    players,
    hasThrows: false,
    spectator: false,
    reload,
    ...extra,
  };
  const view = render(<HighdartsMatchTag {...props} />);
  return { ...view, fetch, reload, props };
}
it('offers an unplayed fixture and reloads canonical settings after confirmation', async () => {
  const { fetch, reload } = setup();
  fireEvent.click(
    await screen.findByRole('button', { name: "Yes, it's a tournament match" }),
  );
  await waitFor(() => expect(reload).toHaveBeenCalled());
  expect(fetch).toHaveBeenCalledWith(
    '/api/matches/match-1/highdarts',
    expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ fixtureId: 'fixture-1' }),
    }),
  );
});
it('remembers friendly play for this match', async () => {
  const { unmount } = setup();
  fireEvent.click(
    await screen.findByRole('button', { name: 'No, just a friendly' }),
  );
  expect(localStorage.getItem('highdarts-friendly:match-1')).toBe('yes');
  unmount();
  setup();
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
});
it.each([{ hasThrows: true }, { spectator: true }])(
  'does not interrupt scoring or spectators: %j',
  async (extra) => {
    const { fetch } = setup(extra);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  },
);
