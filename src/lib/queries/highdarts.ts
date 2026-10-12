import { queryOptions, skipToken } from '@tanstack/react-query';

import { apiRequest } from '@/lib/apiClient';
import type { Snapshot } from '@/lib/highdarts/standings';
import type { ScoliaBoardOption } from '@/lib/scolia/types';

/** Board occupancy from the latest Highdarts fetch in this session. Never persisted. */
export const highdartsBoardsQuery = () => queryOptions<ScoliaBoardOption[]>({
  queryKey: ['highdarts-live-boards'],
  queryFn: skipToken,
  staleTime: Infinity,
});

/**
 * The Highdarts tournament (fixtures, results, players) from /api/highdarts. Small and bounded, so
 * it is persisted and a reload shows the last snapshot at once. The response's live board
 * occupancy is split off into `highdartsBoardsQuery`, so a restored snapshot never shows an old one.
 */
export const highdartsQuery = () => queryOptions({
  queryKey: ['highdarts'],
  queryFn: async ({ client }): Promise<Snapshot> => {
    const { boards, ...snapshot } = await apiRequest<Snapshot>('/api/highdarts', { method: 'GET' });
    client.setQueryData(highdartsBoardsQuery().queryKey, boards ?? []);
    return snapshot;
  },
  meta: { persist: true },
});
