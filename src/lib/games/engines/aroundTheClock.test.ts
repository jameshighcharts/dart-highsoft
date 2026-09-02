import { describe, it, expect } from 'vitest';
import { aroundTheClockEngine, clockSequence, AROUND_THE_CLOCK_DEFAULTS } from './aroundTheClock.ts';
import type { AroundTheClockConfig, GameThrowInput } from '../types.ts';
import { scoreFromSegment } from '../segment.ts';

const engine = aroundTheClockEngine;
const A = 'player-a';
const B = 'player-b';
const C = 'player-c';

function cfg(overrides: Partial<AroundTheClockConfig> = {}): AroundTheClockConfig {
  return { ...AROUND_THE_CLOCK_DEFAULTS, ...overrides };
}

/** Simulates the server: derive state, then append a throw for the current player at the open slot. */
class Sim {
  config: AroundTheClockConfig;
  order: string[];
  throws: GameThrowInput[] = [];

  constructor(config: AroundTheClockConfig, order: string[]) {
    this.config = config;
    this.order = order;
  }

  get state() {
    return engine.deriveState(this.config, this.order, this.throws);
  }

  throw(segment: string) {
    const state = this.state;
    if (!state.currentPlayerId) throw new Error('game is finished');
    this.throws.push({
      id: `t${this.throws.length}`,
      playerId: state.currentPlayerId,
      roundNumber: state.round,
      turnIndex: state.turnIndex,
      dartIndex: state.dartsThrownInTurn + 1,
      segment,
      scored: scoreFromSegment(segment) ?? 0,
    });
    return this.state;
  }

  throwMany(segments: string[]) {
    let state = this.state;
    for (const segment of segments) state = this.throw(segment);
    return state;
  }
}

/** Segments that take a fresh player from 1 straight through to n (singles). */
function singles(from: number, to: number): string[] {
  const out: string[] = [];
  for (let n = from; n <= to; n++) out.push(`S${n}`);
  return out;
}

describe('clockSequence', () => {
  it('includes bull by default and omits it when disabled', () => {
    expect(clockSequence(cfg())).toEqual([...Array.from({ length: 20 }, (_, i) => i + 1), 25]);
    expect(clockSequence(cfg({ includeBull: false }))).toHaveLength(20);
    expect(clockSequence(cfg({ includeBull: false })).at(-1)).toBe(20);
  });
});

describe('engine metadata', () => {
  it('describes the mode and player limits', () => {
    expect(engine.mode).toBe('around_the_clock');
    expect(engine.minPlayers).toBe(1);
    expect(engine.maxPlayers).toBe(8);
  });

  it('finalizeConfig returns the config unchanged', () => {
    const config = cfg({ fairFinish: true });
    expect(engine.finalizeConfig(config, [A, B], () => 0.5)).toBe(config);
  });
});

describe('parseConfig', () => {
  it('fills defaults for empty input', () => {
    expect(engine.parseConfig({})).toEqual({ ok: true, config: AROUND_THE_CLOCK_DEFAULTS });
    expect(engine.parseConfig(undefined)).toEqual({ ok: true, config: AROUND_THE_CLOCK_DEFAULTS });
  });

  it('accepts explicit values', () => {
    expect(
      engine.parseConfig({ includeBull: false, bullRequirement: 'double', skipOnDoubleTreble: true, fairFinish: true })
    ).toEqual({
      ok: true,
      config: { includeBull: false, bullRequirement: 'double', skipOnDoubleTreble: true, fairFinish: true },
    });
  });

  it('rejects wrong types and unknown choices', () => {
    expect(engine.parseConfig({ includeBull: 'yes' }).ok).toBe(false);
    expect(engine.parseConfig({ skipOnDoubleTreble: 1 }).ok).toBe(false);
    expect(engine.parseConfig({ fairFinish: 'true' }).ok).toBe(false);
    expect(engine.parseConfig({ bullRequirement: 'treble' }).ok).toBe(false);
    expect(engine.parseConfig('nope').ok).toBe(false);
    expect(engine.parseConfig([]).ok).toBe(false);
    const result = engine.parseConfig({ bullRequirement: 'treble' });
    if (!result.ok) expect(result.error).toMatch(/bullRequirement/);
  });
});

