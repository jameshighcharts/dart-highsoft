// Strict parser for the app's canonical segment labels.
// Shared by the X01 throws route, the game engines, and Scolia ingestion, so
// keep it free of framework imports (the Scolia worker loads it directly).

export type ParsedSegment =
  | { kind: 'miss'; scored: 0 }
  | { kind: 'number'; value: number; multiplier: 1 | 2 | 3; scored: number }
  | { kind: 'bull'; multiplier: 1 | 2; scored: 25 | 50 };

/**
 * Parse a segment label such as `T20`, `D16`, `S5`, `SB`, `DB`, `Miss`.
 * Legacy `OuterBull` / `InnerBull` labels are accepted for stored rows.
 * Returns `null` for anything else so callers can reject bad input.
 */
export function parseSegment(segment: string): ParsedSegment | null {
  if (segment === 'Miss') return { kind: 'miss', scored: 0 };
  if (segment === 'SB' || segment === 'OuterBull') return { kind: 'bull', multiplier: 1, scored: 25 };
  if (segment === 'DB' || segment === 'InnerBull') return { kind: 'bull', multiplier: 2, scored: 50 };

  const match = segment.match(/^([SDT])(\d{1,2})$/);
  if (!match) return null;
  const value = Number.parseInt(match[2] ?? '', 10);
  if (!Number.isInteger(value) || value < 1 || value > 20) return null;
  const multiplier = match[1] === 'S' ? 1 : match[1] === 'D' ? 2 : 3;
  return { kind: 'number', value, multiplier, scored: value * multiplier };
}

/** Points a segment is worth, or `null` when the label is invalid. */
export function scoreFromSegment(segment: string): number | null {
  return parseSegment(segment)?.scored ?? null;
}
