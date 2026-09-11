import type { ScoliaBoardOption } from './types';

export type ManualScoringPrompt = {
  /** Boards that are online and free, offered as an alternative to manual scoring. */
  readyBoards: ScoliaBoardOption[];
  /** Boards that are online but already have a match or game running. */
  busyBoards: ScoliaBoardOption[];
};

function isOnline(board: ScoliaBoardOption): boolean {
  return board.workerConnectionStatus !== 'disconnected';
}

function isBusy(board: ScoliaBoardOption): boolean {
  return Boolean(board.activeMatchId || board.activeGameSessionId);
}

/**
 * Decides whether starting a manually scored game should first ask the user
 * to confirm. Returns null when no Scolia board is online, so manual scoring
 * is the only option and no prompt is needed.
 */
export function getManualScoringPrompt(boards: ScoliaBoardOption[]): ManualScoringPrompt | null {
  const online = boards.filter(isOnline);
  if (online.length === 0) return null;
  return {
    readyBoards: online.filter((board) => board.selectable),
    busyBoards: online.filter(isBusy),
  };
}
