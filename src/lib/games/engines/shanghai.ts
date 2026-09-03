// Shanghai game engine.
// Loaded by the Scolia worker via `node --experimental-strip-types`: relative
// `.ts` imports only, no enums, no parameter properties, no framework imports.

import type {
  ConfigParseResult,
  GameEngine,
  GameState,
  GameThrowInput,
  ShanghaiConfig,
  ShanghaiEvent,
  ShanghaiPlayerState,
} from '../types.ts';
import { computeOpenTurn, groupTurns, isRecord, readInt } from '../replay.ts';
import { parseSegment } from '../segment.ts';

const DEFAULT_CONFIG: ShanghaiConfig = { rounds: 7, startNumber: 1 };

/** Target number for a round: startNumber, startNumber + 1, ... wrapping 20 -> 1. */
export function shanghaiTargetForRound(config: ShanghaiConfig, round: number): number {
  return ((config.startNumber - 1 + (round - 1)) % 20) + 1;
}

function parseConfig(input: unknown): ConfigParseResult<ShanghaiConfig> {
  const raw: Record<string, unknown> = isRecord(input) ? input : {};

  const rounds = readInt(raw.rounds, DEFAULT_CONFIG.rounds, 1, 20);
  if (rounds === null) return { ok: false, error: 'rounds must be an integer between 1 and 20' };

  const startNumber = readInt(raw.startNumber, DEFAULT_CONFIG.startNumber, 1, 20);
  if (startNumber === null) return { ok: false, error: 'startNumber must be an integer between 1 and 20' };

  return { ok: true, config: { rounds, startNumber } };
}

function finalizeConfig(config: ShanghaiConfig): ShanghaiConfig {
  return config;
}

function deriveState(
  config: ShanghaiConfig,
  orderedPlayerIds: string[],
  throws: GameThrowInput[]
): GameState<ShanghaiPlayerState, ShanghaiEvent> {
  const perPlayer: Record<string, ShanghaiPlayerState> = {};
  for (const playerId of orderedPlayerIds) {
    perPlayer[playerId] = { total: 0, roundScores: {}, inContention: true };
  }

  const inContention = (playerId: string) => perPlayer[playerId]?.inContention === true;
  const contenders = () => orderedPlayerIds.filter(inContention);

  let finished = false;
  let winnerId: string | null = null;
  let lastEvent: ShanghaiEvent | null = null;
  let lastTurnEnded = false;

  /** Players who have completed a 3-dart turn per round number. */
  const completedInRound = new Map<number, Set<string>>();

  const turns = groupTurns(throws);
  for (const turn of turns) {
    if (finished) break;
    lastTurnEnded = false;

    const player = perPlayer[turn.playerId];
    if (!player) continue;
    const target = shanghaiTargetForRound(config, turn.roundNumber);
    const multipliersHit = new Set<number>();

    for (const dart of turn.darts) {
      const parsed = parseSegment(dart.segment);
      const hit = parsed?.kind === 'number' && parsed.value === target;
      const pointsScored = hit ? parsed.scored : 0;
      if (hit) multipliersHit.add(parsed.multiplier);

      player.total += pointsScored;
      player.roundScores[turn.roundNumber] = (player.roundScores[turn.roundNumber] ?? 0) + pointsScored;

      const shanghai = multipliersHit.size === 3;
      lastEvent = { type: 'shanghai_throw', playerId: turn.playerId, target, hit, pointsScored, shanghai };

      if (shanghai) {
        finished = true;
        winnerId = turn.playerId;
        lastTurnEnded = true;
        for (const id of orderedPlayerIds) {
          if (id !== winnerId) perPlayer[id].inContention = false;
        }
        break;
      }
    }
    if (finished) break;

    // Final round (and sudden-death rounds) are decided once every contender
    // has completed a full turn in that round.
    if (turn.darts.length >= 3 && turn.roundNumber >= config.rounds) {
      const done = completedInRound.get(turn.roundNumber) ?? new Set<string>();
      done.add(turn.playerId);
      completedInRound.set(turn.roundNumber, done);

      const active = contenders();
      if (active.length > 0 && active.every((id) => done.has(id))) {
        const best = Math.max(...active.map((id) => perPlayer[id].total));
        const leaders = active.filter((id) => perPlayer[id].total === best);
        if (leaders.length === 1) {
          finished = true;
          winnerId = leaders[0];
          for (const id of orderedPlayerIds) {
            if (id !== winnerId) perPlayer[id].inContention = false;
          }
        } else {
          for (const id of active) {
            if (!leaders.includes(id)) perPlayer[id].inContention = false;
          }
        }
        lastTurnEnded = true;
      }
    }
  }

  const lastTurn = turns.length > 0 ? turns[turns.length - 1] : null;
  const open = computeOpenTurn(
    orderedPlayerIds,
    (playerId) => !finished && inContention(playerId),
    lastTurn,
    lastTurnEnded
  );

  const standings = orderedPlayerIds.slice().sort((a, b) => {
    if (finished && winnerId) {
      if (a === winnerId) return -1;
      if (b === winnerId) return 1;
    }
    return perPlayer[b].total - perPlayer[a].total;
  });

  return {
    mode: 'shanghai',
    currentPlayerId: finished ? null : open.currentPlayerId,
    dartsThrownInTurn: open.dartsThrownInTurn,
    turnIndex: open.turnIndex,
    round: open.round,
    turnSegments: open.turnSegments,
    perPlayer,
    activePlayerIds: contenders(),
    standings,
    winnerId,
    finished,
    lastEvent,
  };
}

export const shanghaiEngine: GameEngine<ShanghaiConfig, ShanghaiPlayerState, ShanghaiEvent> = {
  mode: 'shanghai',
  minPlayers: 1,
  maxPlayers: 8,
  parseConfig,
  finalizeConfig,
  deriveState,
};
