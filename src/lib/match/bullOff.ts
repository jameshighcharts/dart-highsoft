export type BullOffShot = {
  playerId: string;
  distanceMm: number | null;
  round: number;
  eventId?: number;
};
export type BullOffState = {
  revision: number;
  phase: 'throwing' | 'complete';
  round: number;
  order: string[];
  pending: string[];
  distances: Record<string, number[]>;
  shots: BullOffShot[];
  awaitingTakeout: boolean;
};

// A miss sorts behind every measured dart. Equal measurements rethrow.
const MISS_DISTANCE = 10000;
export function createBullOff(playerIds: string[]): BullOffState {
  return { revision: 0, phase: 'throwing', round: 1, order: [...playerIds], pending: [...playerIds], distances: Object.fromEntries(playerIds.map(id => [id, []])), shots: [], awaitingTakeout: false };
}
export function formatBullDistance(distanceMm: number | null): string {
  return distanceMm === null ? 'Miss' : `${(distanceMm / 25.4).toFixed(2)}″`;
}
export function recordBullOffShot(state: BullOffState, shot: Omit<BullOffShot, 'round'>): BullOffState {
  if (state.phase !== 'throwing' || state.awaitingTakeout || state.pending[0] !== shot.playerId) throw new Error('Wait for the current player and dart removal');
  if (shot.distanceMm !== null && (!Number.isFinite(shot.distanceMm) || shot.distanceMm < 0 || shot.distanceMm > 1000)) throw new Error('Invalid distance');
  // Compare at 0.1 mm precision, including hardware measurements.
  const distanceMm = shot.distanceMm === null ? null : Math.round(shot.distanceMm * 10) / 10;
  return { ...state, revision: state.revision + 1, awaitingTakeout: true,
    distances: { ...state.distances, [shot.playerId]: [...state.distances[shot.playerId], distanceMm ?? MISS_DISTANCE] },
    shots: [...state.shots, { ...shot, distanceMm, round: state.round }] };
}
export function finishBullOffTakeout(state: BullOffState): BullOffState {
  if (!state.awaitingTakeout || state.phase === 'complete') return state;
  const next = { ...state, revision: state.revision + 1, awaitingTakeout: false, pending: state.pending.slice(1) };
  if (next.pending.length) return next;
  const compare = (a: string, b: string) => {
    const left = state.distances[a]; const right = state.distances[b];
    for (let i = 0; i < Math.min(left.length, right.length); i++) {
      if (left[i] !== right[i]) return left[i] - right[i];
    }
    return left.length - right.length;
  };
  next.order = [...state.order].sort(compare);
  next.pending = next.order.filter((id, index, order) =>
    (index > 0 && compare(id, order[index - 1]) === 0) || (index + 1 < order.length && compare(id, order[index + 1]) === 0));
  if (next.pending.length) next.round++;
  else next.phase = 'complete';
  return next;
}

/** Provisional ranking: pending darts sort last within their original tied group. */
export function liveBullOffOrder(state: BullOffState): string[] {
  return [...state.order].sort((a, b) => {
    const left = state.distances[a]; const right = state.distances[b];
    for (let index = 0; index < Math.max(left.length, right.length); index++) {
      const difference = (left[index] ?? Infinity) - (right[index] ?? Infinity);
      if (difference && !Number.isNaN(difference)) return difference;
    }
    return 0;
  });
}
