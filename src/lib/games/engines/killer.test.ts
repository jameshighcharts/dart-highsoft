import { describe, expect, it } from 'vitest';
import { killerEngine } from './killer.ts';
import type { GameThrowInput, KillerConfig } from '../types.ts';

const A = 'a';
const B = 'b';
const C = 'c';
const ORDER = [A, B, C];

function config(overrides: Partial<KillerConfig> = {}): KillerConfig {
  return {
    lives: 3,
    killerRequirement: 'double',
    hitToKill: 'double',
    selfHitPenalty: true,
    assignment: 'choose',
    assignedNumbers: { [A]: 20, [B]: 19, [C]: 18 },
    ...overrides,
  };
}

/** Simulates the server: derive state, then append a throw for the current player. */
function createSim(cfg: KillerConfig, order: string[]) {
  const throws: GameThrowInput[] = [];
  const state = () => killerEngine.deriveState(cfg, order, throws);
  const dart = (segment: string) => {
    const s = state();
    if (!s.currentPlayerId) throw new Error('game finished');
    throws.push({
      id: `t${throws.length}`,
      playerId: s.currentPlayerId,
      roundNumber: s.round,
      turnIndex: s.turnIndex,
      dartIndex: s.dartsThrownInTurn + 1,
      segment,
      scored: 0,
    });
    return state();
  };
  const turn = (...segments: string[]) => {
    let s = state();
    for (const seg of segments) s = dart(seg);
    return s;
  };
  return { throws, state, dart, turn };
}

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe('killerEngine metadata', () => {
  it('exposes mode and player limits', () => {
    expect(killerEngine.mode).toBe('killer');
    expect(killerEngine.minPlayers).toBe(2);
    expect(killerEngine.maxPlayers).toBe(20);
  });
});

describe('parseConfig', () => {
  it('fills defaults', () => {
    expect(killerEngine.parseConfig({})).toEqual({
      ok: true,
      config: {
        lives: 3,
        killerRequirement: 'double',
        hitToKill: 'double',
        selfHitPenalty: true,
        assignment: 'random',
        assignedNumbers: {},
      },
    });
    expect(killerEngine.parseConfig(undefined).ok).toBe(true);
  });

  it('accepts valid overrides', () => {
    const result = killerEngine.parseConfig({
      lives: 5,
      killerRequirement: 'any',
      hitToKill: 'any',
      selfHitPenalty: false,
      assignment: 'choose',
      assignedNumbers: { a: 1, b: 1 },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.lives).toBe(5);
      expect(result.config.assignedNumbers).toEqual({ a: 1, b: 1 });
    }
  });

  it('rejects invalid values', () => {
    expect(killerEngine.parseConfig({ lives: 0 }).ok).toBe(false);
    expect(killerEngine.parseConfig({ lives: 6 }).ok).toBe(false);
    expect(killerEngine.parseConfig({ lives: 2.5 }).ok).toBe(false);
    expect(killerEngine.parseConfig({ killerRequirement: 'treble' }).ok).toBe(false);
    expect(killerEngine.parseConfig({ hitToKill: 'x' }).ok).toBe(false);
    expect(killerEngine.parseConfig({ assignment: 'manual' }).ok).toBe(false);
    expect(killerEngine.parseConfig({ assignedNumbers: [1, 2] }).ok).toBe(false);
    expect(killerEngine.parseConfig({ assignedNumbers: { a: 21 } }).ok).toBe(false);
    expect(killerEngine.parseConfig({ assignedNumbers: { a: 0 } }).ok).toBe(false);
    expect(killerEngine.parseConfig({ assignedNumbers: { a: '5' } }).ok).toBe(false);
    expect(killerEngine.parseConfig({ assignedNumbers: { a: 1.5 } }).ok).toBe(false);
  });
});

