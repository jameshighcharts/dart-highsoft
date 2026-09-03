// Killer game engine.
// Loaded by the Scolia worker via `node --experimental-strip-types`: relative
// `.ts` imports only, no enums, no parameter properties, no framework imports.

import type {
  ConfigParseResult,
  GameEngine,
  GameState,
  GameThrowInput,
  KillerConfig,
  KillerEvent,
  KillerPlayerState,
} from '../types.ts';
import { computeOpenTurn, groupTurns, isRecord, readBoolean, readChoice, readInt } from '../replay.ts';
import { parseSegment } from '../segment.ts';

const KILLER_REQUIREMENTS = ['double', 'any'] as const;
const ASSIGNMENTS = ['random', 'choose'] as const;

const DEFAULT_CONFIG: KillerConfig = {
  lives: 3,
  killerRequirement: 'double',
  hitToKill: 'double',
  selfHitPenalty: true,
  assignment: 'random',
  assignedNumbers: {},
};

function isValidNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 20;
}

function parseConfig(input: unknown): ConfigParseResult<KillerConfig> {
  const raw: Record<string, unknown> = isRecord(input) ? input : {};

  const lives = readInt(raw.lives, DEFAULT_CONFIG.lives, 1, 5);
  if (lives === null) return { ok: false, error: 'lives must be an integer between 1 and 5' };

  const killerRequirement = readChoice(raw.killerRequirement, KILLER_REQUIREMENTS, DEFAULT_CONFIG.killerRequirement);
  if (killerRequirement === null) return { ok: false, error: "killerRequirement must be 'double' or 'any'" };

  const hitToKill = readChoice(raw.hitToKill, KILLER_REQUIREMENTS, DEFAULT_CONFIG.hitToKill);
  if (hitToKill === null) return { ok: false, error: "hitToKill must be 'double' or 'any'" };

  const assignment = readChoice(raw.assignment, ASSIGNMENTS, DEFAULT_CONFIG.assignment);
  if (assignment === null) return { ok: false, error: "assignment must be 'random' or 'choose'" };

  const selfHitPenalty = readBoolean(raw.selfHitPenalty, DEFAULT_CONFIG.selfHitPenalty);

  const assignedNumbers: Record<string, number> = {};
  if (raw.assignedNumbers !== undefined && raw.assignedNumbers !== null) {
    if (!isRecord(raw.assignedNumbers)) {
      return { ok: false, error: 'assignedNumbers must be an object of playerId -> number' };
    }
    for (const [playerId, value] of Object.entries(raw.assignedNumbers)) {
      if (!isValidNumber(value)) {
        return { ok: false, error: `assignedNumbers[${playerId}] must be an integer between 1 and 20` };
      }
      assignedNumbers[playerId] = value;
    }
  }

  return {
    ok: true,
    config: { lives, killerRequirement, hitToKill, selfHitPenalty, assignment, assignedNumbers },
  };
}

function finalizeConfig(config: KillerConfig, orderedPlayerIds: string[], random: () => number): KillerConfig {
  const chosen: Record<string, number> = {};
  for (const playerId of orderedPlayerIds) {
    const value = config.assignedNumbers[playerId];
    if (isValidNumber(value)) chosen[playerId] = value;
  }

  const seen = new Map<number, number>();
  for (const value of Object.values(chosen)) seen.set(value, (seen.get(value) ?? 0) + 1);
  const hasCollision = [...seen.values()].some((count) => count > 1);
  const allAssigned = orderedPlayerIds.every((playerId) => chosen[playerId] !== undefined);

  if (config.assignment !== 'random' && allAssigned && !hasCollision) {
    return { ...config, assignedNumbers: chosen };
  }

  // Keep numbers that were chosen exactly once; everyone else draws from the pool.
  const kept: Record<string, number> = {};
  if (config.assignment !== 'random') {
    for (const [playerId, value] of Object.entries(chosen)) {
      if (seen.get(value) === 1) kept[playerId] = value;
    }
  }

  const taken = new Set(Object.values(kept));
  const pool: number[] = [];
  for (let n = 1; n <= 20; n++) if (!taken.has(n)) pool.push(n);

  const assignedNumbers: Record<string, number> = {};
  for (const playerId of orderedPlayerIds) {
    const existing = kept[playerId];
    if (existing !== undefined) {
      assignedNumbers[playerId] = existing;
      continue;
    }
    if (pool.length === 0) break;
    const index = Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)));
    assignedNumbers[playerId] = pool[index] as number;
    pool.splice(index, 1);
  }

  return { ...config, assignedNumbers };
}

function meetsRequirement(multiplier: 1 | 2 | 3, requirement: 'double' | 'any'): boolean {
  return requirement === 'any' ? true : multiplier === 2;
}

