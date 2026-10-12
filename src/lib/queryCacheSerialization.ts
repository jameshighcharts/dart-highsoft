/**
 * JSON for the persisted query cache that keeps the Map, Set and Date values query data uses;
 * plain JSON would restore them as empty objects and strings.
 */
type Tagged =
  | { __persistedType: 'Map'; entries: [unknown, unknown][] }
  | { __persistedType: 'Set'; values: unknown[] }
  | { __persistedType: 'Date'; iso: string };

function replacer(this: Record<string, unknown>, key: string, value: unknown): unknown {
  // JSON.stringify has already called Date#toJSON on `value`; the holder still has the Date.
  const raw = this[key];
  if (raw instanceof Date) return { __persistedType: 'Date', iso: raw.toISOString() } satisfies Tagged;
  if (value instanceof Map) return { __persistedType: 'Map', entries: [...value.entries()] } satisfies Tagged;
  if (value instanceof Set) return { __persistedType: 'Set', values: [...value] } satisfies Tagged;
  return value;
}

function reviver(_key: string, value: unknown): unknown {
  if (!value || typeof value !== 'object' || !('__persistedType' in value)) return value;
  const tagged = value as Tagged;
  if (tagged.__persistedType === 'Map') return new Map(tagged.entries);
  if (tagged.__persistedType === 'Set') return new Set(tagged.values);
  if (tagged.__persistedType === 'Date') return new Date(tagged.iso);
  return value;
}

export function serializeQueryCache(value: unknown): string {
  return JSON.stringify(value, replacer);
}

export function deserializeQueryCache<T>(text: string): T {
  return JSON.parse(text, reviver) as T;
}
