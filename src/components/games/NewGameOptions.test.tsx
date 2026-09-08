import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { GameConfigFields } from './NewGameOptions';
afterEach(cleanup);
describe('party-game setup',()=>{
 it('hides irrelevant bull requirements when finishing on Bull is off',()=>{
  const {rerender}=render(<GameConfigFields mode="around_the_clock" config={{includeBull:false,bullRequirement:'double'}} onChange={vi.fn()} players={[]} />);
  expect(screen.queryByRole('combobox',{name:'Bull counts with'})).not.toBeInTheDocument();
  rerender(<GameConfigFields mode="around_the_clock" config={{includeBull:true,bullRequirement:'double'}} onChange={vi.fn()} players={[]} />);
  expect(screen.getByRole('combobox',{name:'Bull counts with'})).toBeInTheDocument();
 });
 it('explains that the lowest score wins cut-throat at the round limit',()=>{
  render(<GameConfigFields mode="cricket" config={{variant:'cut_throat',maxRounds:20}} onChange={vi.fn()} players={[]} />);
  expect(screen.getByText('Lowest points wins when the limit is reached.')).toBeInTheDocument();
  expect(screen.queryByText('Highest points wins when the limit is reached.')).not.toBeInTheDocument();
 });
});
