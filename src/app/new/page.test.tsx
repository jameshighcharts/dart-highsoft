import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiRequest } from '@/lib/apiClient';
import { storeSetup } from '@/components/games/NewGameOptions';
import type { ScoliaBoardOption } from '@/lib/scolia/types';
import { fixture } from '@/test-utils/highdartsFixtures';
import NewMatchPage from './page';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/lib/apiClient', () => ({ apiRequest: vi.fn() }));
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ order: async () => ({
      data: ['Askel', 'Helga'].map((id) => ({ id, display_name: id, location: 'vik', avatar_url: null, match_players: [], game_session_players: [] })),
    }) }) }) }),
  }) }));
vi.mock('@/hooks/useScoliaBoardRealtime', () => ({ useScoliaBoardRealtime: vi.fn() }));
vi.mock('@/lib/tvMode', () => ({ isTVModeEnabled: () => false, requestTVModeFullscreen: vi.fn() }));

const drawn = fixture('vik', 'Askel', 'Helga', 29);
const readyBoard: ScoliaBoardOption = {
  id: 'vik-board', name: 'Scolia Vik', isHomeSbc: false,
  workerConnectionStatus: 'connected', boardStatus: 'READY',
  workerHeartbeatAt: new Date().toISOString(), activeMatchId: null,
  activeGameSessionId: null, selectable: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  window.history.replaceState({}, '', `/new?highdarts=${drawn.id}`);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function setup(boards: ScoliaBoardOption[] = []) {
  vi.mocked(apiRequest).mockImplementation(async (url) => {
    if (url === '/api/highdarts') return { fixtures: [drawn], players: [], boards };
    if (url === '/api/scolia/boards/available') return { boards };
    if (url === '/api/matches') return { matchId: 'created-match' };
    throw new Error(`Unexpected request: ${url}`);
  });
  render(<NewMatchPage />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Start match' })).toBeEnabled());
}
const starts = () => vi.mocked(apiRequest).mock.calls.filter(([url]) => url === '/api/matches');

it('blocks Bengt manual starts even with no online boards until the warning is acknowledged', async () => {
  await setup();
  expect(screen.getByRole('alert')).toHaveTextContent('No board connected');
  await userEvent.click(screen.getByRole('button', { name: 'Start match' }));
  const dialog = within(screen.getByRole('alertdialog', { name: 'STOP. No board connected.' }));
  expect(dialog.getByText('Your darts will NOT be recorded automatically.')).toBeInTheDocument();
  const confirm = dialog.getByRole('button', { name: 'Start Bengt match with manual scoring' });
  expect(confirm).toBeDisabled();
  expect(dialog.getByRole('button', { name: 'Go back and select a board' })).toHaveFocus();
  await userEvent.keyboard('{Enter}');
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  expect(starts()).toHaveLength(0);
  expect(screen.getByRole('combobox', { name: 'Board' })).toHaveFocus();
  await userEvent.click(screen.getByRole('button', { name: 'Start match' }));
  await userEvent.click(screen.getByRole('checkbox', { name: /I understand/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Start Bengt match with manual scoring' }));
  expect(starts()).toHaveLength(1);
  expect(starts()[0][1]?.body).toMatchObject({ highdartsFixtureId: drawn.id, scoliaBoardId: null, legsToWin: 2 });
  expect(push).toHaveBeenCalledWith('/match/created-match');
});

it('requires a fresh acknowledgement after dismissing the warning', async () => {
  await setup();
  await userEvent.click(screen.getByRole('button', { name: 'Start match' }));
  await userEvent.click(screen.getByRole('checkbox', { name: /I understand/ }));
  await userEvent.keyboard('{Escape}');
  await userEvent.click(screen.getByRole('button', { name: 'Start match' }));
  expect(screen.getByRole('checkbox', { name: /I understand/ })).not.toBeChecked();
  expect(screen.getByRole('button', { name: 'Start Bengt match with manual scoring' })).toBeDisabled();
  expect(starts()).toHaveLength(0);
});

it('starts a Bengt match on its selected ready board without the manual warning', async () => {
  await setup([readyBoard]);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Start match' }));
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  expect(starts()).toHaveLength(1);
  expect(starts()[0][1]?.body).toMatchObject({ highdartsFixtureId: drawn.id, scoliaBoardId: 'vik-board' });
});

it('keeps ordinary manual matches unchanged', async () => {
  window.history.replaceState({}, '', '/new');
  storeSetup({ gameType: 'x01', gameConfig: {}, selectedIds: ['Askel', 'Helga'], startScore: '301', finish: 'single_out', legsToWin: 1, fairEnding: false });
  await setup();
  await userEvent.click(screen.getByRole('button', { name: 'Start match' }));
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  expect(starts()).toHaveLength(1);
  expect(starts()[0][1]?.body).not.toHaveProperty('highdartsFixtureId');
});
