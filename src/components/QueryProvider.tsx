"use client";

import { QueryClient } from '@tanstack/react-query';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { PersistQueryClientProvider, removeOldestQuery } from '@tanstack/react-query-persist-client';
import { useState } from 'react';

import { deserializeQueryCache, serializeQueryCache } from '@/lib/queryCacheSerialization';
import { shouldRetryQuery } from '@/lib/queryRetry';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Data shapes change between deploys; a new build starts from an empty cache. */
const CACHE_BUSTER = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? 'dev';

/** localStorage, or nothing when it is unavailable (server render, private mode, blocked storage). */
function browserStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function createAppQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Show cached data at once and refetch it in the background on the next mount. The short
        // window only keeps a hover prefetch from being refetched again by the click that follows.
        staleTime: 5 * 1000,
        // Keep data for as long as it may be restored from storage.
        gcTime: DAY_MS,
        refetchOnWindowFocus: false,
        retry: shouldRetryQuery,
      },
    },
  });
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(createAppQueryClient);
  const [persister] = useState(() => createSyncStoragePersister({
    storage: browserStorage(),
    key: 'dart-scoreboard-query-cache',
    serialize: serializeQueryCache,
    deserialize: deserializeQueryCache,
    // A full quota drops the oldest query and tries again instead of persisting nothing.
    retry: removeOldestQuery,
  }));

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: DAY_MS,
        buster: CACHE_BUSTER,
        dehydrateOptions: {
          // Opt-in: only small, bounded queries are worth restoring. Every cache change re-serializes
          // what is persisted on the main thread, and localStorage holds about 5 MB.
          shouldDehydrateQuery: (query) => query.state.status === 'success' && query.meta?.persist === true,
        },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
