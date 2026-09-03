import { describe, expect, it } from 'vitest';
import type { GameThrowInput, ShanghaiConfig } from '../types.ts';
import { scoreFromSegment } from '../segment.ts';
import { shanghaiEngine, shanghaiTargetForRound } from './shanghai.ts';

const A = 'player-a';
const B = 'player-b';
const C = 'player-c';

const config = (overrides: Partial<ShanghaiConfig> = {}): ShanghaiConfig => ({
  rounds: 7,
  startNumber: 1,
  ...overrides,
});

/** Simulates the server: derive the state, then append one dart for the current player. */
function createSim(cfg: ShanghaiConfig, order: string[]) {
  const throws: GameThrowInput[] = [];
  const derive = () => shanghaiEngine.deriveState(cfg, order, throws);
  const throwDart = (segment: string) => {
    const state = derive();
    if (!state.currentPlayerId) throw new Error('game is finished, cannot throw');
    throws.push({
      id: `t${throws.length}`,
      playerId: state.currentPlayerId,
      roundNumber: state.round,
      turnIndex: state.turnIndex,
      dartIndex: state.dartsThrownInTurn + 1,
      segment,
      scored: scoreFromSegment(segment) ?? 0,
    });
    return derive();
  };
  const throwTurn = (...segments: string[]) => {
    let state = derive();
    for (const segment of segments) state = throwDart(segment);
    return state;
  };
  return { throws, derive, throwDart, throwTurn };
}

describe('shanghaiTargetForRound', () => {
  it('follows startNumber upwards', () => {
    const cfg = config({ startNumber: 1 });
    expect([1, 2, 3, 7].map((r) => shanghaiTargetForRound(cfg, r))).toEqual([1, 2, 3, 7]);
  });

  it('wraps 20 -> 1', () => {
    const cfg = config({ startNumber: 18 });
    expect([1, 2, 3, 4, 5].map((r) => shanghaiTargetForRound(cfg, r))).toEqual([18, 19, 20, 1, 2]);
  });
});

describe('shanghaiEngine.parseConfig', () => {
  it('applies defaults', () => {
    expect(shanghaiEngine.parseConfig(undefined)).toEqual({ ok: true, config: { rounds: 7, startNumber: 1 } });
    expect(shanghaiEngine.parseConfig({})).toEqual({ ok: true, config: { rounds: 7, startNumber: 1 } });
  });

  it('accepts valid values including numeric strings', () => {
    expect(shanghaiEngine.parseConfig({ rounds: 20, startNumber: '15' })).toEqual({
      ok: true,
      config: { rounds: 20, startNumber: 15 },
    });
  });

  it('rejects out-of-range or non-integer values', () => {
    expect(shanghaiEngine.parseConfig({ rounds: 0 }).ok).toBe(false);
    expect(shanghaiEngine.parseConfig({ rounds: 21 }).ok).toBe(false);
    expect(shanghaiEngine.parseConfig({ rounds: 2.5 }).ok).toBe(false);
    expect(shanghaiEngine.parseConfig({ startNumber: 0 }).ok).toBe(false);
    expect(shanghaiEngine.parseConfig({ startNumber: 21 }).ok).toBe(false);
    expect(shanghaiEngine.parseConfig({ startNumber: 'x' }).ok).toBe(false);
    const result = shanghaiEngine.parseConfig({ rounds: 99 });
    if (!result.ok) expect(result.error).toMatch(/rounds/);
  });

  it('finalizeConfig returns the config unchanged', () => {
    const cfg = config({ rounds: 3, startNumber: 5 });
    expect(shanghaiEngine.finalizeConfig(cfg, [A, B], () => 0.5)).toEqual(cfg);
  });
});

