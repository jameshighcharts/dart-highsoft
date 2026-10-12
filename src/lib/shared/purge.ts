'use server';

import { updateTag } from 'next/cache';

import { SHARED_RESULTS_TAG } from './tag';

/**
 * Purges the shared leaderboards and statistics for a viewer who just saw a game finish. A Server
 * Action, because only those apply the purge before they respond: the refetch that follows can't
 * get the copy from before the result.
 */
export async function purgeSharedResults(): Promise<void> {
  updateTag(SHARED_RESULTS_TAG);
}
