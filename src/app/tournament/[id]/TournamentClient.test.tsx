import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import TournamentClient from './TournamentClient';
const mocks = vi.hoisted(() => ({ push: vi.fn(), api: vi.fn(), fullscreen: vi.fn(), tv: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/apiClient', () => ({ apiRequest: mocks.api }));
vi.mock('@/lib/tvMode', () => ({ isTVModeEnabled: mocks.tv, requestTVModeFullscreen: mocks.fullscreen }));
vi.mock('@/hooks/useTournamentData', () => ({ useTournamentData: () => ({ loading: false, error: null, tournament: { name: 'Office Cup', mode: 'x01', status: 'in_progress', legs_to_win: 1 }, matches: [], players: [], playerMap: new Map() }) }));
vi.mock('@/components/tournament/BracketView', () => ({ BracketView: ({ onMatchClick }: { onMatchClick: (id: string) => void }) => <button onClick={() => onMatchClick('match')}>Open match</button> }));
vi.mock('@/components/tournament/TournamentStandings', () => ({ TournamentStandings: () => null }));
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); mocks.api.mockResolvedValue({ commentaryEnabled: true }); mocks.tv.mockReturnValue(true); });
it('opens TV matches as spectators with auto commentary after successful board assignment', async () => {
  render(<TournamentClient tournamentId="tournament" />);
  fireEvent.click(screen.getByText('Open match'));
  expect(mocks.fullscreen).toHaveBeenCalledOnce();
  await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/match/match?spectator=true&commentary=true'));
  expect(mocks.api).toHaveBeenCalledWith('/api/tournaments/tournament/matches/match/open', { body: {} });
});
it('keeps scoring mode when TV mode is off and commentary is disabled', async () => {
  mocks.tv.mockReturnValue(false);
  mocks.api.mockResolvedValue({ commentaryEnabled: false });
  render(<TournamentClient tournamentId="tournament" />);
  fireEvent.click(screen.getByText('Open match'));
  await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/match/match'));
});
it('shows board conflicts without navigating into an unassigned match', async () => {
  mocks.api.mockRejectedValue(new Error('Board in use'));
  render(<TournamentClient tournamentId="tournament" />);
  fireEvent.click(screen.getByText('Open match'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Board in use');
  expect(mocks.push).not.toHaveBeenCalled();
});