describe('shanghaiEngine.deriveState', () => {
  it('has sane metadata', () => {
    expect(shanghaiEngine.mode).toBe('shanghai');
    expect(shanghaiEngine.minPlayers).toBe(1);
    expect(shanghaiEngine.maxPlayers).toBe(8);
  });

  it('starts with the first player in round 1 and empty scores', () => {
    const { derive } = createSim(config(), [A, B]);
    const state = derive();
    expect(state.currentPlayerId).toBe(A);
    expect(state.round).toBe(1);
    expect(state.turnIndex).toBe(0);
    expect(state.dartsThrownInTurn).toBe(0);
    expect(state.finished).toBe(false);
    expect(state.perPlayer[A]).toEqual({ total: 0, roundScores: {}, inContention: true });
    expect(state.activePlayerIds).toEqual([A, B]);
    expect(state.standings).toEqual([A, B]);
    expect(state.lastEvent).toBeNull();
  });

  it('scores only hits on the round target', () => {
    const sim = createSim(config({ startNumber: 5 }), [A, B]);
    let state = sim.throwDart('S5');
    expect(state.perPlayer[A].total).toBe(5);
    expect(state.lastEvent).toEqual({
      type: 'shanghai_throw',
      playerId: A,
      target: 5,
      hit: true,
      pointsScored: 5,
      shanghai: false,
    });

    state = sim.throwDart('T20');
    expect(state.perPlayer[A].total).toBe(5);
    expect(state.lastEvent).toMatchObject({ hit: false, pointsScored: 0, target: 5 });

    state = sim.throwDart('DB');
    expect(state.perPlayer[A].total).toBe(5);
    expect(state.perPlayer[A].roundScores).toEqual({ 1: 5 });
    expect(state.currentPlayerId).toBe(B);
    expect(state.turnIndex).toBe(1);
    expect(state.round).toBe(1);
  });

  it('uses the target of each round and accumulates totals', () => {
    const sim = createSim(config({ startNumber: 19 }), [A, B]);
    sim.throwTurn('S19', 'D19', 'Miss'); // A round 1: 57
    sim.throwTurn('S19', 'Miss', 'Miss'); // B round 1: 19
    let state = sim.derive();
    expect(state.round).toBe(2);
    expect(state.currentPlayerId).toBe(A);

    sim.throwTurn('T20', 'S20', 'S19'); // A round 2 target 20: 80
    state = sim.throwTurn('D20', 'Miss', 'Miss'); // B round 2: 40
    expect(state.round).toBe(3);

    state = sim.throwTurn('S1', 'S1', 'D20'); // A round 3 target 1 (wrapped): 2
    expect(state.perPlayer[A]).toEqual({ total: 139, roundScores: { 1: 57, 2: 80, 3: 2 }, inContention: true });
    expect(state.perPlayer[B]).toEqual({ total: 59, roundScores: { 1: 19, 2: 40 }, inContention: true });
    expect(state.standings).toEqual([A, B]);
  });

  it('ends the game immediately on a Shanghai (S, D, T in one turn, any order)', () => {
    const sim = createSim(config(), [A, B, C]);
    sim.throwTurn('Miss', 'Miss', 'Miss'); // A
    let state = sim.throwDart('T1'); // B
    expect(state.finished).toBe(false);
    state = sim.throwDart('S1');
    expect(state.finished).toBe(false);
    expect(state.lastEvent).toMatchObject({ shanghai: false });
    state = sim.throwDart('D1');

    expect(state.finished).toBe(true);
    expect(state.winnerId).toBe(B);
    expect(state.currentPlayerId).toBeNull();
    expect(state.lastEvent).toEqual({
      type: 'shanghai_throw',
      playerId: B,
      target: 1,
      hit: true,
      pointsScored: 2,
      shanghai: true,
    });
    expect(state.standings[0]).toBe(B);
    expect(state.perPlayer[B].total).toBe(6);
    expect(sim.throws).toHaveLength(6);
    expect(() => sim.throwDart('Miss')).toThrow();
  });

  it('a Shanghai on the third dart wins even when the turn was already ending', () => {
    const sim = createSim(config({ startNumber: 20 }), [A, B]);
    const state = sim.throwTurn('D20', 'T20', 'S20');
    expect(state.finished).toBe(true);
    expect(state.winnerId).toBe(A);
    expect(state.currentPlayerId).toBeNull();
    expect(state.lastEvent).toMatchObject({ shanghai: true, pointsScored: 20 });
  });

  it('hitting the same multiplier three times is not a Shanghai', () => {
    const sim = createSim(config(), [A, B]);
    const state = sim.throwTurn('S1', 'S1', 'S1');
    expect(state.finished).toBe(false);
    expect(state.currentPlayerId).toBe(B);
  });

  it('ends after the final round with the highest total winning', () => {
    const sim = createSim(config({ rounds: 2 }), [A, B]);
    sim.throwTurn('S1', 'Miss', 'Miss'); // A: 1
    sim.throwTurn('D1', 'Miss', 'Miss'); // B: 2
    sim.throwTurn('S2', 'Miss', 'Miss'); // A: 3
    let state = sim.throwDart('S2'); // B: 4
    expect(state.finished).toBe(false);
    state = sim.throwDart('Miss');
    expect(state.finished).toBe(false);
    expect(state.currentPlayerId).toBe(B);
    state = sim.throwDart('Miss');

    expect(state.finished).toBe(true);
    expect(state.winnerId).toBe(B);
    expect(state.currentPlayerId).toBeNull();
    expect(state.standings).toEqual([B, A]);
    expect(state.perPlayer[A].inContention).toBe(false);
    expect(state.perPlayer[B].inContention).toBe(true);
    expect(state.activePlayerIds).toEqual([B]);
  });

  it('goes to sudden death on a tie, restricted to the tied players', () => {
    const sim = createSim(config({ rounds: 1, startNumber: 20 }), [A, B, C]);
    sim.throwTurn('S20', 'Miss', 'Miss'); // A: 20
    sim.throwTurn('Miss', 'Miss', 'Miss'); // B: 0
    let state = sim.throwTurn('S20', 'Miss', 'Miss'); // C: 20

    expect(state.finished).toBe(false);
    expect(state.winnerId).toBeNull();
    expect(state.round).toBe(2);
    expect(state.turnIndex).toBe(3);
    expect(state.currentPlayerId).toBe(A);
    expect(state.perPlayer[B].inContention).toBe(false);
    expect(state.activePlayerIds).toEqual([A, C]);
    expect(state.standings).toEqual([A, C, B]);

    // Sudden death round 2, target continues the sequence (20 -> 1).
    state = sim.throwTurn('S1', 'Miss', 'Miss'); // A: 21
    expect(state.currentPlayerId).toBe(C); // B skipped
    expect(state.round).toBe(2);
    expect(state.finished).toBe(false);

    state = sim.throwTurn('Miss', 'Miss', 'Miss'); // C: 20
    expect(state.finished).toBe(true);
    expect(state.winnerId).toBe(A);
    expect(state.currentPlayerId).toBeNull();
    expect(state.standings).toEqual([A, C, B]);
    expect(state.perPlayer[A].roundScores).toEqual({ 1: 20, 2: 1 });
  });

  it('keeps going through sudden death while still tied', () => {
    const sim = createSim(config({ rounds: 1 }), [A, B]);
    sim.throwTurn('Miss', 'Miss', 'Miss');
    let state = sim.throwTurn('Miss', 'Miss', 'Miss');
    expect(state.finished).toBe(false);
    expect(state.round).toBe(2);

    sim.throwTurn('S2', 'Miss', 'Miss');
    state = sim.throwTurn('S2', 'Miss', 'Miss');
    expect(state.finished).toBe(false);
    expect(state.round).toBe(3);
    expect(state.activePlayerIds).toEqual([A, B]);

    sim.throwTurn('Miss', 'Miss', 'Miss');
    state = sim.throwTurn('D3', 'Miss', 'Miss');
    expect(state.finished).toBe(true);
    expect(state.winnerId).toBe(B);
  });

  it('a Shanghai during sudden death wins instantly', () => {
    const sim = createSim(config({ rounds: 1 }), [A, B]);
    sim.throwTurn('Miss', 'Miss', 'Miss');
    sim.throwTurn('Miss', 'Miss', 'Miss');
    const state = sim.throwTurn('S2', 'D2', 'T2');
    expect(state.finished).toBe(true);
    expect(state.winnerId).toBe(A);
    expect(state.currentPlayerId).toBeNull();
    expect(state.lastEvent).toMatchObject({ shanghai: true, target: 2 });
  });

  it('completes a one-player game after the last round', () => {
    const sim = createSim(config({ rounds: 2 }), [A]);
    let state = sim.throwTurn('S1', 'Miss', 'Miss');
    expect(state.finished).toBe(false);
    expect(state.round).toBe(2);
    expect(state.currentPlayerId).toBe(A);
    state = sim.throwTurn('Miss', 'D2', 'Miss');
    expect(state.finished).toBe(true);
    expect(state.winnerId).toBe(A);
    expect(state.currentPlayerId).toBeNull();
    expect(state.perPlayer[A].total).toBe(5);
    expect(state.standings).toEqual([A]);
  });

  it('undo: removing the last throw reproduces the previous state', () => {
    const cfg = config({ rounds: 2, startNumber: 19 });
    const order = [A, B, C];
    const sim = createSim(cfg, order);
    const segments = ['S19', 'Miss', 'D19', 'T19', 'S19', 'DB', 'Miss', 'S20', 'D20', 'T20', 'S20', 'S20', 'S20', 'Miss', 'D20'];
    const history = [sim.derive()];
    for (const segment of segments) history.push(sim.throwDart(segment));

    for (let i = sim.throws.length; i > 0; i--) {
      const previous = shanghaiEngine.deriveState(cfg, order, sim.throws.slice(0, i - 1));
      expect(previous).toEqual(history[i - 1]);
    }
  });

  it('is order independent when the throw log is shuffled', () => {
    const sim = createSim(config({ rounds: 1 }), [A, B]);
    sim.throwTurn('S1', 'D1', 'Miss');
    sim.throwTurn('Miss', 'S1', 'Miss');
    const expected = sim.derive();
    const shuffled = sim.throws.slice().reverse();
    expect(shanghaiEngine.deriveState(config({ rounds: 1 }), [A, B], shuffled)).toEqual(expected);
  });
});
