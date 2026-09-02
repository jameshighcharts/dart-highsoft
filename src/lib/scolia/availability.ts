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
