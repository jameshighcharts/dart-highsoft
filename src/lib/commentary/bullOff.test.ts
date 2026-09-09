import { expect, it } from 'vitest';
import { createBullOff, recordBullOffShot, finishBullOffTakeout } from '../match/bullOff';
import { bullOffBrief } from './bullOff';
import { buildBullOffResponseInstructions } from './realtimePrompt';
it('supplies measured inches and keeps bull-off outcomes separate from match wins', () => {
  let state = recordBullOffShot(createBullOff(['a', 'b']), { playerId: 'a', distanceMm: 152.4 });
  const brief = bullOffBrief(state, { a: 'Ada', b: 'Ben' });
  expect(brief).toContain('Ada, 6.00 inches (152.4 mm)');
  expect(brief).toContain('Waiting for physical dart removal');
  expect(buildBullOffResponseInstructions(brief, 'chad')).toContain('NOT X01 scoring');
  state = finishBullOffTakeout(recordBullOffShot(finishBullOffTakeout(state), { playerId: 'b', distanceMm: 0 }));
  expect(bullOffBrief(state, { a: 'Ada', b: 'Ben' })).toContain('Confirmed X01 order: Ben, Ada');
});
it('never invents distance for a miss', () => {
  const state = recordBullOffShot(createBullOff(['a', 'b']), { playerId: 'a', distanceMm: null });
  expect(bullOffBrief(state, {})).toContain('no measured landing; do not invent a distance');
});

it('uses a game-opening brief with the confirmed starter and actual rules', () => {
  let state = createBullOff(['a', 'b']);
  state = finishBullOffTakeout(recordBullOffShot(state, { playerId: 'a', distanceMm: 152.4 }));
  state = finishBullOffTakeout(recordBullOffShot(state, { playerId: 'b', distanceMm: 25.4 }));
  const brief = bullOffBrief(state, { a: 'Ada', b: 'Ben' }, { start_score: '301', finish: 'double_out', legs_to_win: 1 });
  expect(brief).toContain('First to throw: Ben. Every player starts at 301; double out; first to 1 legs.');
  expect(brief).toContain('do not introduce yourself again');
  expect(brief).not.toContain('Latest measurement:');
  expect(buildBullOffResponseInstructions(brief, 'chad', true)).toContain('X01 game opening');
});
