import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveScoliaBoard } from './LiveScoliaBoard';
import type { TurnWithThrows } from '@/lib/match/types';
import { getSpectatorCheckout, type SpectatorCheckout } from '@/utils/spectatorCheckout';

const nora = { id: 'nora', display_name: 'Nora' };
const jonas = { id: 'jonas', display_name: 'Jonas' };
const playerById = { nora, jonas };
const visit = (playerId: string, segments: string[], busted = false): TurnWithThrows => ({
  id: `turn-${playerId}`, leg_id: 'leg', player_id: playerId, turn_number: 1, total_scored: 60, busted, tiebreak_round: null,
  throws: segments.map((segment, index) => ({ id: `${playerId}-${index}`, turn_id: `turn-${playerId}`, dart_index: index + 1, segment, scored: 60 })),
} as TurnWithThrows);
const checkout: SpectatorCheckout = { kind: 'checkout', playerId: 'nora', score: 100, dartsLeft: 2, routes: [['T20', 'D20']] };

beforeEach(() => vi.stubGlobal('React', React));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('LiveScoliaBoard checkout coaching', () => {
  it('fills the empty dart slots with the route and lights the targets', () => {
    const { container } = render(<LiveScoliaBoard turns={[visit('nora', ['T20'])]} currentLegId="leg"
      currentPlayer={nora} playerById={playerById} checkout={checkout} />);
    expect(screen.getByLabelText('Aim for T20')).toBeInTheDocument();
    expect(screen.getByLabelText('Aim for D20')).toBeInTheDocument();
    expect(screen.getByText('On a 100 finish')).toBeInTheDocument();
    expect(container.querySelector('.checkout-target--next')).not.toBeNull();
  });

  it('reads the finish naturally', () => {
    render(<LiveScoliaBoard turns={[]} currentLegId="leg" currentPlayer={nora} playerById={playerById}
      checkout={{ ...checkout, score: 81, dartsLeft: 3, routes: [['T19', 'D12']] }} />);
    expect(screen.getByText('On an 81 finish')).toBeInTheDocument();
  });

  it('does not coach while the previous visit is still on the board', () => {
    const { container } = render(<LiveScoliaBoard turns={[visit('jonas', ['T20', 'T20', 'T20'])]} currentLegId="leg"
      currentPlayer={nora} playerById={playerById} checkout={{ ...checkout, dartsLeft: 3 }} />);
    expect(screen.queryByLabelText(/Aim for/)).toBeNull();
    expect(container.querySelector('.checkout-targets')).toBeNull();
  });
});

function playTakeout(previous: TurnWithThrows) {
  const board = (phase: string) => (
    <LiveScoliaBoard turns={[previous]} currentLegId="leg" currentPlayer={nora}
      playerById={playerById} boardPhase={phase} checkout={{ kind: 'checkout', playerId: 'nora', score: 81, dartsLeft: 3, routes: [['T19', 'D12']] }} />
  );
  const view = render(board('Throw'));
  view.rerender(board('Takeout'));
  view.rerender(board('Throw'));
}

describe('ghost targets after takeout', () => {
  it('appear once a full previous visit is pulled', () => {
    playTakeout(visit('jonas', ['S20', 'S20', 'S20']));
    expect(screen.getByLabelText('Aim for T19')).toBeInTheDocument();
  });

  it('appear once a bust after two darts is pulled', () => {
    playTakeout(visit('jonas', ['T20', 'T20'], true));
    expect(screen.getByLabelText('Aim for T19')).toBeInTheDocument();
  });

});

describe('route follows what was hit', () => {
  const SCORES: Record<string, number> = { T20: 60, S20: 20, T19: 57 };
  // Nora starts the visit on 141; each dart shrinks her score and the darts left.
  function boardAfter(segments: string[]) {
    const turn = {
      ...visit('nora', segments),
      total_scored: segments.reduce((sum, segment) => sum + SCORES[segment], 0),
      throws: visit('nora', segments).throws!.map((dart) => ({ ...dart, scored: SCORES[dart.segment] })),
    };
    const turns = segments.length ? [turn] : [];
    const checkout = getSpectatorCheckout({
      turns, currentLegId: 'leg', startScore: 141, finishRule: 'double_out', playerId: 'nora',
      turnThrowCounts: segments.length ? { [turn.id]: segments.length } : {},
    });
    return { checkout, board: <LiveScoliaBoard turns={turns} currentLegId="leg" currentPlayer={nora} playerById={playerById} checkout={checkout} /> };
  }
  const aims = () => screen.queryAllByLabelText(/^Aim for/).map((el) => el.getAttribute('aria-label'));

  it('re-plans after each dart that stays on the route', () => {
    const start = boardAfter([]);
    const { rerender } = render(start.board);
    expect(aims()).toEqual(['Aim for T20', 'Aim for T19', 'Aim for D12']);

    rerender(boardAfter(['T20']).board);
    expect(screen.getByText('On an 81 finish')).toBeInTheDocument();
    expect(aims()).toEqual(['Aim for T19', 'Aim for D12']);

    rerender(boardAfter(['T20', 'T19']).board);
    expect(screen.getByText('On a 24 finish')).toBeInTheDocument();
    expect(aims()).toEqual(['Aim for D12']);
  });

  it('drops the targets when a miss leaves no finish in the darts left', () => {
    const missed = boardAfter(['S20']);
    render(missed.board);
    expect(missed.checkout?.score).toBe(121);
    expect(missed.checkout?.kind).not.toBe('checkout');
    expect(aims()).toEqual([]);
  });
});
