import { queryOptions } from '@tanstack/react-query';

import { apiRequest } from '@/lib/apiClient';
import type { Snapshot } from '@/lib/highdarts/standings';

/** The Highdarts tournament snapshot from /api/highdarts, including live board availability. */
export const highdartsQuery = () => queryOptions({
  queryKey: ['highdarts'],
  queryFn: () => apiRequest<Snapshot>('/api/highdarts', { method: 'GET' }),
  // Small and bounded (a few dozen fixtures), so a reload shows the last snapshot at once.
  meta: { persist: true },
});
