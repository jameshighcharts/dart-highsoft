import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CricketBoard } from './CricketBoard';
import type { CricketConfig, CricketEvent, CricketPlayerState, GameState } from '@/lib/games/types';

const players = [
  { player_id: 'p1', play_order: 0, display_name: 'Alice' },
  { player_id: 'p2', play_order: 1, display_name: 'Bob' },
];

const config: CricketConfig = { variant: 'standard', maxRounds: 20 };

function playerState(marks: Partial<CricketPlayerState['marks']>, points: number): CricketPlayerState {
  return {
    marks: { 20: 0, 19: 0, 18: 0, 17: 0, 16: 0, 15: 0, 25: 0, ...marks },
    points,
    dartsThrown: 0,
  };
}

const state: GameState<CricketPlayerState, CricketEvent> = {
  mode: 'cricket',
  currentPlayerId: 'p2',
  dartsThrownInTurn: 0,
  turnIndex: 3,
  round: 2,
  turnSegments: [],
  perPlayer: {
    p1: playerState({ 20: 3, 19: 1, 25: 3 }, 40),
    p2: playerState({ 20: 3, 18: 2, 25: 3 }, 0),
  },
  activePlayerIds: ['p1', 'p2'],
  standings: ['p1', 'p2'],
  winnerId: null,
  finished: false,
  lastEvent: null,
};

afterEach(cleanup);

describe('CricketBoard', () => {
  it('renders player headers with points and per-target marks', () => {
    render(<CricketBoard state={state} players={players} config={config} currentPlayerId="p2" />);

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('40')).toBeInTheDocument();

    const cell = (playerId: string, target: number) => screen.getByTestId(`cricket-cell-${playerId}-${target}`);
    const marksIn = (playerId: string, target: number) =>
      cell(playerId, target).querySelector('[data-testid="cricket-mark"]')?.getAttribute('data-marks');

    expect(marksIn('p1', 20)).toBe('3');
    expect(marksIn('p1', 19)).toBe('1');
    expect(marksIn('p1', 18)).toBe('0');
    expect(marksIn('p2', 18)).toBe('2');
    expect(marksIn('p2', 25)).toBe('3');

    // 1 mark = one line, 2 marks = two lines, 3 marks = two lines plus a circle.
    expect(cell('p1', 19).querySelectorAll('line')).toHaveLength(1);
    expect(cell('p2', 18).querySelectorAll('line')).toHaveLength(2);
    expect(cell('p1', 20).querySelectorAll('circle')).toHaveLength(1);
  });

  it('labels cut-throat scoring as lower is better', () => {
    render(
      <CricketBoard
        state={state}
        players={players}
        config={{ variant: 'cut_throat', maxRounds: null }}
        currentPlayerId="p1"
      />
    );
    expect(screen.getByText(/lower is better/i)).toBeInTheDocument();
  });
});
