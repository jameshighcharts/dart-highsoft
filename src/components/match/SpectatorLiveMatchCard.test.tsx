import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpectatorLiveMatchCard } from './SpectatorLiveMatchCard';
import type { TurnRecord } from '@/lib/match/types';

const player = { id: 'player', display_name: 'Nora' };
const cancel = vi.fn();
const animate = vi.fn(() => ({ cancel }));
function view(scored = 0, legId = 'leg') {
  const turns: TurnRecord[] = scored ? [{
    id: 'turn', leg_id: legId, player_id: player.id, turn_number: 1,
    total_scored: scored, busted: false, tiebreak_round: null,
  }] : [];
  return <SpectatorLiveMatchCard match={{ start_score: '301', finish: 'single_out', legs_to_win: 1 }}
    orderPlayers={[player]} spectatorCurrentPlayer={null} turns={turns}
    currentLegId={legId} startScore={301} finishRule="single_out"
    turnThrowCounts={{ turn: 3 }} getAvgForPlayer={() => scored} />;
}
beforeEach(() => {
  vi.stubGlobal('React', React);
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);
  vi.stubGlobal('Animation', class {});
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
  animate.mockClear(); cancel.mockClear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete (HTMLElement.prototype as Partial<HTMLElement>).animate; });

describe('scoreboard impact motion', () => {
  it('paints new scores immediately, ignores repeat snapshots, and replaces motion on correction', () => {
    const { rerender, unmount } = render(view());
    expect(animate).not.toHaveBeenCalled();
    rerender(view(60));
    expect(screen.getByText('241')).toBeInTheDocument();
    expect(animate).toHaveBeenCalledTimes(1);
    rerender(view(60));
    expect(animate).toHaveBeenCalledTimes(1);
    rerender(view(20));
    expect(screen.getByText('281')).toBeInTheDocument();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(animate).toHaveBeenCalledTimes(2);
    unmount();
    expect(cancel).toHaveBeenCalledTimes(2);
  });
  it('does not animate a leg reset', () => {
    const { rerender } = render(view(60));
    rerender(view(0, 'next-leg'));
    expect(animate).not.toHaveBeenCalled();
  });
  it('honors reduced motion for subsequent score changes', () => {
    const { rerender } = render(view());
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
    rerender(view(60));
    expect(screen.getByText('241')).toBeInTheDocument();
    expect(animate).not.toHaveBeenCalled();
  });
});

describe('leg wins', () => {
  const players = [player, { id: 'rival', display_name: 'Jonas' }];
  const card = (legsToWin: number, legs: { winner_player_id: string | null }[]) => (
    <SpectatorLiveMatchCard match={{ start_score: '301', finish: 'single_out', legs_to_win: legsToWin }}
      orderPlayers={players} legs={legs} spectatorCurrentPlayer={null} turns={[]}
      currentLegId="leg" startScore={301} finishRule="single_out"
      turnThrowCounts={{}} getAvgForPlayer={() => 0} />
  );

  it('shows a pip per leg to win, filled for each leg won', () => {
    render(card(3, [{ winner_player_id: 'player' }, { winner_player_id: 'rival' }, { winner_player_id: 'player' }, { winner_player_id: null }]));
    const nora = screen.getByRole('img', { name: '2 of 3 legs won' });
    expect([...nora.children].map((pip) => pip.getAttribute('data-won'))).toEqual(['true', 'true', 'false']);
    expect(screen.getByRole('img', { name: '1 of 3 legs won' })).toBeInTheDocument();
  });

  it('switches to a count for long matches', () => {
    render(card(7, [{ winner_player_id: 'player' }]));
    expect(screen.getByRole('img', { name: '1 of 7 legs won' })).toHaveTextContent('1 / 7');
  });

  it('hides leg wins in single-leg matches', () => {
    render(card(1, [{ winner_player_id: null }]));
    expect(screen.queryByRole('img', { name: /legs won/ })).toBeNull();
  });
});
