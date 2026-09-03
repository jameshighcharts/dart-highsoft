// Turn/rotation plumbing shared by every engine so that turnIndex, round and
// player rotation behave identically across modes.

import { sortThrows, type GameThrowInput } from './types.ts';

export type TurnGroup = {
  turnIndex: number;
  roundNumber: number;
  playerId: string;
  darts: GameThrowInput[];
};

/** Group a throw log into turns ordered by turn index. */
export function groupTurns(throws: GameThrowInput[]): TurnGroup[] {
  const groups = new Map<number, TurnGroup>();
  for (const dart of sortThrows(throws)) {
    const existing = groups.get(dart.turnIndex);
    if (existing) {
      existing.darts.push(dart);
    } else {
      groups.set(dart.turnIndex, {
        turnIndex: dart.turnIndex,
        roundNumber: dart.roundNumber,
        playerId: dart.playerId,
        darts: [dart],
      });
    }
  }
  return [...groups.values()].sort((a, b) => a.turnIndex - b.turnIndex);
}

/**
 * Next player in seating order after `fromPlayerId` who is still eligible.
 * Returns null when nobody is eligible. `wrapped` tells the caller whether the
 * rotation passed the top of the order, which starts a new round.
 */
export function nextEligiblePlayer(
  orderedPlayerIds: string[],
  eligible: (playerId: string) => boolean,
  fromPlayerId: string | null
): { playerId: string; wrapped: boolean } | null {
  const count = orderedPlayerIds.length;
  if (count === 0) return null;
  const start = fromPlayerId ? orderedPlayerIds.indexOf(fromPlayerId) : -1;
  for (let step = 1; step <= count; step++) {
    const index = (start + step) % count;
    const candidate = orderedPlayerIds[index];
    if (candidate && eligible(candidate)) {
      return { playerId: candidate, wrapped: index <= start };
    }
  }
  return null;
}

export type OpenTurn = {
  currentPlayerId: string | null;
  dartsThrownInTurn: number;
  turnIndex: number;
  round: number;
  turnSegments: string[];
};

/**
 * Work out who throws next given the last turn and whether it has ended.
 * A turn ends after three darts or when the engine says so (`turnEnded`).
 */
export function computeOpenTurn(
  orderedPlayerIds: string[],
  eligible: (playerId: string) => boolean,
  lastTurn: TurnGroup | null,
  turnEnded: boolean
): OpenTurn {
  if (!lastTurn) {
    const first = nextEligiblePlayer(orderedPlayerIds, eligible, null);
    return { currentPlayerId: first?.playerId ?? null, dartsThrownInTurn: 0, turnIndex: 0, round: 1, turnSegments: [] };
  }
  const ended = turnEnded || lastTurn.darts.length >= 3 || !eligible(lastTurn.playerId);
  if (!ended) {
    return {
      currentPlayerId: lastTurn.playerId,
      dartsThrownInTurn: lastTurn.darts.length,
      turnIndex: lastTurn.turnIndex,
      round: lastTurn.roundNumber,
      turnSegments: lastTurn.darts.map((dart) => dart.segment),
    };
  }
  const next = nextEligiblePlayer(orderedPlayerIds, eligible, lastTurn.playerId);
  return {
    currentPlayerId: next?.playerId ?? null,
    dartsThrownInTurn: 0,
    turnIndex: lastTurn.turnIndex + 1,
    round: next?.wrapped ? lastTurn.roundNumber + 1 : lastTurn.roundNumber,
    turnSegments: [],
  };
}

/** Small deterministic helpers for config parsing. */
export function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function readInt(value: unknown, fallback: number, min: number, max: number): number | null {
  if (value === undefined || value === null) return fallback;
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

export function readChoice<T extends string>(value: unknown, choices: readonly T[], fallback: T): T | null {
  if (value === undefined || value === null) return fallback;
  return typeof value === 'string' && (choices as readonly string[]).includes(value) ? (value as T) : null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