function deriveState(
  config: KillerConfig,
  orderedPlayerIds: string[],
  throws: GameThrowInput[]
): GameState<KillerPlayerState, KillerEvent> {
  const perPlayer: Record<string, KillerPlayerState> = {};
  for (const playerId of orderedPlayerIds) {
    const number = config.assignedNumbers[playerId];
    perPlayer[playerId] = {
      number: isValidNumber(number) ? number : 0,
      lives: config.lives,
      isKiller: false,
      eliminated: false,
      kills: 0,
      eliminatedOrder: null,
    };
  }

  const numberOwner = new Map<number, string>();
  for (const playerId of orderedPlayerIds) {
    const state = perPlayer[playerId];
    if (state && state.number > 0 && !numberOwner.has(state.number)) numberOwner.set(state.number, playerId);
  }

  const canWin = orderedPlayerIds.length >= 2;
  let eliminatedCount = 0;
  let finished = false;
  let winnerId: string | null = null;
  let lastEvent: KillerEvent | null = null;

  const aliveIds = () => orderedPlayerIds.filter((id) => !perPlayer[id]?.eliminated);

  const eliminate = (playerId: string) => {
    const state = perPlayer[playerId];
    if (!state || state.eliminated) return;
    state.eliminated = true;
    state.isKiller = false;
    eliminatedCount += 1;
    state.eliminatedOrder = eliminatedCount;
  };

  const applyDart = (dart: GameThrowInput): KillerEvent => {
    const event: KillerEvent = {
      type: 'killer_throw',
      playerId: dart.playerId,
      becameKiller: false,
      victimId: null,
      kill: false,
      selfHit: false,
      eliminatedPlayerId: null,
    };
    if (finished) return event;

    const thrower = perPlayer[dart.playerId];
    if (!thrower || thrower.eliminated || thrower.number === 0) return event;

    const parsed = parseSegment(dart.segment);
    if (!parsed || parsed.kind !== 'number') return event;

    if (parsed.value === thrower.number) {
      if (!meetsRequirement(parsed.multiplier, config.killerRequirement)) return event;
      if (!thrower.isKiller) {
        thrower.isKiller = true;
        event.becameKiller = true;
      } else if (config.selfHitPenalty) {
        event.selfHit = true;
        thrower.lives = Math.max(0, thrower.lives - 1);
        if (thrower.lives === 0) {
          eliminate(dart.playerId);
          event.eliminatedPlayerId = dart.playerId;
        }
      }
    } else if (thrower.isKiller) {
      if (!meetsRequirement(parsed.multiplier, config.hitToKill)) return event;
      const victimId = numberOwner.get(parsed.value);
      if (!victimId || victimId === dart.playerId) return event;
      const victim = perPlayer[victimId];
      if (!victim || victim.eliminated) return event;
      event.victimId = victimId;
      event.kill = true;
      victim.lives = Math.max(0, victim.lives - 1);
      thrower.kills += 1;
      if (victim.lives === 0) {
        eliminate(victimId);
        event.eliminatedPlayerId = victimId;
      }
    }

    if (canWin) {
      const alive = aliveIds();
      if (alive.length === 1) {
        finished = true;
        winnerId = alive[0] ?? null;
      }
    }
    return event;
  };

  const turns = groupTurns(throws);
  for (const turn of turns) {
    for (const dart of turn.darts) lastEvent = applyDart(dart);
  }

  const eligible = (playerId: string) => !finished && !perPlayer[playerId]?.eliminated;
  const lastTurn = turns.length > 0 ? (turns[turns.length - 1] as (typeof turns)[number]) : null;
  const open = computeOpenTurn(orderedPlayerIds, eligible, lastTurn, finished);

  const activePlayerIds = aliveIds();
  const eliminatedIds = orderedPlayerIds
    .filter((id) => perPlayer[id]?.eliminated)
    .sort((a, b) => (perPlayer[b]?.eliminatedOrder ?? 0) - (perPlayer[a]?.eliminatedOrder ?? 0));
  const survivors = winnerId ? [winnerId, ...activePlayerIds.filter((id) => id !== winnerId)] : activePlayerIds;

  return {
    mode: 'killer',
    currentPlayerId: finished ? null : open.currentPlayerId,
    dartsThrownInTurn: finished ? 0 : open.dartsThrownInTurn,
    turnIndex: open.turnIndex,
    round: open.round,
    turnSegments: finished ? [] : open.turnSegments,
    perPlayer,
    activePlayerIds,
    standings: [...survivors, ...eliminatedIds],
    winnerId,
    finished,
    lastEvent,
  };
}

export const killerEngine: GameEngine<KillerConfig, KillerPlayerState, KillerEvent> = {
  mode: 'killer',
  minPlayers: 2,
  maxPlayers: 20,
  parseConfig,
  finalizeConfig,
  deriveState,
};
