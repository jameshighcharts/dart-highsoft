'use server';

import { updateTag } from 'next/cache';

import { getAuthenticatedSession } from '@/auth';

import { SHARED_RESULTS_TAG } from './tag';

/**
 * Purges the shared leaderboards and statistics for a viewer who just saw a game finish. A Server
 * Action, because only those apply the purge before they respond: the refetch that follows can't
 * get the copy from before the result.
 *
 * Anyone can call a Server Action (its id is in the page's JavaScript), so it checks the session:
 * otherwise a stranger could purge the cache over and over and make every page recompute.
 */
export async function purgeSharedResults(): Promise<void> {
  if (!(await getAuthenticatedSession())) return;
  updateTag(SHARED_RESULTS_TAG);
}
