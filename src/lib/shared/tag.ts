/**
 * Every cached copy of the data viewers share (leaderboards, statistics) carries both tags. See
 * `readSharedData`.
 *
 * - `SHARED_DATA_TAG` is marked stale after any change: the next request still gets the previous
 *   copy while it recomputes (`revalidateTag(SHARED_DATA_TAG, 'max')`).
 * - `SHARED_RESULTS_TAG` is purged when a result changes (a leg or game won, or the win undone):
 *   nobody gets a copy from before it (`{ expire: 0 }`, or `updateTag` in a Server Action).
 *
 * They are separate because Next keeps one expiry per tag and each call overwrites it: a stale
 * mark after a purge on the same tag would make the purged copies servable again.
 */
export const SHARED_DATA_TAG = 'shared-data';
export const SHARED_RESULTS_TAG = 'shared-results';
