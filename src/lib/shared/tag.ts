/**
 * Every cached copy of the data viewers share (leaderboards, statistics) carries this tag;
 * expiring it makes the next request recompute. See `readSharedData`.
 */
export const SHARED_DATA_TAG = 'shared-data';
