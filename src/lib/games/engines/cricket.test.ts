import { describe, it, expect } from 'vitest';
import { cricketEngine } from './cricket.ts';
import type { CricketConfig, GameThrowInput } from '../types.ts';
import { scoreFromSegment } from '../segment.ts';

const A = 'player-a';
const B = 'player-b';
const C = 'player-c';
const ORDER = [A, B];

const STANDARD: CricketConfig = { variant: 'standard', maxRounds: 20 };
const CUT_THROAT: CricketConfig = { variant: 'cut_throat', maxRounds: 20 };

type Dart = [playerId: string, segment: string];

/**
 * Simulate the server: derive the state, then stamp the next dart with the
 * open turn's indices. The playerId is taken from the script (source of truth)
 * but must match the engine's expectation unless `allowMismatch` is set.
 */
function play(config: CricketConfig, order: string[], darts: Dart[], allowMismatch = false): GameThrowInput[] {
  const log: GameThrowInput[] = [];
  for (const [playerId, segment] of darts) {
    const state = cricketEngine.deriveState(config, order, log);
    if (!allowMismatch && state.currentPlayerId !== playerId) {
      throw new Error(`Script expects ${playerId} to throw but engine says ${state.currentPlayerId}`);
    }
    log.push({
      id: `t${log.length}`,
      playerId,
      roundNumber: state.round,
      turnIndex: state.turnIndex,
      dartIndex: state.dartsThrownInTurn + 1,
      segment,
      scored: scoreFromSegment(segment) ?? 0,
    });
  }
  return log;
}

function derive(config: CricketConfig, order: string[], darts: Dart[]) {
  return cricketEngine.deriveState(config, order, play(config, order, darts));
}

describe('cricketEngine metadata', () => {
  it('exposes mode and player bounds', () => {
    expect(cricketEngine.mode).toBe('cricket');
    expect(cricketEngine.minPlayers).toBe(2);
    expect(cricketEngine.maxPlayers).toBe(8);
  });
});

describe('cricketEngine.parseConfig', () => {
  it('defaults for undefined and empty object', () => {
    expect(cricketEngine.parseConfig(undefined)).toEqual({ ok: true, config: { variant: 'standard', maxRounds: 20 } });
    expect(cricketEngine.parseConfig({})).toEqual({ ok: true, config: { variant: 'standard', maxRounds: 20 } });
  });

  it('accepts cut_throat, explicit null maxRounds and ints in range, ignoring unknown keys', () => {
    expect(cricketEngine.parseConfig({ variant: 'cut_throat', maxRounds: null, bogus: 1 })).toEqual({
      ok: true,
      config: { variant: 'cut_throat', maxRounds: null },
    });
    expect(cricketEngine.parseConfig({ maxRounds: 5 })).toEqual({ ok: true, config: { variant: 'standard', maxRounds: 5 } });
    expect(cricketEngine.parseConfig({ maxRounds: '50' })).toEqual({ ok: true, config: { variant: 'standard', maxRounds: 50 } });
  });

  it('rejects bad variants, out-of-range or non-integer maxRounds and non-objects', () => {
    expect(cricketEngine.parseConfig({ variant: 'weird' }).ok).toBe(false);
    expect(cricketEngine.parseConfig({ maxRounds: 4 }).ok).toBe(false);
    expect(cricketEngine.parseConfig({ maxRounds: 51 }).ok).toBe(false);
    expect(cricketEngine.parseConfig({ maxRounds: 7.5 }).ok).toBe(false);
    expect(cricketEngine.parseConfig({ maxRounds: 'lots' }).ok).toBe(false);
    expect(cricketEngine.parseConfig('nope').ok).toBe(false);
    expect(cricketEngine.parseConfig([]).ok).toBe(false);
  });

  it('finalizeConfig returns the config unchanged', () => {
    expect(cricketEngine.finalizeConfig(CUT_THROAT, ORDER, () => 0.5)).toBe(CUT_THROAT);
  });
});