describe('initial state', () => {
  it('starts every player on 1 with the first player up', () => {
    const state = engine.deriveState(cfg(), [A, B], []);
    expect(state.currentPlayerId).toBe(A);
    expect(state.turnIndex).toBe(0);
    expect(state.round).toBe(1);
    expect(state.dartsThrownInTurn).toBe(0);
    expect(state.perPlayer[A]).toEqual({ target: 1, finished: false, dartsThrown: 0, finishedAtTurnIndex: null });
    expect(state.activePlayerIds).toEqual([A, B]);
    expect(state.standings).toEqual([A, B]);
    expect(state.finished).toBe(false);
    expect(state.winnerId).toBeNull();
    expect(state.lastEvent).toBeNull();
  });
});

describe('advancing', () => {
  it('advances one step on any segment of the target', () => {
    const sim = new Sim(cfg(), [A]);
    sim.throw('S1');
    expect(sim.state.perPlayer[A].target).toBe(2);
    sim.throw('D2');
    expect(sim.state.perPlayer[A].target).toBe(3);
    sim.throw('T3');
    expect(sim.state.perPlayer[A].target).toBe(4);
  });

  it('ignores misses and wrong numbers', () => {
    const sim = new Sim(cfg(), [A, B]);
    const state = sim.throwMany(['Miss', 'S20', 'T5']);
    expect(state.perPlayer[A]).toEqual({ target: 1, finished: false, dartsThrown: 3, finishedAtTurnIndex: null });
    expect(state.currentPlayerId).toBe(B);
    expect(state.lastEvent).toEqual({
      type: 'clock_throw',
      playerId: A,
      target: 1,
      hit: false,
      nextTarget: 1,
      finished: false,
    });
  });

  it('bull is not advanced by number segments', () => {
    const sim = new Sim(cfg(), [A]);
    sim.throwMany(singles(1, 20));
    expect(sim.state.perPlayer[A].target).toBe(25);
    sim.throw('S20');
    expect(sim.state.perPlayer[A].target).toBe(25);
    expect(sim.state.finished).toBe(false);
  });

  it('reports lastEvent fields for a hit', () => {
    const sim = new Sim(cfg(), [A, B]);
    const state = sim.throw('D1');
    expect(state.lastEvent).toEqual({
      type: 'clock_throw',
      playerId: A,
      target: 1,
      hit: true,
      nextTarget: 2,
      finished: false,
    });
  });
});

describe('skipOnDoubleTreble', () => {
  it('doubles skip two and trebles skip three when enabled', () => {
    const sim = new Sim(cfg({ skipOnDoubleTreble: true }), [A]);
    sim.throw('D1');
    expect(sim.state.perPlayer[A].target).toBe(3);
    sim.throw('T3');
    expect(sim.state.perPlayer[A].target).toBe(6);
    sim.throw('T5'); // wrong number, no-op
    expect(sim.state.perPlayer[A].target).toBe(6);
  });

  it('does not skip when disabled', () => {
    const sim = new Sim(cfg({ skipOnDoubleTreble: false }), [A]);
    sim.throw('T1');
    expect(sim.state.perPlayer[A].target).toBe(2);
  });

  it('clamps at the end: a treble on 19 with bull enabled finishes', () => {
    const sim = new Sim(cfg({ skipOnDoubleTreble: true }), [A]);
    sim.throwMany(singles(1, 18));
    expect(sim.state.perPlayer[A].target).toBe(19);
    const state = sim.throw('T19');
    expect(state.perPlayer[A].finished).toBe(true);
    expect(state.finished).toBe(true);
    expect(state.winnerId).toBe(A);
    expect(state.lastEvent?.nextTarget).toBeNull();
    expect(state.lastEvent?.finished).toBe(true);
  });

  it('a double on 19 with bull enabled lands exactly on bull', () => {
    const sim = new Sim(cfg({ skipOnDoubleTreble: true }), [A]);
    sim.throwMany(singles(1, 18));
    const state = sim.throw('D19');
    expect(state.perPlayer[A].target).toBe(25);
    expect(state.finished).toBe(false);
  });

  it('clamps at the end when bull is disabled', () => {
    const sim = new Sim(cfg({ skipOnDoubleTreble: true, includeBull: false }), [A]);
    sim.throwMany(singles(1, 18));
    const state = sim.throw('T19');
    expect(state.perPlayer[A].finished).toBe(true);
    expect(state.winnerId).toBe(A);
  });
});

