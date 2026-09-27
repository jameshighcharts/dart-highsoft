export const SCOLIA_HEARTBEAT_MAX_AGE_MS = 45_000;

export type ScoliaBoardRuntimeState = {
  workerConnectionStatus: string;
  boardStatus: string | null;
  workerHeartbeatAt: string | null;
};

export function hasFreshScoliaHeartbeat(state: Pick<ScoliaBoardRuntimeState, 'workerHeartbeatAt'>, now = Date.now()): boolean {
  const heartbeatTime = state.workerHeartbeatAt ? Date.parse(state.workerHeartbeatAt) : Number.NaN;
  return Number.isFinite(heartbeatTime) && now - heartbeatTime < SCOLIA_HEARTBEAT_MAX_AGE_MS;
}

export function isScoliaBoardReady(state: ScoliaBoardRuntimeState, now = Date.now()): boolean {
  return hasFreshScoliaHeartbeat(state, now) && state.workerConnectionStatus === 'connected' && state.boardStatus === 'Ready';
}

/** A normal dart removal takes a few seconds; longer means the board is stuck and blind to throws. */
export const SCOLIA_STUCK_TAKEOUT_MS = 12_000;
/** The server accepts a reset slightly early so client/server clock skew cannot block it. */
const STUCK_TAKEOUT_TOLERANCE_MS = 2_000;

export function isScoliaTakeoutStuck(
  state: { boardPhase: string | null; boardPhaseChangedAt: string | null },
  now = Date.now(),
  matchCreatedAt?: string | null
): boolean {
  if (state.boardPhase !== 'Takeout') return false;
  const changedAt = state.boardPhaseChangedAt ? Date.parse(state.boardPhaseChangedAt) : Number.NaN;
  // Rows written before the phase timestamp existed cannot prove freshness; allow the reset.
  if (!Number.isFinite(changedAt)) return true;
  if (takeoutPredatesMatch(state.boardPhaseChangedAt, matchCreatedAt)) return true;
  return now - changedAt >= SCOLIA_STUCK_TAKEOUT_MS - STUCK_TAKEOUT_TOLERANCE_MS;
}

/**
 * A dart removal that began before the match was even created is left over from
 * earlier play and is stuck, however recent it is. Both times are database clocks.
 */
export function takeoutPredatesMatch(boardPhaseChangedAt: string | null | undefined, matchCreatedAt: string | null | undefined): boolean {
  if (!boardPhaseChangedAt || !matchCreatedAt) return false;
  const changedAt = Date.parse(boardPhaseChangedAt);
  const createdAt = Date.parse(matchCreatedAt);
  return Number.isFinite(changedAt) && Number.isFinite(createdAt) && changedAt < createdAt;
}
