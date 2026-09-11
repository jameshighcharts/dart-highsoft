import type { ScoliaBoardOption } from './types';

export type ManualScoringPrompt = {
  /** Boards that are online and free, offered as an alternative to manual scoring. */
  readyBoards: ScoliaBoardOption[];
  /** Boards that are online but already have a match or game running. */
  busyBoards: ScoliaBoardOption[];
};

function isBusy(board: ScoliaBoardOption): boolean {
  return board.workerConnectionStatus !== 'disconnected' && Boolean(board.activeMatchId || board.activeGameSessionId);
}

/**
 * Decides whether starting a manually scored game should first ask the user
 * to confirm. Returns null when no board is free and no online board has a
 * game running, so manual scoring is the only option and no prompt is needed.
 * A board whose worker is connected but whose Scolia unit is switched off does
 * not count as online.
 */
export function getManualScoringPrompt(boards: ScoliaBoardOption[]): ManualScoringPrompt | null {
  const readyBoards = boards.filter((board) => board.selectable);
  const busyBoards = boards.filter(isBusy);
  if (readyBoards.length === 0 && busyBoards.length === 0) return null;
  return { readyBoards, busyBoards };
}