describe('bull handling', () => {
  it('includeBull false ends at 20', () => {
    const sim = new Sim(cfg({ includeBull: false }), [A, B]);
    const throws = singles(1, 20);
    // A throws 3 per turn, B misses in between.
    let state = sim.state;
    let idx = 0;
    while (idx < throws.length) {
      state = sim.throwMany(throws.slice(idx, idx + 3));
      idx += 3;
      if (!state.finished) state = sim.throwMany(['Miss', 'Miss', 'Miss']);
    }
    expect(state.perPlayer[A].finished).toBe(true);
    expect(state.perPlayer[A].dartsThrown).toBe(20);
    expect(state.winnerId).toBe(A);
    expect(state.finished).toBe(true);
  });

  it("bullRequirement 'any' accepts a single bull", () => {
    const sim = new Sim(cfg({ bullRequirement: 'any' }), [A]);
    sim.throwMany(singles(1, 20));
    const state = sim.throw('SB');
    expect(state.finished).toBe(true);
    expect(state.winnerId).toBe(A);
  });

  it("bullRequirement 'double' rejects a single bull and accepts DB", () => {
    const sim = new Sim(cfg({ bullRequirement: 'double' }), [A]);
    sim.throwMany(singles(1, 20));
    let state = sim.throw('SB');
    expect(state.perPlayer[A].target).toBe(25);
    expect(state.finished).toBe(false);
    expect(state.lastEvent?.hit).toBe(false);
    state = sim.throw('DB');
    expect(state.finished).toBe(true);
    expect(state.winnerId).toBe(A);
  });
});

describe('finishing (default, first finisher wins)', () => {
  it('ends the game and the turn immediately on the finishing dart', () => {
    const sim = new Sim(cfg({ includeBull: false }), [A, B]);
    // A: 1..18 across six full turns, B misses every time.
    for (let n = 1; n <= 18; n += 3) {
      sim.throwMany([`S${n}`, `S${n + 1}`, `S${n + 2}`]);
      sim.throwMany(['Miss', 'Miss', 'Miss']);
    }
    expect(sim.state.perPlayer[A].target).toBe(19);
    const before = sim.state;
    const state = sim.throwMany(['S19', 'S20']);
    expect(state.finished).toBe(true);
    expect(state.winnerId).toBe(A);
    expect(state.currentPlayerId).toBeNull();
    expect(state.dartsThrownInTurn).toBe(0);
    expect(state.turnIndex).toBe(before.turnIndex + 1);
    expect(state.perPlayer[A]).toEqual({ target: 20, finished: true, dartsThrown: 20, finishedAtTurnIndex: before.turnIndex });
    expect(state.activePlayerIds).toEqual([B]);
    expect(state.standings).toEqual([A, B]);
    expect(state.lastEvent).toEqual({
      type: 'clock_throw',
      playerId: A,
      target: 20,
      hit: true,
      nextTarget: null,
      finished: true,
    });
    expect(() => sim.throw('S1')).toThrow(/finished/);
  });

  it('a single player wins on finishing', () => {
    const sim = new Sim(cfg(), [A]);
    const state = sim.throwMany([...singles(1, 20), 'DB']);
    expect(state.finished).toBe(true);
    expect(state.winnerId).toBe(A);
    expect(state.currentPlayerId).toBeNull();
    expect(state.standings).toEqual([A]);
    expect(state.activePlayerIds).toEqual([]);
  });
});

