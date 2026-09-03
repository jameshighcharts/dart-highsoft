// Around the Clock engine: hit 1..20 in order (then Bull), first to finish wins.
// Loaded by the Scolia worker with `node --experimental-strip-types`, so keep
// relative `.ts` imports only and no TypeScript-only runtime syntax.

import type {
  AroundTheClockConfig,
  AroundTheClockEvent,
  AroundTheClockPlayerState,
  ConfigParseResult,
  GameEngine,
  GameState,
  GameThrowInput,
} from '../types.ts';
import { computeOpenTurn, groupTurns, isRecord, readBoolean, readChoice, type TurnGroup } from '../replay.ts';
import { parseSegment } from '../segment.ts';

const BULL_REQUIREMENTS = ['any', 'double'] as const;

export const AROUND_THE_CLOCK_DEFAULTS: AroundTheClockConfig = {
  includeBull: true,
  bullRequirement: 'any',
  skipOnDoubleTreble: false,
  fairFinish: false,
};

/** Ordered targets for the configured game: 1..20, plus 25 (Bull) when enabled. */
export function clockSequence(config: AroundTheClockConfig): number[] {
  const sequence: number[] = [];
  for (let value = 1; value <= 20; value++) sequence.push(value);
  if (config.includeBull) sequence.push(25);
  return sequence;
}

function parseConfig(input: unknown): ConfigParseResult<AroundTheClockConfig> {
  if (input === undefined || input === null) return { ok: true, config: { ...AROUND_THE_CLOCK_DEFAULTS } };
  if (!isRecord(input)) return { ok: false, error: 'Config must be an object' };

  for (const key of ['includeBull', 'skipOnDoubleTreble', 'fairFinish'] as const) {
    const value = input[key];
    if (value !== undefined && value !== null && typeof value !== 'boolean') {
      return { ok: false, error: `${key} must be a boolean` };
    }
  }

  const bullRequirement = readChoice(input.bullRequirement, BULL_REQUIREMENTS, AROUND_THE_CLOCK_DEFAULTS.bullRequirement);
  if (bullRequirement === null) return { ok: false, error: "bullRequirement must be 'any' or 'double'" };

  return {
    ok: true,
    config: {
      includeBull: readBoolean(input.includeBull, AROUND_THE_CLOCK_DEFAULTS.includeBull),
      bullRequirement,
      skipOnDoubleTreble: readBoolean(input.skipOnDoubleTreble, AROUND_THE_CLOCK_DEFAULTS.skipOnDoubleTreble),
      fairFinish: readBoolean(input.fairFinish, AROUND_THE_CLOCK_DEFAULTS.fairFinish),
    },
  };
}

function finalizeConfig(config: AroundTheClockConfig): AroundTheClockConfig {
  return config;
}

function initialPlayerState(): AroundTheClockPlayerState {
  return { target: 1, finished: false, dartsThrown: 0, finishedAtTurnIndex: null };
}

/** How many steps a dart advances a player sitting on `target`; 0 when it misses. */
function stepsForDart(config: AroundTheClockConfig, target: number, segment: string): number {
  const parsed = parseSegment(segment);
  if (!parsed || parsed.kind === 'miss') return 0;
  if (target === 25) {
    if (parsed.kind !== 'bull') return 0;
    return config.bullRequirement === 'any' || parsed.multiplier === 2 ? 1 : 0;
  }
  if (parsed.kind !== 'number' || parsed.value !== target) return 0;
  return config.skipOnDoubleTreble ? parsed.multiplier : 1;
}

/** Finished players ranked: fewest darts first, then the earlier finisher. */
function compareFinished(a: AroundTheClockPlayerState, b: AroundTheClockPlayerState): number {
  return a.dartsThrown - b.dartsThrown || (a.finishedAtTurnIndex ?? 0) - (b.finishedAtTurnIndex ?? 0);
}

/**
 * Fair finish: the game is over once every unfinished player has completed
 * (three darts) their turn of the round in which the first finisher finished.
 */
