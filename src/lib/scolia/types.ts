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

export type ScoliaBoardOption = {
  id: string;
  name: string;
  isHomeSbc: boolean;
  workerConnectionStatus: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
  boardStatus: string | null;
  workerHeartbeatAt: string | null;
  activeMatchId: string | null;
  activeGameSessionId: string | null;
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
