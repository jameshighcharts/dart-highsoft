function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * React Query's structural sharing, extended to Map, Set and Date: returns `prev` (or the parts of
 * it) wherever `next` holds equal data, so unchanged query results keep their identity.
 *
 * The built-in version treats a Map as opaque and returns the new one, so every refetch of data
 * holding Maps (the leaderboards) looked changed and rebuilt everything derived from it, the home
 * grid included, even when nothing had changed.
 */
export function shareStructurally<T>(prev: unknown, next: T): T {
  if (Object.is(prev, next)) return prev as T;

  if (prev instanceof Date && next instanceof Date) {
    return (prev.getTime() === next.getTime() ? prev : next) as T;
  }

  if (prev instanceof Map && next instanceof Map) {
    let same = prev.size === next.size;
    const shared = new Map();
    for (const [key, value] of next) {
      const previous = prev.get(key);
      const item = prev.has(key) ? shareStructurally(previous, value) : value;
      if (item !== previous || !prev.has(key)) same = false;
      shared.set(key, item);
    }
    return (same ? prev : shared) as T;
  }

  if (prev instanceof Set && next instanceof Set) {
    const same = prev.size === next.size && [...next].every((value) => prev.has(value));
    return (same ? prev : next) as T;
  }

  if (Array.isArray(prev) && Array.isArray(next)) {
    let same = prev.length === next.length;
    const shared = next.map((value, index) => {
      const item = shareStructurally(prev[index], value);
      if (item !== prev[index]) same = false;
      return item;
    });
    return (same ? prev : shared) as T;
  }

  if (isPlainObject(prev) && isPlainObject(next)) {
    const prevKeys = Object.keys(prev);
    const nextKeys = Object.keys(next);
    let same = prevKeys.length === nextKeys.length;
    const shared: Record<string, unknown> = {};
    for (const key of nextKeys) {
      const item = shareStructurally(prev[key], next[key]);
      if (item !== prev[key] || !(key in prev)) same = false;
      shared[key] = item;
    }
    return (same ? prev : shared) as T;
  }

  return next;
}
