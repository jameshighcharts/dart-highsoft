import { hasFreshScoliaHeartbeat, isScoliaTakeoutStuck } from './availability';

/** A viewer's own Realtime channel state: undefined until the first status arrives. */
export function isChannelLive(status: string | undefined) {
  return status === undefined || status === 'SUBSCRIBED';
}

export type ScoliaConnectionTone = 'ready' | 'degraded' | 'down';

export type ScoliaConnectionHealth = {
  tone: ScoliaConnectionTone;
  /** Short headline, e.g. "Ready for darts" or "Scolia worker offline". */
  label: string;
  /** Secondary detail, e.g. the board phase or what to expect. */
  detail: string | null;
  /** When the current degraded state began, if known. */
  since: string | null;
};

type BoardState = {
  workerConnectionStatus?: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | null;
  workerConnectionChangedAt?: string | null;
  workerHeartbeatAt?: string | null;
  boardStatus?: string | null;
  boardPhase?: string | null;
  boardPhaseChangedAt?: string | null;
  errorType?: string | null;
};

/**
 * One answer to "will darts on this board score right now?". The viewer's own live
 * connection comes first: while it is paused everything below it may be stale.
 */
export function describeScoliaConnection(
  board: BoardState | null,
  { now = Date.now(), live = true, online = true }: { now?: number; live?: boolean; online?: boolean } = {},
): ScoliaConnectionHealth {
  if (!online) {
    return { tone: 'degraded', label: 'You are offline', detail: 'Live updates resume when your connection returns', since: null };
  }
  if (!live) {
    return { tone: 'degraded', label: 'Live updates paused', detail: 'Reconnecting…', since: null };
  }
  if (!board) {
    return { tone: 'down', label: 'Board unavailable', detail: 'Not connected to the Scolia account', since: null };
  }
  if (!hasFreshScoliaHeartbeat({ workerHeartbeatAt: board.workerHeartbeatAt ?? null }, now)) {
    return { tone: 'down', label: 'Scolia worker offline', detail: 'Darts are not being scored — enter them manually', since: board.workerHeartbeatAt ?? null };
  }
  if (board.workerConnectionStatus !== 'connected') {
    const status = board.workerConnectionStatus;
    return {
      tone: status === 'disconnected' ? 'down' : 'degraded',
      label: status === 'disconnected' ? 'Scolia disconnected' : 'Reconnecting to Scolia',
      detail: 'Darts thrown now may not register',
      since: board.workerConnectionChangedAt ?? null,
    };
  }
  const boardStatus = board.boardStatus ?? null;
  if (boardStatus !== 'Ready') {
    if (boardStatus === 'Error') {
      return { tone: 'down', label: 'Board error', detail: board.errorType ? `${board.errorType} error` : 'Check the board', since: null };
    }
    if (!boardStatus) {
      return { tone: 'degraded', label: 'Checking board…', detail: null, since: null };
    }
    if (boardStatus === 'Offline') {
      return { tone: 'down', label: 'Board offline', detail: 'Check the board’s power and network', since: null };
    }
    return { tone: 'degraded', label: `Board ${boardStatus.toLowerCase()}`, detail: 'Not detecting darts yet', since: null };
  }
  // The phase is the headline: only the Throw phase scores darts, and compact badges hide the detail.
  if (board.boardPhase === 'Takeout') {
    const phase = { boardPhase: 'Takeout', boardPhaseChangedAt: board.boardPhaseChangedAt ?? null };
    // Without a timestamp a takeout cannot be proven stuck; never cry wolf on a normal one.
    return phase.boardPhaseChangedAt && isScoliaTakeoutStuck(phase, now)
      ? { tone: 'down', label: 'Stuck in takeout', detail: 'Darts won’t register — clear the board or reset its phase', since: phase.boardPhaseChangedAt }
      : { tone: 'degraded', label: 'Removing darts', detail: 'Wait for the board before throwing', since: phase.boardPhaseChangedAt };
  }
  if (board.boardPhase === 'Throw') {
    return { tone: 'ready', label: 'Ready for darts', detail: 'Detecting throws', since: null };
  }
  return { tone: 'ready', label: 'Board ready', detail: null, since: null };
}

/** "45s", "3m", "1h 5m" */
export function formatElapsed(since: string | null, now = Date.now()): string | null {
  const start = since ? Date.parse(since) : Number.NaN;
  if (!Number.isFinite(start)) return null;
  const seconds = Math.max(0, Math.floor((now - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
