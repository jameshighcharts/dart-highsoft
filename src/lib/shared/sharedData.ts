import { unstable_cache } from 'next/cache';

import { calendarIn, canonicalTimeZone, isValidTimeZone } from '@/lib/localCalendar';
import { loadEloHistories } from '@/lib/queries/eloHistory';
import { fetchLeaderboardData, fetchLeaderboardListsData } from '@/lib/queries/leaderboardData';
import {
  loadBullers,
  loadGameModeLeaders,
  loadHighestCheckouts,
  loadQuickestLegs,
  loadTopRoundScores,
} from '@/lib/queries/leaderboards';
import { serializeQueryCache } from '@/lib/queryCacheSerialization';
import { loadPlayerStatsBundle } from '@/lib/stats/playerBundle';
import { fetchStatsGlobalData } from '@/lib/stats/remote';

import { SHARED_DATA_TAG, SHARED_RESULTS_TAG } from './tag';

/**
 * After this long a copy is recomputed even without a change, in case an expiry from the database
 * was missed: the first request after it still gets the old copy while it recomputes.
 */
const MAX_AGE_SECONDS = 300;

/**
 * Copies from an earlier deploy may have another shape, and the cache outlives deploys: each build
 * reads only its own.
 */
const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PLAYER_IDS = 200;

type Entry = { key: string[]; load: () => Promise<unknown> };
type Resolver = (params: URLSearchParams) => Entry | null;

/** An optional positive limit; null when the parameter is present but not one. */
function parseLimit(params: URLSearchParams): number | undefined | null {
  const raw = params.get('limit');
  if (raw === null) return undefined;
  const limit = Number(raw);
  return Number.isInteger(limit) && limit > 0 && limit <= 1000 ? limit : null;
}

function parsePlayerIds(raw: string | null): string[] | null {
  if (raw === null) return null;
  const ids = raw === '' ? [] : raw.split(',');
  if (ids.length > MAX_PLAYER_IDS || !ids.every((id) => UUID.test(id))) return null;
  // One key per set of players, whatever order or casing they come in.
  return [...new Set(ids.map((id) => id.toLowerCase()))].sort();
}

const unparameterized = (name: string, load: () => Promise<unknown>): Resolver =>
  (params) => ([...params.keys()].length === 0 ? { key: [name], load } : null);

const RESOLVERS: Record<string, Resolver> = {
  leaderboard: (params) => {
    const limit = parseLimit(params);
    const requested = params.get('tz');
    if (limit === null || !requested || requested.length > 64 || !isValidTimeZone(requested)) return null;
    // One key per zone however it is spelled (time zone names are case-insensitive).
    const timeZone = canonicalTimeZone(requested);
    // The viewer's local date is part of the key, so the day windows move at their midnight.
    const today = calendarIn(timeZone).dateKey(new Date());
    return { key: ['leaderboard', String(limit), timeZone, today], load: () => fetchLeaderboardData(limit, timeZone) };
  },
  'leaderboard-lists': (params) => {
    const limit = parseLimit(params);
    if (limit === null) return null;
    return { key: ['leaderboard-lists', String(limit)], load: () => fetchLeaderboardListsData(limit) };
  },
  'elo-history': (params) => {
    const ids = parsePlayerIds(params.get('ids'));
    if (!ids) return null;
    return { key: ['elo-history', ids.join(',')], load: () => loadEloHistories(ids) };
  },
  bullers: unparameterized('bullers', loadBullers),
  'top-round-scores': unparameterized('top-round-scores', loadTopRoundScores),
  'highest-checkouts': unparameterized('highest-checkouts', loadHighestCheckouts),
  'quickest-legs': unparameterized('quickest-legs', loadQuickestLegs),
  'game-modes': unparameterized('game-modes', loadGameModeLeaders),
  'stats-global': unparameterized('stats-global', fetchStatsGlobalData),
  'stats-player': (params) => {
    const playerId = params.get('player');
    if (!playerId || !UUID.test(playerId) || [...params.keys()].length !== 1) return null;
    return { key: ['stats-player', playerId], load: () => loadPlayerStatsBundle(playerId) };
  },
};

/**
 * Data every viewer shares, computed once per change instead of once per visit. The database
 * queues a `revalidate_shared_data` job after every change (see `SHARED_DATA_TAG` and
 * `SHARED_RESULTS_TAG` for stale versus purged), and results are also purged by the leg-complete
 * route and by a viewer who saw their game finish (`purgeSharedResults`).
 *
 * Returns the serialized data `name` and `params` ask for (see `fetchShared`), from the cache when it
 * holds it, and whether this request had to compute it; null when there is no such data. Load
 * errors are thrown and never cached.
 */
export async function readSharedData(
  name: string,
  params: URLSearchParams,
): Promise<{ body: string; computed: boolean } | null> {
  const entry = Object.hasOwn(RESOLVERS, name) ? RESOLVERS[name](params) : null;
  if (!entry) return null;
  let computed = false;
  const cached = unstable_cache(
    async () => {
      computed = true;
      return serializeQueryCache(await entry.load());
    },
    ['shared-data', BUILD_ID, ...entry.key],
    { tags: [SHARED_DATA_TAG, SHARED_RESULTS_TAG], revalidate: MAX_AGE_SECONDS },
  );
  const body = await cached();
  return { body, computed };
}
