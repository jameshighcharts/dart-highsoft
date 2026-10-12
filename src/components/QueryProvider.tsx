"use client";

import { QueryClient } from '@tanstack/react-query';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { PersistQueryClientProvider, removeOldestQuery } from '@tanstack/react-query-persist-client';
import { useState } from 'react';

import { persistOnlyChanges } from '@/lib/persistOnlyChanges';
import { deserializeQueryCache, serializeQueryCache } from '@/lib/queryCacheSerialization';
import { shouldRetryQuery } from '@/lib/queryRetry';
import { shareStructurally } from '@/lib/shareStructurally';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Bump when the shape of persisted data changes without a new build id (e.g. in development). */
const PERSIST_SCHEMA_VERSION = 1;

/** Data shapes change between deploys; a new build starts from an empty cache. */
const CACHE_BUSTER = `${PERSIST_SCHEMA_VERSION}:${process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev'}`;


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
        // Show cached data at once and refetch it in the background on a later visit. Within this
        // window a revisit or a hover costs nothing; live data sets its own shorter staleTime, and
        // writes (a finished match) invalidate what they change.
        staleTime: 30 * 1000,
        // Keep data for as long as it may be restored from storage.
        gcTime: DAY_MS,
        refetchOnWindowFocus: false,
        retry: shouldRetryQuery,
        structuralSharing: shareStructurally,
      },
    },
  });
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(createAppQueryClient);
  const [persister] = useState(() => persistOnlyChanges(createSyncStoragePersister({
    storage: browserStorage(),
    key: 'dart-scoreboard-query-cache',
    serialize: serializeQueryCache,
    deserialize: deserializeQueryCache,
    // A full quota drops the oldest query and tries again instead of persisting nothing.
    retry: removeOldestQuery,
  })));

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
