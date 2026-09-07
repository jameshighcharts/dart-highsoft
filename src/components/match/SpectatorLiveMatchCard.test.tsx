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
