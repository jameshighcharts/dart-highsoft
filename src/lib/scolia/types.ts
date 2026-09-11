export type ScoliaBoard = {
  id?: string | null;
  name: string;
  serialNumber: string;
  isHomeSbc: boolean;
  workerConnectionStatus?: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
  boardStatus?: string | null;
  boardPhase?: string | null;
  errorType?: string | null;
  lastEventAt?: string | null;
  workerHeartbeatAt?: string | null;
  activeMatch?: ScoliaActiveMatchSummary | null;
  activeGame?: ScoliaActiveGameSummary | null;
};

export type ScoliaActiveGameSummary = {
  id: string;
  mode: string;
  playerNames: string[];
  createdAt: string;
};

export type ScoliaActiveMatchSummary = {
  id: string;
  startScore: string;
  legsToWin: number;
  completedLegs: number;
  playerNames: string[];
  createdAt: string;
};

/** Snapshot of the match or game currently occupying a board. */
export type ScoliaBoardOccupant = {
  kind: 'match' | 'game';
  id: string;
  /** Short description, e.g. "501 · first to 2 legs" or "Cricket". */
  label: string;
  players: string[];
  startedAt: string;
  lastActivityAt: string | null;
  /** Legs played so far (matches only). */
  legsPlayed: number | null;
  /** Turns taken (matches) or darts thrown (games). */
  turnsTaken: number;
};

export type ScoliaBoardOption = {
  id: string;
  name: string;
  isHomeSbc: boolean;
  workerConnectionStatus: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
  boardStatus: string | null;
  workerHeartbeatAt: string | null;
  activeMatchId: string | null;
  activeGameSessionId: string | null;
  activeGame?: ScoliaBoardOccupant | null;
  selectable: boolean;
};

export type ScoliaBoardPublicStatus = {
  boardId: string;
  name: string;
  isHomeSbc: boolean;
  workerConnectionStatus: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
  boardStatus: string | null;
  boardPhase: string | null;
  errorType: string | null;
  lastEventAt: string | null;
  workerHeartbeatAt: string | null;
};