function fairFinishRoundComplete(
  orderedPlayerIds: string[],
  perPlayer: Record<string, AroundTheClockPlayerState>,
  turns: TurnGroup[]
): boolean {
  let firstFinishTurn: number | null = null;
  for (const id of orderedPlayerIds) {
    const at = perPlayer[id]?.finishedAtTurnIndex;
    if (at !== null && at !== undefined && (firstFinishTurn === null || at < firstFinishTurn)) firstFinishTurn = at;
  }
  if (firstFinishTurn === null) return false;
  const finishRound = turns.find((turn) => turn.turnIndex === firstFinishTurn)?.roundNumber;
  if (finishRound === undefined) return false;

  return orderedPlayerIds.every((id) => {
    const player = perPlayer[id];
    if (!player || player.finished) return true;
    return turns.some((turn) => turn.playerId === id && turn.roundNumber === finishRound && turn.darts.length >= 3);
  });
}

function deriveState(
  config: AroundTheClockConfig,
  orderedPlayerIds: string[],
  throws: GameThrowInput[]
): GameState<AroundTheClockPlayerState, AroundTheClockEvent> {
  const sequence = clockSequence(config);
  const lastIndex = sequence.length - 1;
  const perPlayer: Record<string, AroundTheClockPlayerState> = {};
  for (const id of orderedPlayerIds) perPlayer[id] = initialPlayerState();

  const turns = groupTurns(throws);
  let lastTurn: TurnGroup | null = null;
  let turnEnded = false;
  let lastEvent: AroundTheClockEvent | null = null;
  let winnerId: string | null = null;
  let finished = false;

  for (const turn of turns) {
    lastTurn = turn;
    turnEnded = false;
    for (const dart of turn.darts) {
      const player = (perPlayer[dart.playerId] ??= initialPlayerState());
      player.dartsThrown += 1;
      const targetBefore = player.target;
      let hit = false;
      let finishedNow = false;

      if (!player.finished) {
        const steps = stepsForDart(config, targetBefore, dart.segment);
        if (steps > 0) {
          hit = true;
          const nextIndex = sequence.indexOf(targetBefore) + steps;
          if (nextIndex >= lastIndex + 1) {
            player.target = sequence[lastIndex] ?? targetBefore;
            player.finished = true;
            player.finishedAtTurnIndex = turn.turnIndex;
            finishedNow = true;
          } else {
            player.target = sequence[nextIndex] ?? targetBefore;
          }
        }
      }

      lastEvent = {
        type: 'clock_throw',
        playerId: dart.playerId,
        target: targetBefore,
        hit,
        nextTarget: player.finished ? null : player.target,
        finished: player.finished,
      };

      if (finishedNow) {
        turnEnded = true;
        if (!config.fairFinish && !finished) {
          finished = true;
          winnerId = dart.playerId;
        }
      }
    }
  }

  const finishedIds = orderedPlayerIds.filter((id) => perPlayer[id]?.finished);
  if (!finished && config.fairFinish && finishedIds.length > 0) {
    if (fairFinishRoundComplete(orderedPlayerIds, perPlayer, turns)) {
      finished = true;
      winnerId = finishedIds.slice().sort((a, b) => compareFinished(perPlayer[a]!, perPlayer[b]!))[0] ?? null;
    }
  }

  const eligible = (id: string): boolean => !finished && !!perPlayer[id] && !perPlayer[id]!.finished;
  const open = computeOpenTurn(orderedPlayerIds, eligible, lastTurn, turnEnded);

  const unfinishedIds = orderedPlayerIds.filter((id) => !perPlayer[id]?.finished);
  const standings = [
    ...finishedIds.slice().sort((a, b) => compareFinished(perPlayer[a]!, perPlayer[b]!)),
    ...unfinishedIds.slice().sort((a, b) => {
      const pa = perPlayer[a]!;
      const pb = perPlayer[b]!;
      return sequence.indexOf(pb.target) - sequence.indexOf(pa.target) || pa.dartsThrown - pb.dartsThrown;
    }),
  ];

  return {
    mode: 'around_the_clock',
    currentPlayerId: finished ? null : open.currentPlayerId,
    dartsThrownInTurn: open.dartsThrownInTurn,
    turnIndex: open.turnIndex,
    round: open.round,
    turnSegments: open.turnSegments,
    perPlayer,
    activePlayerIds: unfinishedIds,
    standings,
    winnerId,
    finished,
    lastEvent,
  };
}

export const aroundTheClockEngine: GameEngine<AroundTheClockConfig, AroundTheClockPlayerState, AroundTheClockEvent> = {
  mode: 'around_the_clock',
  minPlayers: 1,
  maxPlayers: 8,
  parseConfig,
  finalizeConfig,
  deriveState,
};
