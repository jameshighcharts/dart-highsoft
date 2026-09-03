// Cricket game engine (standard and cut-throat).
//
// Loaded by the Scolia worker with `node --experimental-strip-types`, so this
// file uses relative `.ts` imports only and no runtime TypeScript features.
//
// Rule interpretations documented here:
// - Marks per target are capped at 3 in `perPlayer[id].marks`; anything beyond
//   three is either converted to points or discarded, never stored.
// - `lastEvent.marks` counts marks that had an effect: closing marks plus marks
//   that scored points. Marks on a target that is dead (closed by everyone) do
//   not count, so a hit on a dead target reports `marks: 0`.
// - The win condition is checked for every player after every dart (thrower
//   first, then seating order). In cut-throat a dart that hands points to an
//   opponent can make a *third* player, who already closed everything, satisfy
//   the "lowest points" condition, so checking only the thrower is not enough.
// - When `maxRounds` is reached and the ranking is still tied after points,
//   closed-target count and darts thrown, the tied player earliest in seating
//   order wins.
// - Darts stored after the game is finished are ignored by replay.

import type {
  ConfigParseResult,
  CricketConfig,
  CricketEvent,
  CricketPlayerState,
  CricketTarget,
  GameEngine,
  GameState,
  GameThrowInput,
} from '../types.ts';
import { CRICKET_TARGETS } from '../types.ts';
import { computeOpenTurn, groupTurns, isRecord, readChoice, readInt } from '../replay.ts';
import { parseSegment } from '../segment.ts';

const DEFAULT_MAX_ROUNDS = 20;
const MIN_MAX_ROUNDS = 5;
const MAX_MAX_ROUNDS = 50;
const MARKS_TO_CLOSE = 3;
const VARIANTS = ['standard', 'cut_throat'] as const;

function emptyMarks(): Record<CricketTarget, number> {
  const marks = {} as Record<CricketTarget, number>;
  for (const target of CRICKET_TARGETS) marks[target] = 0;
  return marks;
}

function isCricketTarget(value: number): value is CricketTarget {
  return (CRICKET_TARGETS as readonly number[]).includes(value);
}

/** Map a segment label to the cricket target it hits and how many marks it is worth. */
function targetOfSegment(segment: string): { target: CricketTarget; marks: number } | null {
  const parsed = parseSegment(segment);
  if (!parsed || parsed.kind === 'miss') return null;
  if (parsed.kind === 'bull') return { target: 25, marks: parsed.multiplier };
  if (!isCricketTarget(parsed.value)) return null;
  return { target: parsed.value, marks: parsed.multiplier };
}

function closedCount(player: CricketPlayerState): number {
  let count = 0;
  for (const target of CRICKET_TARGETS) {
    if (player.marks[target] >= MARKS_TO_CLOSE) count++;
  }
  return count;
}

function hasClosedAll(player: CricketPlayerState): boolean {
  return closedCount(player) === CRICKET_TARGETS.length;
}

/** True when `playerId` has closed every target and leads (or ties) on points per the variant. */
function meetsWinCondition(
  config: CricketConfig,
  perPlayer: Record<string, CricketPlayerState>,
  orderedPlayerIds: string[],
  playerId: string
): boolean {
  const player = perPlayer[playerId];
  if (!player || !hasClosedAll(player)) return false;
  for (const otherId of orderedPlayerIds) {
    if (otherId === playerId) continue;
    const other = perPlayer[otherId];
    if (!other) continue;
    if (config.variant === 'standard' ? player.points < other.points : player.points > other.points) return false;
  }
  return true;
}

/** Ranking comparator: better players sort first. Falls back to seating order. */
function compareStandings(
  config: CricketConfig,
  perPlayer: Record<string, CricketPlayerState>,
  orderedPlayerIds: string[]
): (a: string, b: string) => number {
  return (a, b) => {
    const pa = perPlayer[a];
    const pb = perPlayer[b];
    if (!pa || !pb) return 0;
    const pointsDiff = config.variant === 'standard' ? pb.points - pa.points : pa.points - pb.points;
    if (pointsDiff !== 0) return pointsDiff;
    const closedDiff = closedCount(pb) - closedCount(pa);
    if (closedDiff !== 0) return closedDiff;
    const dartsDiff = pa.dartsThrown - pb.dartsThrown;
    if (dartsDiff !== 0) return dartsDiff;
    return orderedPlayerIds.indexOf(a) - orderedPlayerIds.indexOf(b);
  };
}

