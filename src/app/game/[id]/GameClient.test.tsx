import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GamePlayerData, GameSessionData, GameThrowData } from '@/hooks/useGameData';
import GameClient from './GameClient';

const mocks = vi.hoisted(() => ({
  query: '', data: {} as { session: GameSessionData; players: GamePlayerData[]; throws: GameThrowData[]; orderedPlayerIds: string[] },
  throwDart: vi.fn(), undo: vi.fn(), endEarly: vi.fn(), rematch: vi.fn(), refetch: vi.fn(), busy: false,
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(mocks.query) }));
vi.mock('@/hooks/useGameData', () => ({
  useGameData: () => ({ ...mocks.data, refetch: mocks.refetch, loading: false, error: null, setThrows: vi.fn() }),
  rowToThrowInput: (r: GameThrowData) => ({ id: r.id, playerId: r.player_id, roundNumber: r.round_number, turnIndex: r.turn_index, dartIndex: r.dart_index, segment: r.segment, scored: r.scored }),
}));
vi.mock('@/hooks/useGameActions', () => ({ useGameActions: () => ({ ...mocks, message: null }) }));
vi.mock('@/components/Dartboard', () => ({ default: () => <div>Interactive dartboard</div> }));

function dart(segment: string, index: number, player = 'p1', turn = 0): GameThrowData {
  return { id: `dart-${turn}-${index}`, session_id: 'game', player_id: player, round_number: 1, turn_index: turn, dart_index: index, segment, scored: 0, meta: {} };
}

beforeEach(() => {
  vi.clearAllMocks(); mocks.query = ''; mocks.busy = false;
  mocks.data = {
    session: { id: 'game', mode: 'cricket', config: {variant:'standard',maxRounds:20}, status:'active', scolia_board_id:null, winner_player_id:null, created_at:'2026-09-08', completed_at:null },
    players: [{ player_id:'p1',play_order:0,display_name:'Alex' },{player_id:'p2',play_order:1,display_name:'Jamie'}],
    orderedPlayerIds:['p1','p2'], throws:[],
  };
});
afterEach(cleanup);

it('records canonical darts from the keypad and permits undo', async () => {
  mocks.data.throws = [dart('S20',1)];
  const user = userEvent.setup(); render(<GameClient gameId="game" />);
  await user.click(screen.getByRole('button',{name:'Double',exact:true}));
  await user.click(screen.getByRole('button',{name:'20',exact:true}));
  expect(mocks.throwDart).toHaveBeenCalledWith('D20',40);
  await user.click(screen.getByRole('button',{name:'Undo',exact:true}));
  expect(mocks.undo).toHaveBeenCalledOnce();
});

it('keeps the completed three-dart visit visible after the next player takes over', () => {
  mocks.data.throws = [dart('S20',1),dart('S19',2),dart('S18',3)];
  render(<GameClient gameId="game" />);
  expect(within(screen.getByRole('region',{name:'Current turn'})).getByRole('heading',{name:'Jamie'})).toBeInTheDocument();
  const previous = screen.getByLabelText('Last completed turn');
  expect(within(previous).getByText('S18')).toBeInTheDocument();
  expect(screen.getByRole('article',{name:'Alex'})).not.toHaveAttribute('aria-current');
  expect(screen.getByRole('article',{name:'Jamie'})).toHaveAttribute('aria-current','true');
});

it('spectators can exit but cannot score, undo, end, or rematch', () => {
  mocks.query = 'spectator=true'; render(<GameClient gameId="game" />);
  expect(screen.getByRole('link',{name:'Exit spectator view'})).toHaveAttribute('href','/game/game');
  expect(screen.queryByRole('group',{name:'Dart scoring'})).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Undo'})).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'End game'})).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Rematch'})).not.toBeInTheDocument();
});

it('disables keyboard scoring while saving and hides manual input for Scolia', () => {
  mocks.busy = true; const {unmount} = render(<GameClient gameId="game" />);
  expect(screen.getByRole('button',{name:'20',exact:true})).toBeDisabled();
  unmount(); mocks.data.session.scolia_board_id='board'; render(<GameClient gameId="game" />);
  expect(screen.queryByRole('group',{name:'Dart scoring'})).not.toBeInTheDocument();
  expect(screen.getByText('Automatic scoring from the Scolia board')).toBeInTheDocument();
});

describe.each(['cricket','killer','shanghai','around_the_clock'] as const)('%s', mode => {
  it('removes active-turn highlights and input when ended early', () => {
    mocks.data.session.mode=mode;
    mocks.data.session.config=mode==='killer'?{assignedNumbers:{p1:12,p2:9}}:{};
    mocks.data.session.status='ended_early';
    render(<GameClient gameId="game" />);
    expect(screen.getByText('No winner')).toBeInTheDocument();
    expect(screen.queryByRole('region',{name:'Current turn'})).not.toBeInTheDocument();
    for(const card of screen.getAllByRole('article'))expect(card).not.toHaveAttribute('aria-current');
  });
});

it('shows the result when Shanghai is hit and keeps spectators read-only', () => {
  mocks.query='spectator=true';mocks.data.session.mode='shanghai';mocks.data.session.config={rounds:7,startNumber:1};
  mocks.data.throws=[dart('S1',1),dart('D1',2),dart('T1',3)];
  render(<GameClient gameId="game" />);
  expect(screen.getByText('Winner')).toBeInTheDocument();
  expect(screen.queryByRole('region',{name:'Current turn'})).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Rematch'})).not.toBeInTheDocument();
});
