export type ScoliaMessage = {
  type: string;
  id: string;
  payload?: Record<string, unknown>;
};

export type ScoliaBoardStatePatch = {
  board_status?: string | null;
  board_phase?: string | null;
  error_type?: string | null;
};

export type ScoliaDetectedThrow = {
  segment: 'Miss' | 'SB' | 'DB' | `S${number}` | `D${number}` | `T${number}`;
  scored: number;
  impactXmm?: number;
  impactYmm?: number;
  angleHorizontalDeg?: number;
  angleVerticalDeg?: number;
};

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function parseScoliaMessage(raw: string): ScoliaMessage | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object') return null;
    const message = value as Record<string, unknown>;
    if (typeof message.type !== 'string' || typeof message.id !== 'string') return null;
    if (message.payload != null && (typeof message.payload !== 'object' || Array.isArray(message.payload))) {
      return null;
    }
    return {
      type: message.type,
      id: message.id,
      ...(message.payload ? { payload: message.payload as Record<string, unknown> } : {}),
    };
  } catch {
    return null;
  }
}

export function boardStatePatchForMessage(message: ScoliaMessage): ScoliaBoardStatePatch {
  const payload = message.payload ?? {};
  if (message.type === 'HELLO_CLIENT' || message.type === 'SBC_STATUS' || message.type === 'SBC_STATUS_CHANGED') {
    return {
      board_status: stringOrNull(payload.boardStatus),
      board_phase: stringOrNull(payload.boardPhase),
      error_type: stringOrNull(payload.errorType),
    };
  }
  if (message.type === 'TAKEOUT_STARTED') return { board_phase: 'Takeout' };
  if (message.type === 'TAKEOUT_FINISHED' || message.type === 'THROW_DETECTED') {
    return { board_phase: 'Throw' };
  }
  return {};
}

export function occurredAtForMessage(message: ScoliaMessage): string | null {
  const candidate = message.payload?.detectionTime ?? message.payload?.time;
  if (typeof candidate !== 'string') return null;
  return Number.isNaN(Date.parse(candidate)) ? null : candidate;
}

/** Convert Scolia's sector vocabulary to the app's canonical segment labels. */
export function detectedThrowFromMessage(message: ScoliaMessage): ScoliaDetectedThrow | null {
  if (message.type !== 'THROW_DETECTED') return null;
  const payload = message.payload ?? {};
  if (typeof payload.bounceout !== 'boolean' || typeof payload.sector !== 'string') return null;
  const coordinates = Array.isArray(payload.coordinates) ? payload.coordinates : null;
  const angle = payload.angle && typeof payload.angle === 'object' ? payload.angle as Record<string, unknown> : null;
  const geometry = coordinates?.length === 2
    && coordinates.every((value) => typeof value === 'number' && value >= -250 && value <= 250)
    && typeof angle?.horizontal === 'number' && angle.horizontal >= -90 && angle.horizontal <= 90
    && typeof angle?.vertical === 'number' && angle.vertical >= -90 && angle.vertical <= 90
      ? {
          impactXmm: coordinates[0] as number,
          impactYmm: coordinates[1] as number,
          angleHorizontalDeg: angle.horizontal,
          angleVerticalDeg: angle.vertical,
        }
      : {};
  if (payload.bounceout || payload.sector === 'None') return { segment: 'Miss', scored: 0, ...geometry };
  if (payload.sector === '25') return { segment: 'SB', scored: 25, ...geometry };
  if (payload.sector === 'Bull') return { segment: 'DB', scored: 50, ...geometry };

  const match = payload.sector.match(/^([SsDT])(\d{1,2})$/);
  if (!match) return null;
  const value = Number.parseInt(match[2] ?? '', 10);
  if (!Number.isInteger(value) || value < 1 || value > 20) return null;
  const modifier = match[1]?.toUpperCase() as 'S' | 'D' | 'T';
  const multiplier = modifier === 'D' ? 2 : modifier === 'T' ? 3 : 1;
  return { segment: `${modifier}${value}`, scored: value * multiplier, ...geometry };
}

export function reconnectDelayMs(closeCode: number, attempt: number, random = Math.random): number {
  if (closeCode === 4100 || closeCode === 4102) return 5 * 60_000;
  if (closeCode === 4101) return 30_000;
  const exponential = Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5));
  return exponential + Math.floor(random() * 500);
}