describe('fairFinish', () => {
  /** Get player order [A, B, C] to A on 20, B on 20, C on 1 with bull disabled. */
  function setupNearFinish(config: AroundTheClockConfig) {
    const sim = new Sim(config, [A, B, C]);
    for (let n = 1; n <= 19; n += 3) {
      const segs = [`S${n}`, `S${n + 1}`, `S${n + 2}`].filter((s) => Number(s.slice(1)) <= 19);
      while (segs.length < 3) segs.push('Miss');
      sim.throwMany(segs); // A
      sim.throwMany(segs); // B
      sim.throwMany(['Miss', 'Miss', 'Miss']); // C
    }
    expect(sim.state.perPlayer[A].target).toBe(20);
    expect(sim.state.perPlayer[B].target).toBe(20);
    expect(sim.state.perPlayer[C].target).toBe(1);
    return sim;
  }

  it('waits for the round to complete before declaring a winner', () => {
    const sim = setupNearFinish(cfg({ includeBull: false, fairFinish: true }));
    const round = sim.state.round;
    // A finishes on first dart: turn ends immediately, game continues.
    let state = sim.throw('S20');
    expect(state.perPlayer[A].finished).toBe(true);
    expect(state.finished).toBe(false);
    expect(state.winnerId).toBeNull();
    expect(state.currentPlayerId).toBe(B);
    expect(state.dartsThrownInTurn).toBe(0);
    expect(state.round).toBe(round);
    // B misses its full turn.
    state = sim.throwMany(['Miss', 'Miss', 'Miss']);
    expect(state.finished).toBe(false);
    expect(state.currentPlayerId).toBe(C);
    // C throws two darts: still not complete.
    state = sim.throwMany(['Miss', 'Miss']);
    expect(state.finished).toBe(false);
    // Third dart completes the round.
    state = sim.throw('Miss');
    expect(state.finished).toBe(true);
    expect(state.winnerId).toBe(A);
    expect(state.currentPlayerId).toBeNull();
    expect(state.standings).toEqual([A, B, C]);
  });

  it('a later finisher in the same round with fewer darts wins', () => {
    const sim = setupNearFinish(cfg({ includeBull: false, fairFinish: true }));
    // A needs three darts to finish (misses twice).
    let state = sim.throwMany(['Miss', 'Miss', 'S20']);
    expect(state.perPlayer[A].finished).toBe(true);
    expect(state.perPlayer[A].dartsThrown).toBe(24);
    expect(state.finished).toBe(false);
    // B finishes on the first dart of the same round.
    state = sim.throw('S20');
    expect(state.perPlayer[B].finished).toBe(true);
    expect(state.perPlayer[B].dartsThrown).toBe(22);
    expect(state.finished).toBe(false);
    expect(state.currentPlayerId).toBe(C);
    state = sim.throwMany(['Miss', 'Miss', 'Miss']);
    expect(state.finished).toBe(true);
    expect(state.winnerId).toBe(B);
    expect(state.standings).toEqual([B, A, C]);
    expect(state.activePlayerIds).toEqual([C]);
  });

  it('ties on darts go to the earlier finisher', () => {
    const sim = setupNearFinish(cfg({ includeBull: false, fairFinish: true }));
    sim.throw('S20'); // A: 22 darts
    sim.throw('S20'); // B: 22 darts
    const state = sim.throwMany(['Miss', 'Miss', 'Miss']);
    expect(state.finished).toBe(true);
    expect(state.winnerId).toBe(A);
    expect(state.standings).toEqual([A, B, C]);
  });

  it('skips finished players in rotation while the round is pending', () => {
    // Order [A, B, C]; C's turn already complete when A finishes next round.
    const sim = new Sim(cfg({ includeBull: false, fairFinish: true }), [A, B, C]);
    // Round 1: A hits 1..3, B hits 1..3, C misses.
    sim.throwMany(['S1', 'S2', 'S3']);
    sim.throwMany(['S1', 'S2', 'S3']);
    sim.throwMany(['Miss', 'Miss', 'Miss']);
    // Bring A to 20 in rounds 2..7 (B and C miss).
    for (let n = 4; n <= 19; n += 3) {
      const segs = [`S${n}`, `S${n + 1}`, `S${n + 2}`].filter((s) => Number(s.slice(1)) <= 19);
      while (segs.length < 3) segs.push('Miss');
      sim.throwMany(segs);
      sim.throwMany(['Miss', 'Miss', 'Miss']);
      sim.throwMany(['Miss', 'Miss', 'Miss']);
    }
    expect(sim.state.perPlayer[A].target).toBe(20);
    expect(sim.state.currentPlayerId).toBe(A);
    // B finishes first this round? No: A finishes, then B and C still throw; the game ends.
    // Instead have B (target 4) never finish; verify rotation excludes A after finishing.
    let state = sim.throw('S20');
    expect(state.perPlayer[A].finished).toBe(true);
    expect(state.currentPlayerId).toBe(B);
    state = sim.throwMany(['Miss', 'Miss', 'Miss']);
    expect(state.currentPlayerId).toBe(C);
    expect(state.finished).toBe(false);
  });

  it('single player with fairFinish wins immediately on finishing', () => {
    const sim = new Sim(cfg({ fairFinish: true }), [A]);
    const state = sim.throwMany([...singles(1, 20), 'SB']);
    expect(state.finished).toBe(true);
    expect(state.winnerId).toBe(A);
    expect(state.currentPlayerId).toBeNull();
  });
});