describe('finalizeConfig', () => {
  it('assigns distinct numbers deterministically with random assignment', () => {
    const cfg = config({ assignment: 'random', assignedNumbers: {} });
    const order = ['p1', 'p2', 'p3', 'p4', 'p5'];
    const first = killerEngine.finalizeConfig(cfg, order, seeded(42));
    const second = killerEngine.finalizeConfig(cfg, order, seeded(42));
    expect(first).toEqual(second);
    expect(first).not.toBe(cfg);
    const values = order.map((id) => first.assignedNumbers[id]);
    expect(values.every((v) => Number.isInteger(v) && v! >= 1 && v! <= 20)).toBe(true);
    expect(new Set(values).size).toBe(order.length);
    const other = killerEngine.finalizeConfig(cfg, order, seeded(7));
    expect(other.assignedNumbers).not.toEqual(first.assignedNumbers);
  });

  it('fills all 20 players with distinct numbers', () => {
    const order = Array.from({ length: 20 }, (_, i) => `p${i}`);
    const out = killerEngine.finalizeConfig(config({ assignment: 'random', assignedNumbers: {} }), order, seeded(1));
    const values = order.map((id) => out.assignedNumbers[id]).sort((a, b) => a! - b!);
    expect(values).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('keeps valid chosen numbers and fills missing ones', () => {
    const cfg = config({ assignment: 'choose', assignedNumbers: { [A]: 7, [B]: 12 } });
    const out = killerEngine.finalizeConfig(cfg, ORDER, seeded(3));
    expect(out.assignedNumbers[A]).toBe(7);
    expect(out.assignedNumbers[B]).toBe(12);
    expect(out.assignedNumbers[C]).toBeDefined();
    expect(out.assignedNumbers[C]).not.toBe(7);
    expect(out.assignedNumbers[C]).not.toBe(12);
  });

  it('repairs collisions and keeps unique chosen numbers', () => {
    const cfg = config({ assignment: 'choose', assignedNumbers: { [A]: 5, [B]: 5, [C]: 9 } });
    const out = killerEngine.finalizeConfig(cfg, ORDER, seeded(11));
    expect(out.assignedNumbers[C]).toBe(9);
    const values = ORDER.map((id) => out.assignedNumbers[id]);
    expect(new Set(values).size).toBe(3);
    expect(values.includes(9)).toBe(true);
  });

  it('returns a fully assigned choose config unchanged and drops unknown players', () => {
    const cfg = config({ assignment: 'choose', assignedNumbers: { [A]: 1, [B]: 2, [C]: 3, ghost: 4 } });
    const out = killerEngine.finalizeConfig(cfg, ORDER, () => 0.5);
    expect(out.assignedNumbers).toEqual({ [A]: 1, [B]: 2, [C]: 3 });
  });

  it('ignores chosen numbers when assignment is random', () => {
    const cfg = config({ assignment: 'random', assignedNumbers: { [A]: 1, [B]: 2, [C]: 3 } });
    const out = killerEngine.finalizeConfig(cfg, ORDER, () => 0.99);
    // random() -> 0.99 always picks the last item of the pool: 20, 19, 18
    expect(out.assignedNumbers).toEqual({ [A]: 20, [B]: 19, [C]: 18 });
  });
});

describe('deriveState: initial state', () => {
  it('starts with the first player and full lives', () => {
    const s = killerEngine.deriveState(config(), ORDER, []);
    expect(s.mode).toBe('killer');
    expect(s.currentPlayerId).toBe(A);
    expect(s.turnIndex).toBe(0);
    expect(s.round).toBe(1);
    expect(s.dartsThrownInTurn).toBe(0);
    expect(s.finished).toBe(false);
    expect(s.winnerId).toBeNull();
    expect(s.lastEvent).toBeNull();
    expect(s.activePlayerIds).toEqual(ORDER);
    expect(s.standings).toEqual(ORDER);
    expect(s.perPlayer[A]).toEqual({
      number: 20,
      lives: 3,
      isKiller: false,
      eliminated: false,
      kills: 0,
      eliminatedOrder: null,
    });
  });
});

describe('becoming a killer', () => {
  it("requires a double when killerRequirement is 'double'", () => {
    const sim = createSim(config(), ORDER);
    let s = sim.dart('S20');
    expect(s.perPlayer[A]!.isKiller).toBe(false);
    expect(s.lastEvent?.becameKiller).toBe(false);
    s = sim.dart('T20');
    expect(s.perPlayer[A]!.isKiller).toBe(false);
    s = sim.dart('D20');
    expect(s.perPlayer[A]!.isKiller).toBe(true);
    expect(s.lastEvent).toEqual({
      type: 'killer_throw',
      playerId: A,
      becameKiller: true,
      victimId: null,
      kill: false,
      selfHit: false,
      eliminatedPlayerId: null,
    });
  });

  it("accepts any segment when killerRequirement is 'any'", () => {
    const sim = createSim(config({ killerRequirement: 'any' }), ORDER);
    const s = sim.dart('S20');
    expect(s.perPlayer[A]!.isKiller).toBe(true);
    expect(s.lastEvent?.becameKiller).toBe(true);
  });

  it('bull never counts for anything', () => {
    const sim = createSim(config({ killerRequirement: 'any', hitToKill: 'any' }), ORDER);
    sim.turn('D20', 'DB', 'SB');
    const s = sim.state();
    expect(s.perPlayer[A]!.lives).toBe(3);
    expect(s.perPlayer[B]!.lives).toBe(3);
    expect(s.perPlayer[C]!.lives).toBe(3);
  });
});

describe('kills', () => {
  it('non-killer hits on opponents do nothing', () => {
    const sim = createSim(config({ hitToKill: 'any' }), ORDER);
    const s = sim.turn('D19', 'T18', 'S19');
    expect(s.perPlayer[B]!.lives).toBe(3);
    expect(s.perPlayer[C]!.lives).toBe(3);
    expect(s.perPlayer[A]!.kills).toBe(0);
    expect(s.lastEvent?.kill).toBe(false);
    expect(s.lastEvent?.victimId).toBeNull();
  });

  it("a killer removes one life per dart with 'double'; singles and trebles do nothing", () => {
    const sim = createSim(config(), ORDER);
    let s = sim.turn('D20', 'S19', 'T19');
    expect(s.perPlayer[B]!.lives).toBe(3);
    sim.turn('Miss', 'Miss', 'Miss'); // B
    sim.turn('Miss', 'Miss', 'Miss'); // C
    s = sim.dart('D19');
    expect(s.perPlayer[B]!.lives).toBe(2);
    expect(s.perPlayer[A]!.kills).toBe(1);
    expect(s.lastEvent).toMatchObject({ playerId: A, victimId: B, kill: true, becameKiller: false, selfHit: false });
    expect(s.lastEvent?.eliminatedPlayerId).toBeNull();
  });

  it("with hitToKill 'any' a treble still takes exactly one life", () => {
    const sim = createSim(config({ hitToKill: 'any' }), ORDER);
    const s = sim.turn('D20', 'T19', 'S18');
    expect(s.perPlayer[B]!.lives).toBe(2);
    expect(s.perPlayer[C]!.lives).toBe(2);
    expect(s.perPlayer[A]!.kills).toBe(2);
  });

  it('hitting an eliminated player number does nothing', () => {
    const sim = createSim(config({ lives: 1, hitToKill: 'any', killerRequirement: 'any' }), ORDER);
    let s = sim.turn('S20', 'S19', 'S19');
    expect(s.perPlayer[B]!.eliminated).toBe(true);
    expect(s.perPlayer[A]!.kills).toBe(1);
    expect(s.lastEvent).toMatchObject({ kill: false, victimId: null, eliminatedPlayerId: null });
    // Game is now down to A vs C; C throws
    expect(s.currentPlayerId).toBe(C);
    s = sim.dart('S19');
    expect(s.perPlayer[B]!.lives).toBe(0);
    expect(s.perPlayer[C]!.kills).toBe(0);
  });
});

describe('self-hit penalty', () => {
  it('a killer hitting their own number loses a life when enabled', () => {
    const sim = createSim(config(), ORDER);
    let s = sim.turn('D20', 'D20');
    expect(s.perPlayer[A]!.lives).toBe(2);
    expect(s.perPlayer[A]!.isKiller).toBe(true);
    expect(s.lastEvent).toMatchObject({ selfHit: true, kill: false, victimId: null, eliminatedPlayerId: null });
    // Single on own number does not count under 'double' requirement
    s = sim.dart('S20');
    expect(s.perPlayer[A]!.lives).toBe(2);
    expect(s.lastEvent?.selfHit).toBe(false);
  });

  it('no penalty when disabled', () => {
    const sim = createSim(config({ selfHitPenalty: false }), ORDER);
    const s = sim.turn('D20', 'D20', 'D20');
    expect(s.perPlayer[A]!.lives).toBe(3);
    expect(s.perPlayer[A]!.isKiller).toBe(true);
    expect(s.lastEvent?.selfHit).toBe(false);
  });

  it('self-elimination ends the turn early and reports eliminatedPlayerId', () => {
    const sim = createSim(config({ lives: 1 }), ORDER);
    let s = sim.dart('D20');
    expect(s.perPlayer[A]!.isKiller).toBe(true);
    s = sim.dart('D20');
    expect(s.perPlayer[A]!.eliminated).toBe(true);
    expect(s.perPlayer[A]!.eliminatedOrder).toBe(1);
    expect(s.perPlayer[A]!.isKiller).toBe(false);
    expect(s.lastEvent).toMatchObject({ selfHit: true, eliminatedPlayerId: A });
    expect(s.currentPlayerId).toBe(B);
    expect(s.dartsThrownInTurn).toBe(0);
    expect(s.turnIndex).toBe(1);
    expect(s.activePlayerIds).toEqual([B, C]);
  });
});

describe('rotation and rounds with eliminations', () => {
  it('skips eliminated players and increments the round correctly', () => {
    const sim = createSim(config({ lives: 1, killerRequirement: 'any', hitToKill: 'any' }), ORDER);
    // A becomes killer and eliminates B
    let s = sim.turn('S20', 'S19', 'Miss');
    expect(s.perPlayer[B]!.eliminated).toBe(true);
    expect(s.currentPlayerId).toBe(C);
    expect(s.turnIndex).toBe(1);
    expect(s.round).toBe(1);
    s = sim.turn('Miss', 'Miss', 'Miss');
    expect(s.currentPlayerId).toBe(A);
    expect(s.turnIndex).toBe(2);
    expect(s.round).toBe(2);
    s = sim.turn('Miss', 'Miss', 'Miss');
    expect(s.currentPlayerId).toBe(C);
    expect(s.round).toBe(2);
    s = sim.turn('Miss', 'Miss', 'Miss');
    expect(s.currentPlayerId).toBe(A);
    expect(s.round).toBe(3);
    expect(sim.throws.filter((t) => t.playerId === B)).toHaveLength(0);
  });

  it('increments the round when the wrap-around player is eliminated', () => {
    const cfg = config({ lives: 1, killerRequirement: 'any', hitToKill: 'any', assignedNumbers: { [A]: 20, [B]: 19, [C]: 18, d: 17 } });
    const sim2 = createSim(cfg, [A, B, C, 'd']);
    // A eliminates B; C eliminates A; d then plays; next is C (round 2)
    sim2.turn('S20', 'S19', 'Miss');
    let s = sim2.turn('S18', 'S20', 'Miss');
    expect(s.perPlayer[A]!.eliminated).toBe(true);
    expect(s.currentPlayerId).toBe('d');
    expect(s.round).toBe(1);
    s = sim2.turn('Miss', 'Miss', 'Miss');
    expect(s.currentPlayerId).toBe(C);
    expect(s.round).toBe(2);
    expect(s.turnIndex).toBe(3);
  });
});

describe('winning', () => {
  it('last player standing wins, turn ends immediately, currentPlayerId null', () => {
    const sim = createSim(config({ lives: 1, killerRequirement: 'any', hitToKill: 'any' }), ORDER);
    const s = sim.turn('S20', 'S19', 'S18');
    expect(s.finished).toBe(true);
    expect(s.winnerId).toBe(A);
    expect(s.currentPlayerId).toBeNull();
    expect(s.dartsThrownInTurn).toBe(0);
    expect(s.turnSegments).toEqual([]);
    expect(s.activePlayerIds).toEqual([A]);
    expect(s.standings).toEqual([A, C, B]);
    expect(s.perPlayer[B]!.eliminatedOrder).toBe(1);
    expect(s.perPlayer[C]!.eliminatedOrder).toBe(2);
    expect(s.lastEvent).toMatchObject({ playerId: A, victimId: C, kill: true, eliminatedPlayerId: C });
    expect(() => sim.dart('Miss')).toThrow('game finished');
  });

  it('finishes mid-turn (turn ends early)', () => {
    const sim = createSim(config({ lives: 1, killerRequirement: 'any', hitToKill: 'any' }), [A, B]);
    let s = sim.dart('S20');
    expect(s.finished).toBe(false);
    s = sim.dart('S19');
    expect(s.finished).toBe(true);
    expect(s.winnerId).toBe(A);
    expect(s.currentPlayerId).toBeNull();
    expect(s.standings).toEqual([A, B]);
  });

  it('two-player game: winner by self-elimination of the opponent', () => {
    const sim = createSim(config({ lives: 1 }), [A, B]);
    sim.turn('Miss', 'Miss', 'Miss');
    const s = sim.turn('D19', 'D19');
    expect(s.perPlayer[B]!.eliminated).toBe(true);
    expect(s.finished).toBe(true);
    expect(s.winnerId).toBe(A);
    expect(s.currentPlayerId).toBeNull();
    expect(s.standings).toEqual([A, B]);
  });

  it('a single-player game never finishes', () => {
    const sim = createSim(config({ lives: 1, assignedNumbers: { [A]: 20 } }), [A]);
    const s = sim.turn('D20', 'D20');
    expect(s.perPlayer[A]!.eliminated).toBe(true);
    expect(s.finished).toBe(false);
    expect(s.winnerId).toBeNull();
    expect(s.currentPlayerId).toBeNull();
  });
});

describe('standings', () => {
  it('lists survivors in order, then eliminated in reverse elimination order', () => {
    const cfg = config({ lives: 1, killerRequirement: 'any', hitToKill: 'any', assignedNumbers: { [A]: 20, [B]: 19, [C]: 18, d: 17 } });
    const sim = createSim(cfg, [A, B, C, 'd']);
    let s = sim.turn('S20', 'S18', 'Miss'); // A kills C (1st out)
    expect(s.standings).toEqual([A, B, 'd', C]);
    s = sim.turn('S19', 'S17', 'Miss'); // B kills d (2nd out)
    expect(s.standings).toEqual([A, B, 'd', C]);
    expect(s.finished).toBe(false);
    s = sim.turn('S19'); // A kills B (3rd out) -> A wins
    expect(s.finished).toBe(true);
    expect(s.standings).toEqual([A, B, 'd', C]);
    expect(s.perPlayer[C]!.eliminatedOrder).toBe(1);
    expect(s.perPlayer['d']!.eliminatedOrder).toBe(2);
    expect(s.perPlayer[B]!.eliminatedOrder).toBe(3);
  });
});

describe('undo property', () => {
  it('deriving from throws.slice(0, -1) matches the previous state at every step', () => {
    const cfg = config({ lives: 2, killerRequirement: 'any', hitToKill: 'any' });
    const sim = createSim(cfg, ORDER);
    const segments = ['S20', 'S19', 'D20', 'D19', 'S18', 'Miss', 'S18', 'S20', 'S20', 'T19', 'S20', 'Miss', 'S18'];
    const snapshots = [sim.state()];
    for (const seg of segments) {
      const s = sim.state();
      if (!s.currentPlayerId) break;
      snapshots.push(sim.dart(seg));
    }
    for (let i = 1; i < snapshots.length; i++) {
      const undone = killerEngine.deriveState(cfg, ORDER, sim.throws.slice(0, i - 1));
      expect(undone).toEqual(snapshots[i - 1]);
    }
    // order of the log must not matter
    const shuffled = sim.throws.slice().reverse();
    expect(killerEngine.deriveState(cfg, ORDER, shuffled)).toEqual(snapshots[snapshots.length - 1]);
  });
});

describe('bad data', () => {
  it('treats darts from a player without an assigned number as no-ops', () => {
    const cfg = config({ killerRequirement: 'any', hitToKill: 'any', assignedNumbers: { [A]: 20, [B]: 19 } });
    const sim = createSim(cfg, ORDER);
    sim.turn('Miss', 'Miss', 'Miss'); // A
    sim.turn('Miss', 'Miss', 'Miss'); // B
    const s = sim.turn('S20', 'S19', 'S20'); // C has no number
    expect(s.perPlayer[C]!.number).toBe(0);
    expect(s.perPlayer[C]!.isKiller).toBe(false);
    expect(s.perPlayer[A]!.lives).toBe(3);
    expect(s.perPlayer[B]!.lives).toBe(3);
    expect(s.lastEvent).toMatchObject({ playerId: C, becameKiller: false, kill: false });
  });

  it('ignores invalid segment labels and unknown players', () => {
    const cfg = config({ killerRequirement: 'any' });
    const s = killerEngine.deriveState(cfg, ORDER, [
      { id: '1', playerId: A, roundNumber: 1, turnIndex: 0, dartIndex: 1, segment: 'X99', scored: 0 },
      { id: '2', playerId: 'zzz', roundNumber: 1, turnIndex: 1, dartIndex: 1, segment: 'S20', scored: 20 },
    ]);
    expect(s.perPlayer[A]!.isKiller).toBe(false);
    expect(s.perPlayer['zzz']).toBeUndefined();
    expect(s.lastEvent?.playerId).toBe('zzz');
  });
});
