export type RealtimePayload = {
  new?: { leg_id?: string; turn_id?: string };
  old?: { leg_id?: string; turn_id?: string };
};

export function getRealtimePayloadLegId(payload: RealtimePayload | null | undefined): string | null {
  return payload?.new?.leg_id ?? payload?.old?.leg_id ?? null;
}

export function getRealtimePayloadTurnId(payload: RealtimePayload | null | undefined): string | null {
  return payload?.new?.turn_id ?? payload?.old?.turn_id ?? null;
}

export function shouldIgnoreRealtimePayload(
  payload: RealtimePayload | null | undefined,
  knownLegIds: Set<string>,
  knownTurnIds: Set<string>
): boolean {
  if (!payload) return false;

  const legId = getRealtimePayloadLegId(payload);
  if (legId) {
    if (knownLegIds.size === 0) return false;
    return !knownLegIds.has(legId);
  }

  const turnId = getRealtimePayloadTurnId(payload);
  if (turnId) {
    if (knownTurnIds.size === 0) return false;
    return !knownTurnIds.has(turnId);
  }

  return false;
}

export function shouldClearLocalOngoingTurn(params: {
  ongoingTurnId: string;
  localDartCount: number;
  persistedTurn: { busted: boolean; throwCount: number } | null;
}): boolean {
  const { ongoingTurnId, localDartCount, persistedTurn } = params;

  if (!persistedTurn) {
    return !ongoingTurnId.startsWith('pending-');
  }

  if (persistedTurn.busted) return true;
  return persistedTurn.throwCount >= 3 && persistedTurn.throwCount > localDartCount;
}

export class PendingThrowBuffer {
  private byTurnId = new Map<string, unknown>();
  private limit: number;

  constructor(limit = 200) {
    this.limit = limit;
  }

  set(turnId: string, payload: unknown) {
    // Map preserves insertion order; delete+set moves key to the end.
    if (this.byTurnId.has(turnId)) {
      this.byTurnId.delete(turnId);
    }
    this.byTurnId.set(turnId, payload);

    if (this.byTurnId.size > this.limit) {
      const oldestKey = this.byTurnId.keys().next().value as string | undefined;
      if (oldestKey) this.byTurnId.delete(oldestKey);
    }
  }

  take(turnId: string): unknown | undefined {
    const payload = this.byTurnId.get(turnId);
    if (payload !== undefined) {
      this.byTurnId.delete(turnId);
    }
    return payload;
  }

  clear() {
    this.byTurnId.clear();
  }
}
