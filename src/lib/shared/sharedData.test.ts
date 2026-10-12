import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deserializeQueryCache } from '@/lib/queryCacheSerialization';

const cacheCalls = vi.hoisted(() => [] as Array<{ keyParts: string[]; options: unknown }>);
vi.mock('next/cache', () => ({
  unstable_cache: (fn: () => Promise<unknown>, keyParts: string[], options: unknown) => {
    cacheCalls.push({ keyParts, options });
    return fn;
  },
}));
vi.mock('@/lib/queries/leaderboardData', () => ({
  fetchLeaderboardData: vi.fn(async (limit: number | undefined, timeZone: string) => ({ limit, timeZone, byId: new Map([['a', 1]]) })),
  fetchLeaderboardListsData: vi.fn(async (limit?: number) => ({ limit })),
}));
vi.mock('@/lib/queries/eloHistory', () => ({
  loadEloHistories: vi.fn(async (ids: string[]) => ({ ids })),
}));
vi.mock('@/lib/queries/leaderboards', () => ({
  loadBullers: vi.fn(async () => ['bullers']),
  loadGameModeLeaders: vi.fn(async () => ({})),
  loadHighestCheckouts: vi.fn(async () => []),
  loadQuickestLegs: vi.fn(async () => ({ double: [], single: [] })),
  loadTopRoundScores: vi.fn(async () => []),
}));
vi.mock('@/lib/stats/remote', () => ({ fetchStatsGlobalData: vi.fn(async () => ({ summary: [] })) }));

import { fetchLeaderboardData } from '@/lib/queries/leaderboardData';
import { readSharedData } from './sharedData';
import { SHARED_DATA_TAG, SHARED_RESULTS_TAG } from './tag';

const ID_A = '61000000-0000-0000-0000-000000000001';
const ID_B = '61000000-0000-0000-0000-000000000002';
const read = async (name: string, query = '') => {
  const body = await readSharedData(name, new URLSearchParams(query));
  return body === null ? null : deserializeQueryCache<unknown>(body);
};

describe('readSharedData', () => {
  beforeEach(() => {
    cacheCalls.length = 0;
  });

  it('caches each dataset under its parameters with the shared tag and keeps Maps intact', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-12T22:30:00Z'));
    const data = await read('leaderboard', 'tz=europe%2Foslo');
    vi.useRealTimers();
    expect(data).toEqual({ limit: undefined, timeZone: 'Europe/Oslo', byId: new Map([['a', 1]]) });
    expect(fetchLeaderboardData).toHaveBeenCalledWith(undefined, 'Europe/Oslo');
    // The viewer's local date (already the 13th in Oslo) is part of the key.
    expect(cacheCalls).toEqual([{
      keyParts: ['shared-data', 'dev', 'leaderboard', 'undefined', 'Europe/Oslo', '2026-08-13'],
      options: { tags: [SHARED_DATA_TAG, SHARED_RESULTS_TAG], revalidate: 300 },
    }]);
  });

  it('passes validated parameters through', async () => {
    await expect(read('leaderboard-lists', 'limit=10')).resolves.toEqual({ limit: 10 });
    await expect(read('elo-history', `ids=${ID_A},${ID_B}`)).resolves.toEqual({ ids: [ID_A, ID_B] });
    await expect(read('elo-history', 'ids=')).resolves.toEqual({ ids: [] });
    await expect(read('bullers')).resolves.toEqual(['bullers']);
    expect(cacheCalls.map((call) => call.keyParts)).toEqual([
      ['shared-data', 'dev', 'leaderboard-lists', '10'],
      ['shared-data', 'dev', 'elo-history', `${ID_A},${ID_B}`],
      ['shared-data', 'dev', 'elo-history', ''],
      ['shared-data', 'dev', 'bullers'],
    ]);
  });

  it('rejects unknown datasets and parameters it does not expect', async () => {
    await expect(read('nope')).resolves.toBeNull();
    await expect(read('toString')).resolves.toBeNull();
    await expect(read('leaderboard')).resolves.toBeNull();
    await expect(read('leaderboard', 'tz=Not%2FAZone')).resolves.toBeNull();
    await expect(read('leaderboard', 'tz=UTC&limit=-1')).resolves.toBeNull();
    await expect(read('leaderboard-lists', 'limit=abc')).resolves.toBeNull();
    await expect(read('elo-history', 'ids=1,2')).resolves.toBeNull();
    await expect(read('elo-history')).resolves.toBeNull();
    await expect(read('bullers', 'x=1')).resolves.toBeNull();
    expect(cacheCalls).toEqual([]);
  });
});