describe('cricketEngine.deriveState rotation', () => {
  it('starts with player A, dart 1, round 1 on an empty log', () => {
    const state = cricketEngine.deriveState(STANDARD, ORDER, []);
    expect(state.mode).toBe('cricket');
    expect(state.currentPlayerId).toBe(A);
    expect(state.dartsThrownInTurn).toBe(0);
    expect(state.turnIndex).toBe(0);
    expect(state.round).toBe(1);
    expect(state.turnSegments).toEqual([]);
    expect(state.finished).toBe(false);
    expect(state.winnerId).toBeNull();
    expect(state.lastEvent).toBeNull();
    expect(state.activePlayerIds).toEqual(ORDER);
    expect(state.standings).toEqual(ORDER);
    expect(state.perPlayer[A]).toEqual({
      marks: { 20: 0, 19: 0, 18: 0, 17: 0, 16: 0, 15: 0, 25: 0 },
      points: 0,
      dartsThrown: 0,
    });
  });

  it('keeps the turn open for three darts, then rotates', () => {
    const two = derive(STANDARD, ORDER, [
      [A, 'S20'],
      [A, 'Miss'],
    ]);
    expect(two.currentPlayerId).toBe(A);
    expect(two.dartsThrownInTurn).toBe(2);
    expect(two.turnIndex).toBe(0);
    expect(two.turnSegments).toEqual(['S20', 'Miss']);

    const three = derive(STANDARD, ORDER, [
      [A, 'S20'],
      [A, 'Miss'],
      [A, 'S5'],
    ]);
    expect(three.currentPlayerId).toBe(B);
    expect(three.dartsThrownInTurn).toBe(0);
    expect(three.turnIndex).toBe(1);
    expect(three.round).toBe(1);
    expect(three.turnSegments).toEqual([]);
  });

  it('increments the round once every player has thrown', () => {
    const state = derive(STANDARD, ORDER, [
      [A, 'Miss'],
      [A, 'Miss'],
      [A, 'Miss'],
      [B, 'Miss'],
      [B, 'Miss'],
      [B, 'Miss'],
    ]);
    expect(state.currentPlayerId).toBe(A);
    expect(state.round).toBe(2);
    expect(state.turnIndex).toBe(2);
    expect(state.perPlayer[A].dartsThrown).toBe(3);
    expect(state.perPlayer[B].dartsThrown).toBe(3);
  });

  it('does not trust input order: shuffled logs replay identically', () => {
    const log = play(STANDARD, ORDER, [
      [A, 'T20'],
      [A, 'S20'],
      [A, 'D19'],
      [B, 'S20'],
      [B, 'T19'],
    ]);
    const shuffled = [log[3], log[0], log[4], log[2], log[1]];
    expect(cricketEngine.deriveState(STANDARD, ORDER, shuffled)).toEqual(cricketEngine.deriveState(STANDARD, ORDER, log));
  });

  it('attributes a dart to its stored playerId even when rotation disagrees', () => {
    const log = play(STANDARD, ORDER, [[B, 'T20']], true);
    const state = cricketEngine.deriveState(STANDARD, ORDER, log);
    expect(state.perPlayer[B].marks[20]).toBe(3);
    expect(state.perPlayer[A].marks[20]).toBe(0);
    expect(state.lastEvent?.playerId).toBe(B);
  });
});

describe('cricketEngine marks and closing', () => {
  it('counts single, double and treble marks and bulls', () => {
    const state = derive(STANDARD, ORDER, [
      [A, 'S20'],
      [A, 'D19'],
      [A, 'T18'],
      [B, 'SB'],
      [B, 'DB'],
    ]);
    expect(state.perPlayer[A].marks[20]).toBe(1);
    expect(state.perPlayer[A].marks[19]).toBe(2);
    expect(state.perPlayer[A].marks[18]).toBe(3);
    expect(state.perPlayer[B].marks[25]).toBe(3);
    expect(state.perPlayer[B].points).toBe(0);
  });

  it('ignores misses and non-target numbers', () => {
    const state = derive(STANDARD, ORDER, [
      [A, 'Miss'],
      [A, 'T14'],
    ]);
    expect(state.perPlayer[A].dartsThrown).toBe(2);
    expect(Object.values(state.perPlayer[A].marks).every((m) => m === 0)).toBe(true);
    expect(state.lastEvent).toEqual({
      type: 'cricket_throw',
      playerId: A,
      target: null,
      marks: 0,
      pointsScored: 0,
      closed: false,
    });
  });

  it('closes at three marks and reports closed on the closing dart only', () => {
    const closing = derive(STANDARD, ORDER, [
      [A, 'S20'],
      [A, 'D20'],
    ]);
    expect(closing.perPlayer[A].marks[20]).toBe(3);
    expect(closing.lastEvent).toMatchObject({ target: 20, marks: 2, pointsScored: 0, closed: true });

    const afterwards = derive(STANDARD, ORDER, [
      [A, 'S20'],
      [A, 'D20'],
      [A, 'S20'],
    ]);
    expect(afterwards.lastEvent).toMatchObject({ target: 20, marks: 1, pointsScored: 20, closed: false });
  });
});

