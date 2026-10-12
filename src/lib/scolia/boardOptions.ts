import { hasFreshScoliaHeartbeat, isScoliaBoardReady } from './availability';
import type { ScoliaBoardOption, ScoliaBoardPublicStatus } from './types';

/** Apply a live status row to a board option, keeping the occupancy only the API knows. */
export function optionFromStatus(
  status: ScoliaBoardPublicStatus,
  current?: ScoliaBoardOption,
): ScoliaBoardOption {
  const activeMatchId = current?.activeMatchId ?? null;
  const activeGameSessionId = current?.activeGameSessionId ?? null;
  const workerConnectionStatus = hasFreshScoliaHeartbeat(status)
    ? status.workerConnectionStatus
    : 'disconnected';
  const ready = isScoliaBoardReady({
    workerConnectionStatus,
    boardStatus: status.boardStatus,
    workerHeartbeatAt: status.workerHeartbeatAt,
  });
  return {
    id: status.boardId,
    name: status.name,
    isHomeSbc: status.isHomeSbc,
    workerConnectionStatus,
    boardStatus: status.boardStatus,
    workerHeartbeatAt: status.workerHeartbeatAt,
    activeMatchId,
    activeGameSessionId,
    activeGame: current?.activeGame ?? null,
    selectable: ready && !activeMatchId && !activeGameSessionId,
  };
}

/** Merge one live status row into the list without a refetch. */
export function mergeBoardStatus(boards: ScoliaBoardOption[], status: ScoliaBoardPublicStatus): ScoliaBoardOption[] {
  const existing = boards.find((board) => board.id === status.boardId);
  const next = boards.filter((board) => board.id !== status.boardId);
  next.push(optionFromStatus(status, existing));
  return next.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * A dead worker sends nothing, so heartbeat age is the only signal. Returns the same
 * array when nothing expired, so a periodic check does not re-render.
 */
export function expireStaleBoards(boards: ScoliaBoardOption[], now = Date.now()): ScoliaBoardOption[] {
  let changed = false;
  const next = boards.map((board) => {
    if (board.workerConnectionStatus === 'disconnected' || hasFreshScoliaHeartbeat(board, now)) return board;
    changed = true;
    return { ...board, workerConnectionStatus: 'disconnected' as const, selectable: false };
  });
  return changed ? next : boards;
}
