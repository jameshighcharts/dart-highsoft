import { describe, expect, it } from 'vitest';

import { computeOpenTurn, groupTurns, nextEligiblePlayer, readBoolean, readChoice, readInt, type TurnGroup } from './replay.ts';
import type { GameThrowInput } from './types.ts';

const A = 'a';
const B = 'b';
const C = 'c';
const ORDER = [A, B, C];

function dart(playerId: string, turnIndex: number, dartIndex: number, roundNumber = 1, segment = 'S20'): GameThrowInput {
  return { id: `${turnIndex}-${dartIndex}`, playerId, roundNumber, turnIndex, dartIndex, segment, scored: 20 };
}

function turn(playerId: string, turnIndex: number, roundNumber: number, segments: string[]): TurnGroup {
  return {
    turnIndex,
    roundNumber,
    playerId,
    darts: segments.map((segment, index) => dart(playerId, turnIndex, index + 1, roundNumber, segment)),
  };
}

describe('groupTurns', () => {
  it('sorts by (turnIndex, dartIndex) and groups darts into turns', () => {
    const groups = groupTurns([
      dart(B, 1, 2, 1, 'D5'),
      dart(A, 0, 3),
      dart(B, 1, 1, 1, 'S5'),
      dart(A, 0, 1),
      dart(A, 0, 2),
      dart(C, 2, 1, 1, 'T1'),
    ]);
    expect(groups.map((group) => group.turnIndex)).toEqual([0, 1, 2]);
    expect(groups.map((group) => group.playerId)).toEqual([A, B, C]);
    expect(groups[0]!.darts.map((d) => d.dartIndex)).toEqual([1, 2, 3]);
    expect(groups[1]!.darts.map((d) => d.segment)).toEqual(['S5', 'D5']);
    expect(groups[1]!.roundNumber).toBe(1);
  });

  it('returns an empty list for no throws', () => {
    expect(groupTurns([])).toEqual([]);
  });
});

describe('nextEligiblePlayer', () => {
  it('starts at the top of the order when there is no previous thrower', () => {
    expect(nextEligiblePlayer(ORDER, () => true, null)).toEqual({ playerId: A, wrapped: false });
  });

  it('advances to the next seat without wrapping', () => {
    expect(nextEligiblePlayer(ORDER, () => true, A)).toEqual({ playerId: B, wrapped: false });
  });

  it('skips ineligible players', () => {
    expect(nextEligiblePlayer(ORDER, (id) => id !== B, A)).toEqual({ playerId: C, wrapped: false });
  });

  it('reports wrapped when the rotation passes the top of the order', () => {
    expect(nextEligiblePlayer(ORDER, () => true, C)).toEqual({ playerId: A, wrapped: true });
    expect(nextEligiblePlayer(ORDER, (id) => id !== A, C)).toEqual({ playerId: B, wrapped: true });
  });

  it('wraps back to the same player when nobody else is eligible', () => {
    expect(nextEligiblePlayer(ORDER, (id) => id === B, B)).toEqual({ playerId: B, wrapped: true });
  });

  it('returns null when nobody is eligible or the order is empty', () => {
    expect(nextEligiblePlayer(ORDER, () => false, A)).toBeNull();
    expect(nextEligiblePlayer([], () => true, null)).toBeNull();
  });

  it('treats an unknown previous thrower like the start of the order', () => {
    expect(nextEligiblePlayer(ORDER, () => true, 'ghost')).toEqual({ playerId: A, wrapped: false });
  });
});

describe('computeOpenTurn', () => {
  it('opens the first turn for the first eligible player', () => {
    expect(computeOpenTurn(ORDER, () => true, null, false)).toEqual({
      currentPlayerId: A,
      dartsThrownInTurn: 0,
      turnIndex: 0,
      round: 1,
      turnSegments: [],
    });
    expect(computeOpenTurn(ORDER, (id) => id === C, null, false).currentPlayerId).toBe(C);
    expect(computeOpenTurn(ORDER, () => false, null, false).currentPlayerId).toBeNull();
  });

  it('keeps the turn open mid-turn', () => {
    expect(computeOpenTurn(ORDER, () => true, turn(B, 1, 1, ['S20', 'T19']), false)).toEqual({
      currentPlayerId: B,
      dartsThrownInTurn: 2,
      turnIndex: 1,
      round: 1,
      turnSegments: ['S20', 'T19'],
    });
  });

  it('moves to the next player after three darts', () => {
    expect(computeOpenTurn(ORDER, () => true, turn(A, 0, 1, ['S1', 'S2', 'S3']), false)).toEqual({
      currentPlayerId: B,
      dartsThrownInTurn: 0,
      turnIndex: 1,
      round: 1,
      turnSegments: [],
    });
  });

  it('starts a new round when the rotation wraps', () => {
    expect(computeOpenTurn(ORDER, () => true, turn(C, 2, 1, ['S1', 'S2', 'S3']), false)).toEqual({
      currentPlayerId: A,
      dartsThrownInTurn: 0,
      turnIndex: 3,
      round: 2,
      turnSegments: [],
    });
  });

  it('ends the turn early when the engine says so', () => {
    expect(computeOpenTurn(ORDER, () => true, turn(A, 0, 1, ['D20']), true)).toEqual({
      currentPlayerId: B,
      dartsThrownInTurn: 0,
      turnIndex: 1,
      round: 1,
      turnSegments: [],
    });
  });

  it('hands over when the last thrower became ineligible mid-turn', () => {
    const eligible = (id: string) => id !== B;
    expect(computeOpenTurn(ORDER, eligible, turn(B, 1, 1, ['S20']), false)).toEqual({
      currentPlayerId: C,
      dartsThrownInTurn: 0,
      turnIndex: 2,
      round: 1,
      turnSegments: [],
    });
  });

  it('reports no current player when nobody remains eligible', () => {
    const open = computeOpenTurn(ORDER, () => false, turn(A, 0, 1, ['S1', 'S2', 'S3']), false);
    expect(open.currentPlayerId).toBeNull();
    expect(open.turnIndex).toBe(1);
    expect(open.round).toBe(1);
  });
});

describe('config helpers', () => {
  it('readBoolean only accepts booleans', () => {
    expect(readBoolean(true, false)).toBe(true);
    expect(readBoolean(false, true)).toBe(false);
    expect(readBoolean('true', false)).toBe(false);
    expect(readBoolean(undefined, true)).toBe(true);
  });

  it('readInt falls back for missing values and rejects out-of-range or non-integers', () => {
    expect(readInt(undefined, 3, 1, 5)).toBe(3);
    expect(readInt(null, 3, 1, 5)).toBe(3);
    expect(readInt(4, 3, 1, 5)).toBe(4);
    expect(readInt('5', 3, 1, 5)).toBe(5);
    expect(readInt(0, 3, 1, 5)).toBeNull();
    expect(readInt(6, 3, 1, 5)).toBeNull();
    expect(readInt(2.5, 3, 1, 5)).toBeNull();
    expect(readInt('abc', 3, 1, 5)).toBeNull();
    expect(readInt(true, 3, 1, 5)).toBeNull();
  });

  it('readChoice falls back for missing values and rejects unknown choices', () => {
    const choices = ['double', 'any'] as const;
    expect(readChoice(undefined, choices, 'double')).toBe('double');
    expect(readChoice(null, choices, 'any')).toBe('any');
    expect(readChoice('any', choices, 'double')).toBe('any');
    expect(readChoice('treble', choices, 'double')).toBeNull();
    expect(readChoice(1, choices, 'double')).toBeNull();
  });
});
