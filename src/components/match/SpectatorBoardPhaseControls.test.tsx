import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpectatorBoardPhaseControls } from './SpectatorBoardPhaseControls';

vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: async () => ({}) }));
vi.mock('@/hooks/useScoliaBoardRealtime', () => ({ useScoliaBoardRealtime: () => {} }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const response = (body: object, status = 200) => new Response(JSON.stringify(body), { status });
const resetButton = () => screen.queryByRole('button', { name: 'Reset board phase' });

describe('spectator board phase controls', () => {
  it('shows the phase without a reset while the board is throwing', () => {
    render(<SpectatorBoardPhaseControls matchId="match" phase="Throw" onPhase={() => {}} />);
    expect(screen.getByRole('status', { name: 'Board phase: Throw' })).toBeTruthy();
    expect(resetButton()).toBeNull();
  });

  it('hides the reset until the phase has loaded', () => {
    render(<SpectatorBoardPhaseControls matchId="match" phase={undefined} onPhase={() => {}} />);
    expect(screen.getByRole('status', { name: 'Board phase: unknown' })).toBeTruthy();
    expect(resetButton()).toBeNull();
  });

  it('requests a manual reset outside Throw and reports when the board is back', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ commandId: 'command' }, 202))
      .mockResolvedValueOnce(response({ status: 'acknowledged', phase: 'Throw' }));
    vi.stubGlobal('fetch', fetch);
    const onPhase = vi.fn();
    render(<SpectatorBoardPhaseControls matchId="match" phase="Takeout" onPhase={onPhase} />);
    await act(async () => { fireEvent.click(resetButton()!); });
    expect(fetch.mock.calls[0][0]).toBe('/api/matches/match/scolia/reset-phase');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ manual: true });
    expect(onPhase).toHaveBeenCalledWith('Throw');
  });

  it('shows why a reset was refused', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ error: 'The board is offline or not ready. Reconnect it before resetting.' }, 409)));
    render(<SpectatorBoardPhaseControls matchId="match" phase="Takeout" onPhase={() => {}} />);
    await act(async () => { fireEvent.click(resetButton()!); });
    expect(screen.getByRole('alert').textContent).toContain('offline');
    expect(resetButton()).toBeEnabled();
  });
});
