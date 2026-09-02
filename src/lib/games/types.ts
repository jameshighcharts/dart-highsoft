// Shared contracts for the event-sourced party game modes.
// Everything here is imported by the Scolia worker (node --experimental-strip-types):
// use string unions instead of enums and relative `.ts` imports only.

export const GAME_MODES = ['cricket', 'killer', 'shanghai', 'around_the_clock'] as const;
export type GameMode = (typeof GAME_MODES)[number];

export type GameSessionStatus = 'active' | 'completed' | 'ended_early';

/** One stored dart. Order is defined by (turnIndex, dartIndex). */
export type GameThrowInput = {
  id: string;
  playerId: string;
  roundNumber: number;
  turnIndex: number;
  dartIndex: number;
  segment: string;
  scored: number;
};

/** Engine-specific description of what the latest dart did; persisted to game_throws.meta. */
export type GameEvent = { type: string; playerId: string } & Record<string, unknown>;

export type GameState<P = unknown, E extends GameEvent = GameEvent> = {
  mode: GameMode;
  /** Player who throws next, or null once the game is finished. */
  currentPlayerId: string | null;
  /** Darts already thrown in the open turn (0..2). */
  dartsThrownInTurn: number;
  /** Open turn index, i.e. the next row's turn_index. */
  turnIndex: number;
  /** Open turn round, i.e. the next row's round_number. */
  round: number;
  /** Segments thrown so far in the open turn, in order. */
  turnSegments: string[];
  perPlayer: Record<string, P>;
  /** Players still in the game (not eliminated, not finished). */
  activePlayerIds: string[];
  /** Ranked player ids, best first; complete once finished. */
  standings: string[];
  winnerId: string | null;
  finished: boolean;
  lastEvent: E | null;
};

export type ConfigParseResult<C> = { ok: true; config: C } | { ok: false; error: string };

export interface GameEngine<C = unknown, P = unknown, E extends GameEvent = GameEvent> {
  readonly mode: GameMode;
  readonly minPlayers: number;
  readonly maxPlayers: number;
  /** Validate raw config from the client and fill defaults. */
  parseConfig(input: unknown): ConfigParseResult<C>;
  /** Called once at creation/rematch with the final player order (e.g. Killer numbers). */
  finalizeConfig(config: C, orderedPlayerIds: string[], random: () => number): C;
  /** Pure replay of the throw log into a full game state. */
  deriveState(config: C, orderedPlayerIds: string[], throws: GameThrowInput[]): GameState<P, E>;
}

// ---- Per-mode configs -------------------------------------------------------

export type CricketConfig = {
  variant: 'standard' | 'cut_throat';
  /** Rounds before the game is decided on points; null for unlimited. */
  maxRounds: number | null;
};

export type KillerConfig = {
  lives: number;
  /** What a player must hit on their own number to become a killer. */
  killerRequirement: 'double' | 'any';
  /** What a killer must hit on an opponent's number to take a life. */
  hitToKill: 'double' | 'any';
  /** A killer hitting their own number loses a life. */
  selfHitPenalty: boolean;
  assignment: 'random' | 'choose';
  /** playerId -> number 1..20; filled by finalizeConfig (random) or the UI (choose). */
  assignedNumbers: Record<string, number>;
};

export type ShanghaiConfig = {
  rounds: number;
  startNumber: number;
};

export type AroundTheClockConfig = {
  includeBull: boolean;
  bullRequirement: 'any' | 'double';
  /** Doubles advance two steps, trebles three. */
  skipOnDoubleTreble: boolean;
  /** Everyone finishes the round; fewest darts wins. */
  fairFinish: boolean;
};

export type GameConfigByMode = {
  cricket: CricketConfig;
  killer: KillerConfig;
  shanghai: ShanghaiConfig;
  around_the_clock: AroundTheClockConfig;
};

// ---- Per-mode player state --------------------------------------------------

export const CRICKET_TARGETS = [20, 19, 18, 17, 16, 15, 25] as const;
/** 25 stands for Bull. */
export type CricketTarget = (typeof CRICKET_TARGETS)[number];

export type CricketPlayerState = {
  marks: Record<CricketTarget, number>;
  points: number;
  dartsThrown: number;
};

export type KillerPlayerState = {
  number: number;
  lives: number;
  isKiller: boolean;
  eliminated: boolean;
  kills: number;
  /** Order in which the player was knocked out (1 = first out); null while alive. */
  eliminatedOrder: number | null;
};

export type ShanghaiPlayerState = {
  total: number;
  /** Points scored per round, indexed by round number. */
  roundScores: Record<number, number>;
  /** Still competing (relevant during sudden-death). */
  inContention: boolean;
};

export type AroundTheClockPlayerState = {
  /** 1..20, or 25 for Bull. */
  target: number;
  finished: boolean;
  dartsThrown: number;
  /** Turn index in which the player finished; used for fair-finish ties. */
  finishedAtTurnIndex: number | null;
};

// ---- Per-mode events (persisted as meta) ------------------------------------

export type CricketEvent = GameEvent & {
  type: 'cricket_throw';
  target: CricketTarget | null;
  marks: number;
  pointsScored: number;
  closed: boolean;
};

export type KillerEvent = GameEvent & {
  type: 'killer_throw';
  becameKiller: boolean;
  victimId: string | null;
  kill: boolean;
  selfHit: boolean;
  eliminatedPlayerId: string | null;
};

export type ShanghaiEvent = GameEvent & {
  type: 'shanghai_throw';
  target: number;
  hit: boolean;
  pointsScored: number;
  shanghai: boolean;
};

export type AroundTheClockEvent = GameEvent & {
  type: 'clock_throw';
  target: number;
  hit: boolean;
  nextTarget: number | null;
  finished: boolean;
};

// ---- Helpers shared by engines ---------------------------------------------

export function sortThrows<T extends { turnIndex: number; dartIndex: number }>(throws: T[]): T[] {
  return throws.slice().sort((a, b) => a.turnIndex - b.turnIndex || a.dartIndex - b.dartIndex);
}

export function isGameMode(value: unknown): value is GameMode {
  return typeof value === 'string' && (GAME_MODES as readonly string[]).includes(value);
}
