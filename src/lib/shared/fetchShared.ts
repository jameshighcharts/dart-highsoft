import { deserializeQueryCache } from '@/lib/queryCacheSerialization';

import { purgeSharedResults } from './purge';

export type SharedDataParams = Record<string, string | undefined>;

/**
 * Loads data every viewer shares from the server's cache (`/api/shared/<name>`), which computes it
 * once per change instead of once per visit. If the server can't answer, the browser computes it
 * itself with `fallback`, the same loader the server runs.
 */
export async function fetchShared<T>(name: string, params: SharedDataParams, fallback: () => Promise<T>): Promise<T> {
  if (typeof window === 'undefined') return fallback();
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, value);
  }
  const query = search.toString();
  let response: Response;
  try {
    response = await fetch(`/api/shared/${name}${query ? `?${query}` : ''}`, { credentials: 'same-origin' });
  } catch {
    return fallback();
  }
  if (!response.ok) return fallback();
  return deserializeQueryCache<T>(await response.text());
}

/**
 * Purges the server's shared copies, so the next load computes them from the database: after a
 * game, its players see their result straight away. The database purges them by itself within
 * seconds of a result, so a failure here only delays the update.
 */
export async function expireSharedData(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    await purgeSharedResults();
  } catch {
    // The database-side purge covers it.
  }
}
