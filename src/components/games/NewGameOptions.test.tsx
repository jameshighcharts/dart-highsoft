import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { GameConfigFields, loadStoredSetup, storeSetup, SETUP_STORAGE_KEY } from './NewGameOptions';
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


describe('remembered game setup', () => {
 afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
 it('round-trips rules and ordered players', () => {
  const setup = { gameType: 'x01' as const, gameConfig: {}, selectedIds: ['ben', 'ada'], startScore: '501' as const, finish: 'double_out' as const, legsToWin: 1, fairEnding: true };
  storeSetup(setup);
  expect(loadStoredSetup()).toEqual(setup);
 });
 it('restores party options and Killer number assignments', () => {
  localStorage.setItem(SETUP_STORAGE_KEY, JSON.stringify({ gameType: 'killer', gameConfig: { lives: 5, assignment: 'choose', assignedNumbers: { ada: 16, ben: 8 } }, selectedIds: ['ada', 'ben'] }));
  expect(loadStoredSetup()).toMatchObject({ gameType: 'killer', gameConfig: { lives: 5, assignment: 'choose', assignedNumbers: { ada: 16, ben: 8 } }, selectedIds: ['ada', 'ben'] });
 });
 it('repairs invalid rules, duplicate IDs, and malformed party options', () => {
  localStorage.setItem(SETUP_STORAGE_KEY, JSON.stringify({ gameType: 'killer', gameConfig: { lives: -4, assignment: [], selfHitPenalty: 'false', assignedNumbers: { ada: 80 } }, selectedIds: ['ada', null, 'ada', 9, 'ben'], startScore: '999', finish: 'invalid', legsToWin: 3, fairEnding: true }));
  expect(loadStoredSetup()).toMatchObject({ selectedIds: ['ada', 'ben'], startScore: '301', finish: 'single_out', legsToWin: 3, fairEnding: false, gameConfig: { lives: 3, assignment: 'random', selfHitPenalty: true, assignedNumbers: {} } });
 });
 it('ignores corrupt storage and tolerates unavailable storage', () => {
  localStorage.setItem(SETUP_STORAGE_KEY, '{broken');
  expect(loadStoredSetup()).toBeNull();
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  expect(loadStoredSetup()).toBeNull();
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  expect(() => storeSetup({ gameType: 'x01', gameConfig: {}, selectedIds: [], startScore: '301', finish: 'single_out', legsToWin: 1, fairEnding: false })).not.toThrow();
 });
});
