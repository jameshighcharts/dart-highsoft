import { unstable_cache } from 'next/cache';

import { isValidTimeZone, calendarIn } from '@/lib/localCalendar';
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

import { SHARED_DATA_TAG } from './tag';

/** Upper bound on how old an entry gets if an expiry is missed; the database expires them sooner. */
const MAX_AGE_SECONDS = 300;

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
  return ids;
}

const unparameterized = (name: string, load: () => Promise<unknown>): Resolver =>
  (params) => ([...params.keys()].length === 0 ? { key: [name], load } : null);

const RESOLVERS: Record<string, Resolver> = {
  leaderboard: (params) => {
    const limit = parseLimit(params);
    const timeZone = params.get('tz');
    if (limit === null || !timeZone || timeZone.length > 64 || !isValidTimeZone(timeZone)) return null;
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
 * Data every viewer shares, computed once per change instead of once per visit: the database
 * queues a `revalidate_shared_data` job on every change, and a viewer who just finished a game
 * expires it at once (`/api/shared/revalidate`).
 *
 * Returns the serialized data `name` and `params` ask for (see `fetchShared`), from the cache when it
 * holds it; null when there is no such data. Load errors are thrown and never cached.
 */
export async function readSharedData(name: string, params: URLSearchParams): Promise<string | null> {
  const entry = Object.hasOwn(RESOLVERS, name) ? RESOLVERS[name](params) : null;
  if (!entry) return null;
  const cached = unstable_cache(
    async () => serializeQueryCache(await entry.load()),
    ['shared-data', ...entry.key],
    { tags: [SHARED_DATA_TAG], revalidate: MAX_AGE_SECONDS },
  );
  return cached();
}
