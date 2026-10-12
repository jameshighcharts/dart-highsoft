import { expect, it, vi } from 'vitest';
import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client';
import { persistOnlyChanges } from './persistOnlyChanges';

const client = (queries: Array<[string, number]>) => ({
  timestamp: 0,
  buster: 'b',
  clientState: { mutations: [], queries: queries.map(([queryHash, dataUpdatedAt]) => ({ queryHash, state: { dataUpdatedAt } })) },
}) as unknown as PersistedClient;

it('writes only when persisted data changed', () => {
  const inner: Persister = { persistClient: vi.fn(), restoreClient: vi.fn(), removeClient: vi.fn() };
  const persister = persistOnlyChanges(inner);
  persister.persistClient(client([['["leaderboard"]', 1]]));
  persister.persistClient(client([['["leaderboard"]', 1]])); // a board heartbeat or fetch-status event
  expect(inner.persistClient).toHaveBeenCalledTimes(1);
  persister.persistClient(client([['["leaderboard"]', 2]])); // refetched
  persister.persistClient(client([['["leaderboard"]', 2], ['["players","list"]', 5]])); // a new query
  expect(inner.persistClient).toHaveBeenCalledTimes(3);
});