describe('cricketEngine standard scoring', () => {
  it('carries marks over within one dart: 1 mark + T20 closes and scores 20', () => {
    const state = derive(STANDARD, ORDER, [
      [A, 'S20'],
      [A, 'T20'],
    ]);
    expect(state.perPlayer[A].marks[20]).toBe(3);
    expect(state.perPlayer[A].points).toBe(20);
    expect(state.lastEvent).toEqual({
      type: 'cricket_throw',
      playerId: A,
      target: 20,
      marks: 3,
      pointsScored: 20,
      closed: true,
    });
  });

  it('scores per mark, bull worth 25 per mark', () => {
    const state = derive(STANDARD, ORDER, [
      [A, 'T20'],
      [A, 'T20'],
      [A, 'DB'],
      [B, 'SB'],
      [B, 'DB'],
      [B, 'DB'],
    ]);
    expect(state.perPlayer[A].points).toBe(60);
    expect(state.perPlayer[B].marks[25]).toBe(3);
    expect(state.perPlayer[B].points).toBe(50);
  });

  it('scores only while at least one opponent is still open on the target', () => {
    const state = derive(STANDARD, ORDER, [
      [A, 'T20'],
      [A, 'S20'], // B open -> 20 points
      [A, 'Miss'],
      [B, 'T20'], // B closes 20
      [B, 'Miss'],
      [B, 'Miss'],
      [A, 'T20'], // dead number: no points
    ]);
    expect(state.perPlayer[A].points).toBe(20);
    expect(state.lastEvent).toEqual({
      type: 'cricket_throw',
      playerId: A,
      target: 20,
      marks: 0,
      pointsScored: 0,
      closed: false,
    });
  });

  it('with three players, scores while any single opponent remains open', () => {
    const order = [A, B, C];
    const state = derive(STANDARD, order, [
      [A, 'T20'],
      [A, 'Miss'],
      [A, 'Miss'],
      [B, 'T20'],
      [B, 'Miss'],
      [B, 'Miss'],
      [C, 'Miss'],
      [C, 'Miss'],
      [C, 'Miss'],
      [A, 'D20'], // C still open -> 40
    ]);
    expect(state.perPlayer[A].points).toBe(40);
  });
});