function parseConfig(input: unknown): ConfigParseResult<CricketConfig> {
  if (input === undefined || input === null) {
    return { ok: true, config: { variant: 'standard', maxRounds: DEFAULT_MAX_ROUNDS } };
  }
  if (!isRecord(input)) return { ok: false, error: 'Cricket config must be an object' };

  const variant = readChoice(input.variant, VARIANTS, 'standard');
  if (variant === null) return { ok: false, error: 'variant must be "standard" or "cut_throat"' };

  let maxRounds: number | null;
  if (input.maxRounds === null) {
    maxRounds = null;
  } else {
    const parsed = readInt(input.maxRounds, DEFAULT_MAX_ROUNDS, MIN_MAX_ROUNDS, MAX_MAX_ROUNDS);
    if (parsed === null) {
      return { ok: false, error: `maxRounds must be null or an integer between ${MIN_MAX_ROUNDS} and ${MAX_MAX_ROUNDS}` };
    }
    maxRounds = parsed;
  }

  return { ok: true, config: { variant, maxRounds } };
}

function finalizeConfig(config: CricketConfig): CricketConfig {
  return config;
}

function deriveState(
  config: CricketConfig,
  orderedPlayerIds: string[],
  throws: GameThrowInput[]
): GameState<CricketPlayerState, CricketEvent> {
  const perPlayer: Record<string, CricketPlayerState> = {};
  for (const playerId of orderedPlayerIds) {
    perPlayer[playerId] = { marks: emptyMarks(), points: 0, dartsThrown: 0 };
  }

  const turns = groupTurns(throws);
  let lastEvent: CricketEvent | null = null;
  let winnerId: string | null = null;
  let finished = false;

  outer: for (const turn of turns) {
    for (const dart of turn.darts) {
      // The stored playerId is the source of truth, even if it disagrees with rotation.
      let thrower = perPlayer[dart.playerId];
      if (!thrower) {
        thrower = { marks: emptyMarks(), points: 0, dartsThrown: 0 };
        perPlayer[dart.playerId] = thrower;
      }
      thrower.dartsThrown++;

      const hit = targetOfSegment(dart.segment);
      if (!hit) {
        lastEvent = { type: 'cricket_throw', playerId: dart.playerId, target: null, marks: 0, pointsScored: 0, closed: false };
        continue;
      }

      const { target } = hit;
      const before = thrower.marks[target];
      const closingMarks = Math.min(hit.marks, Math.max(0, MARKS_TO_CLOSE - before));
      thrower.marks[target] = before + closingMarks;
      const excessMarks = hit.marks - closingMarks;

      const openOpponents = orderedPlayerIds.filter((id) => {
        if (id === dart.playerId) return false;
        const other = perPlayer[id];
        return !!other && other.marks[target] < MARKS_TO_CLOSE;
      });

      let countedMarks = closingMarks;
      let pointsScored = 0;
      if (excessMarks > 0 && openOpponents.length > 0) {
        countedMarks += excessMarks;
        const points = excessMarks * target;
        if (config.variant === 'standard') {
          thrower.points += points;
          pointsScored = points;
        } else {
          for (const id of openOpponents) {
            const opponent = perPlayer[id];
            if (opponent) opponent.points += points;
          }
          pointsScored = points * openOpponents.length;
        }
      }

      lastEvent = {
        type: 'cricket_throw',
        playerId: dart.playerId,
        target,
        marks: countedMarks,
        pointsScored,
        closed: before < MARKS_TO_CLOSE && thrower.marks[target] >= MARKS_TO_CLOSE,
      };

      // Win check: thrower first, then seating order (see header notes).
      const candidates = [dart.playerId, ...orderedPlayerIds.filter((id) => id !== dart.playerId)];
      for (const candidate of candidates) {
        if (meetsWinCondition(config, perPlayer, orderedPlayerIds, candidate)) {
          winnerId = candidate;
          finished = true;
          break outer;
        }
      }
    }
  }

  const lastTurn = turns.length > 0 ? turns[turns.length - 1]! : null;
  const open = computeOpenTurn(orderedPlayerIds, () => true, lastTurn, finished);

  const compare = compareStandings(config, perPlayer, orderedPlayerIds);
  const standings = orderedPlayerIds.slice().sort(compare);

  if (!finished && config.maxRounds !== null && open.round > config.maxRounds) {
    finished = true;
    winnerId = standings[0] ?? null;
  }

  if (finished && winnerId) {
    const index = standings.indexOf(winnerId);
    if (index > 0) {
      standings.splice(index, 1);
      standings.unshift(winnerId);
    }
  }

  return {
    mode: 'cricket',
    currentPlayerId: finished ? null : open.currentPlayerId,
    dartsThrownInTurn: finished ? 0 : open.dartsThrownInTurn,
    turnIndex: open.turnIndex,
    round: open.round,
    turnSegments: finished ? [] : open.turnSegments,
    perPlayer,
    activePlayerIds: orderedPlayerIds.slice(),
    standings,
    winnerId,
    finished,
    lastEvent,
  };
}

export const cricketEngine: GameEngine<CricketConfig, CricketPlayerState, CricketEvent> = {
  mode: 'cricket',
  minPlayers: 2,
  maxPlayers: 8,
  parseConfig,
  finalizeConfig,
  deriveState,
};
