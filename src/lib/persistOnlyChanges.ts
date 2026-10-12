import type { Persister } from '@tanstack/react-query-persist-client';

/**
 * Writes only when persisted data changed. The provider persists on every cache event, including
 * fetch-status changes and live queries that are never saved (board heartbeats), and each write
 * serializes every persisted query on the main thread.
 */
export function persistOnlyChanges(persister: Persister): Persister {
  let lastWritten = '';
  return {
    ...persister,
    persistClient: (client) => {
      const signature = client.clientState.queries
        .map((query) => `${query.queryHash}@${query.state.dataUpdatedAt}`)
        .join('|');
      if (signature === lastWritten) return;
      lastWritten = signature;
      return persister.persistClient(client);
    },
  };
}