describe('cricketEngine cut-throat scoring', () => {
  it('hands excess points to every opponent who has not closed the target', () => {
    const order = [A, B, C];
    const state = derive(CUT_THROAT, order, [
      [A, 'T20'],
      [A, 'Miss'],
      [A, 'Miss'],
      [B, 'T20'],
      [B, 'Miss'],
      [B, 'Miss'],
      [C, 'Miss'],
      [C, 'Miss'],
      [C, 'Miss'],
      [A, 'D20'], // only C is open on 20
    ]);
    expect(state.perPlayer[A].points).toBe(0);
    expect(state.perPlayer[B].points).toBe(0);
    expect(state.perPlayer[C].points).toBe(40);
    expect(state.lastEvent).toMatchObject({ target: 20, marks: 2, pointsScored: 40, closed: false });
  });

  it('reports total points handed out when several opponents are open', () => {
    const order = [A, B, C];
    const state = derive(CUT_THROAT, order, [
      [A, 'T19'],
      [A, 'S19'],
    ]);
    expect(state.perPlayer[B].points).toBe(19);
    expect(state.perPlayer[C].points).toBe(19);
    expect(state.lastEvent?.pointsScored).toBe(38);
  });

  it('wins when all closed and points are lowest or tied', () => {
    // A hands B points on 20, then closes everything else; B never closes.
    const state = derive(CUT_THROAT, ORDER, [
      [A, 'T20'],
      [A, 'S20'], // B gets 20
      [A, 'T19'],
      [B, 'Miss'],
      [B, 'Miss'],
      [B, 'Miss'],
      [A, 'T18'],
      [A, 'T17'],
      [A, 'T16'],
      [B, 'Miss'],
      [B, 'Miss'],
      [B, 'Miss'],
      [A, 'T15'],
      [A, 'SB'],
      [A, 'DB'],
    ]);
    expect(state.finished).toBe(true);
    expect(state.winnerId).toBe(A);
    expect(state.standings).toEqual([A, B]);
    expect(state.perPlayer[A].points).toBe(0);
    expect(state.perPlayer[B].points).toBe(20);
  });

  it('does not win when all closed but carrying more points than an opponent', () => {
    // B gives A points first, then A closes everything.
    const state = derive(CUT_THROAT, ORDER, [
      [A, 'Miss'],
      [A, 'Miss'],
      [A, 'Miss'],
      [B, 'T20'],
      [B, 'T20'], // A gets 60
      [B, 'Miss'],
      [A, 'T20'],
      [A, 'T19'],
      [A, 'T18'],
      [B, 'Miss'],
      [B, 'Miss'],
      [B, 'Miss'],
      [A, 'T17'],
      [A, 'T16'],
      [A, 'T15'],
      [B, 'Miss'],
      [B, 'Miss'],
      [B, 'Miss'],
      [A, 'DB'],
      [A, 'SB'],
    ]);
    expect(state.perPlayer[A].points).toBe(60);
    expect(state.finished).toBe(false);
    expect(state.currentPlayerId).toBe(A);
    expect(state.standings).toEqual([B, A]);
  });
});

describe('cricketEngine standard win condition', () => {
  const closeSixForA: Dart[] = [
    [A, 'T20'],
    [A, 'T19'],
    [A, 'T18'],
    [B, 'Miss'],
    [B, 'Miss'],
    [B, 'Miss'],
    [A, 'T17'],
    [A, 'T16'],
    [A, 'T15'],
    [B, 'Miss'],
    [B, 'Miss'],
    [B, 'Miss'],
  ];

  it('wins on the dart that closes the last target when ahead on points', () => {
    const darts: Dart[] = [...closeSixForA, [A, 'SB'], [A, 'DB']];
    const state = derive(STANDARD, ORDER, darts);
    expect(state.finished).toBe(true);
    expect(state.winnerId).toBe(A);
    expect(state.currentPlayerId).toBeNull();
    expect(state.dartsThrownInTurn).toBe(0);
    expect(state.turnSegments).toEqual([]);
    expect(state.standings).toEqual([A, B]);
    expect(state.lastEvent).toMatchObject({ playerId: A, target: 25, marks: 2, closed: true });
  });

  it('ends the turn immediately on the winning dart even before three darts', () => {
    const log = play(STANDARD, ORDER, [...closeSixForA, [A, 'SB'], [A, 'DB']]);
    const state = cricketEngine.deriveState(STANDARD, ORDER, log);
    expect(state.perPlayer[A].dartsThrown).toBe(8);
    // Winning dart was the second of the turn; the open turn moved on.
    expect(state.turnIndex).toBe(5);
    expect(state.currentPlayerId).toBeNull();
  });

  it('requires a points lead: closing everything while behind keeps the game going', () => {
    const darts: Dart[] = [
      [A, 'T20'],
      [A, 'T19'],
      [A, 'T18'],
      [B, 'T17'],
      [B, 'T17'], // B scores 51 while A is open on 17
      [B, 'Miss'],
      [A, 'T17'],
      [A, 'T16'],
      [A, 'T15'],
      [B, 'Miss'],
      [B, 'Miss'],
      [B, 'Miss'],
      [A, 'SB'],
      [A, 'DB'], // A has closed all but has 0 points vs 51
    ];
    const state = derive(STANDARD, ORDER, darts);
    expect(state.perPlayer[B].points).toBe(51);
    expect(state.finished).toBe(false);
    expect(state.currentPlayerId).toBe(A);
    expect(state.dartsThrownInTurn).toBe(2);

    // A scores 20 (still behind, game continues), then 40 more to overtake and win.
    const stillBehind = derive(STANDARD, ORDER, [...darts, [A, 'S20']]);
    expect(stillBehind.perPlayer[A].points).toBe(20);
    expect(stillBehind.finished).toBe(false);
    expect(stillBehind.currentPlayerId).toBe(B);

    const won = derive(STANDARD, ORDER, [...darts, [A, 'S20'], [B, 'Miss'], [B, 'Miss'], [B, 'Miss'], [A, 'D20']]);
    expect(won.perPlayer[A].points).toBe(60);
    expect(won.finished).toBe(true);
    expect(won.winnerId).toBe(A);
    expect(won.currentPlayerId).toBeNull();
  });

  it('a tie on points is enough to win in standard', () => {
    const darts: Dart[] = [
      [A, 'T20'],
      [A, 'T19'],
      [A, 'T18'],
      [B, 'T17'],
      [B, 'S17'], // B: 17 points
      [B, 'Miss'],
      [A, 'T17'],
      [A, 'T16'],
      [A, 'T15'],
      [B, 'Miss'],
      [B, 'Miss'],
      [B, 'Miss'],
      [A, 'SB'],
      [A, 'DB'],
      [A, 'Miss'],
      [B, 'Miss'],
      [B, 'Miss'],
      [B, 'Miss'],
      [A, 'S20'], // A: 20 >= 17, all closed -> win
    ];
    const state = derive(STANDARD, ORDER, darts);
    expect(state.finished).toBe(true);
    expect(state.winnerId).toBe(A);
  });
});