describe('rotation', () => {
  it('rotates after three darts and increments the round on wrap', () => {
    const sim = new Sim(cfg(), [A, B]);
    let state = sim.throwMany(['S1', 'S2', 'Miss']);
    expect(state.currentPlayerId).toBe(B);
    expect(state.round).toBe(1);
    expect(state.turnIndex).toBe(1);
    state = sim.throwMany(['Miss', 'Miss', 'Miss']);
    expect(state.currentPlayerId).toBe(A);
    expect(state.round).toBe(2);
    expect(state.turnIndex).toBe(2);
    expect(state.turnSegments).toEqual([]);
    state = sim.throw('S3');
    expect(state.dartsThrownInTurn).toBe(1);
    expect(state.turnSegments).toEqual(['S3']);
  });

  it('ranks unfinished players by highest target then fewer darts', () => {
    const sim = new Sim(cfg(), [A, B, C]);
    sim.throwMany(['S1', 'Miss', 'Miss']); // A -> 2, 3 darts
    sim.throwMany(['S1', 'S2', 'Miss']); // B -> 3, 3 darts
    sim.throwMany(['Miss', 'Miss', 'Miss']); // C -> 1
    sim.throwMany(['S2', 'Miss', 'Miss']); // A -> 3, 6 darts
    expect(sim.state.standings).toEqual([B, A, C]);
  });
});

describe('undo property', () => {
  it('dropping the last throw reproduces the previous state', () => {
    const config = cfg({ skipOnDoubleTreble: true, fairFinish: true });
    const sim = new Sim(config, [A, B, C]);
    const segments = ['S1', 'D2', 'Miss', 'T1', 'S4', 'S5', 'Miss', 'S1', 'S2', 'S4', 'S5', 'S6'];
    const snapshots = [sim.state];
    for (const segment of segments) snapshots.push(sim.throw(segment));

    for (let i = sim.throws.length; i > 0; i--) {
      const rewound = engine.deriveState(config, [A, B, C], sim.throws.slice(0, i - 1));
      expect(rewound).toEqual(snapshots[i - 1]);
    }
  });

  it('is independent of throw input order', () => {
    const sim = new Sim(cfg(), [A, B]);
    sim.throwMany(['S1', 'S2', 'S3', 'Miss', 'S1', 'S2', 'S4']);
    const shuffled = sim.throws.slice().reverse();
    expect(engine.deriveState(cfg(), [A, B], shuffled)).toEqual(sim.state);
  });
});
