import { queryOptions } from '@tanstack/react-query';

import { apiRequest } from '@/lib/apiClient';
import type { ScoliaBoard } from '@/lib/scolia/types';

/**
 * The account's Scolia boards with their live connection status. The status is only true right
 * now, so it is never restored from storage and is refetched on every visit; realtime updates keep
 * it current while the page is open.
 */
export const scoliaBoardsQuery = () => queryOptions({
  queryKey: ['scolia', 'boards'],
  queryFn: async (): Promise<ScoliaBoard[]> =>
    (await apiRequest<{ boards: ScoliaBoard[] }>('/api/scolia/boards', { method: 'GET' })).boards,
  staleTime: 0,
  meta: { persist: false },
});