describe('cricketEngine maxRounds', () => {
  const FIVE: CricketConfig = { variant: 'standard', maxRounds: 5 };
  const missTurn = (playerId: string): Dart[] => [
    [playerId, 'Miss'],
    [playerId, 'Miss'],
    [playerId, 'Miss'],
  ];

  it('ends after every player completes the final round and picks most points', () => {
    const darts: Dart[] = [];
    for (let round = 1; round <= 5; round++) {
      if (round === 1) {
        darts.push([A, 'T20'], [A, 'S20'], [A, 'Miss']); // A: 20 points
        darts.push([B, 'T19'], [B, 'D19'], [B, 'Miss']); // B: 38 points
      } else {
        darts.push(...missTurn(A), ...missTurn(B));
      }
    }
    const beforeLast = derive(FIVE, ORDER, darts.slice(0, -1));
    expect(beforeLast.finished).toBe(false);
    expect(beforeLast.round).toBe(5);

    const state = derive(FIVE, ORDER, darts);
    expect(state.finished).toBe(true);
    expect(state.round).toBe(6);
    expect(state.currentPlayerId).toBeNull();
    expect(state.winnerId).toBe(B);
    expect(state.standings).toEqual([B, A]);
  });

  it('tiebreaks on closed targets, then fewer darts, then seating order', () => {
    // Equal points (0), A closes one target, B closes none.
    const closedTie: Dart[] = [];
    for (let round = 1; round <= 5; round++) {
      if (round === 1) {
        closedTie.push([A, 'T20'], [A, 'Miss'], [A, 'Miss'], ...missTurn(B));
      } else {
        closedTie.push(...missTurn(A), ...missTurn(B));
      }
    }
    expect(derive(FIVE, ORDER, closedTie).winnerId).toBe(A);

    // Fully tied (points, closed, darts): earliest in seating order wins.
    const dartsTie: Dart[] = [];
    for (let round = 1; round <= 5; round++) {
      dartsTie.push(...missTurn(A), ...missTurn(B));
    }
    const tied = derive(FIVE, ORDER, dartsTie);
    expect(tied.finished).toBe(true);
    expect(tied.winnerId).toBe(A);
    expect(tied.standings).toEqual([A, B]);
  });

  it('prefers fewer darts when points and closed count are equal', () => {
    // Build a log by hand: both players score the same, B throws one dart fewer in total.
    const log = play(FIVE, ORDER, [
      [A, 'Miss'],
      [A, 'Miss'],
      [A, 'Miss'],
      [B, 'Miss'],
      [B, 'Miss'],
      [B, 'Miss'],
    ]);
    // Fake rounds 2..5 with 3 darts for A and 2 darts for B (B's third dart never registered).
    let turnIndex = 2;
    for (let round = 2; round <= 5; round++) {
      for (let d = 1; d <= 3; d++) {
        log.push({ id: `a${round}${d}`, playerId: A, roundNumber: round, turnIndex, dartIndex: d, segment: 'Miss', scored: 0 });
      }
      turnIndex++;
      for (let d = 1; d <= (round === 5 ? 3 : 2); d++) {
        log.push({ id: `b${round}${d}`, playerId: B, roundNumber: round, turnIndex, dartIndex: d, segment: 'Miss', scored: 0 });
      }
      turnIndex++;
    }
    const state = cricketEngine.deriveState(FIVE, ORDER, log);
    expect(state.finished).toBe(true);
    expect(state.perPlayer[A].dartsThrown).toBe(15);
    expect(state.perPlayer[B].dartsThrown).toBe(12);
    expect(state.winnerId).toBe(B);
  });

  it('cut_throat picks fewest points at maxRounds', () => {
    const cfg: CricketConfig = { variant: 'cut_throat', maxRounds: 5 };
    const darts: Dart[] = [];
    for (let round = 1; round <= 5; round++) {
      if (round === 1) {
        darts.push([A, 'T20'], [A, 'S20'], [A, 'Miss']); // B receives 20
        darts.push(...missTurn(B));
      } else {
        darts.push(...missTurn(A), ...missTurn(B));
      }
    }
    const state = derive(cfg, ORDER, darts);
    expect(state.finished).toBe(true);
    expect(state.perPlayer[B].points).toBe(20);
    expect(state.winnerId).toBe(A);
  });

  it('unlimited rounds never ends on the round counter', () => {
    const cfg: CricketConfig = { variant: 'standard', maxRounds: null };
    const darts: Dart[] = [];
    for (let round = 1; round <= 30; round++) darts.push(...missTurn(A), ...missTurn(B));
    const state = derive(cfg, ORDER, darts);
    expect(state.finished).toBe(false);
    expect(state.round).toBe(31);
    expect(state.currentPlayerId).toBe(A);
  });
});

describe('cricketEngine undo property', () => {
  it('deriving without the last dart equals the state before it', () => {
    const script: Dart[] = [
      [A, 'T20'],
      [A, 'S20'],
      [A, 'T19'],
      [B, 'S20'],
      [B, 'DB'],
      [B, 'T18'],
      [A, 'T18'],
      [A, 'S18'],
    ];
    const log = play(STANDARD, ORDER, script);
    for (let n = 1; n <= log.length; n++) {
      const before = cricketEngine.deriveState(STANDARD, ORDER, log.slice(0, n - 1));
      const undone = cricketEngine.deriveState(STANDARD, ORDER, log.slice(0, n).slice(0, -1));
      expect(undone).toEqual(before);
    }
  });

  it('undoing the winning dart reopens the game', () => {
    const log = play(STANDARD, ORDER, [
      [A, 'T20'],
      [A, 'T19'],
      [A, 'T18'],
      [B, 'Miss'],
      [B, 'Miss'],
      [B, 'Miss'],
      [A, 'T17'],
      [A, 'T16'],
      [A, 'T15'],
      [B, 'Miss'],
      [B, 'Miss'],
      [B, 'Miss'],
      [A, 'SB'],
      [A, 'DB'],
    ]);
    expect(cricketEngine.deriveState(STANDARD, ORDER, log).finished).toBe(true);
    const undone = cricketEngine.deriveState(STANDARD, ORDER, log.slice(0, -1));
    expect(undone.finished).toBe(false);
    expect(undone.winnerId).toBeNull();
    expect(undone.currentPlayerId).toBe(A);
    expect(undone.dartsThrownInTurn).toBe(1);
    expect(undone.perPlayer[A].marks[25]).toBe(1);
  });
});
