import { queryOptions } from '@tanstack/react-query';

import type { MeResponse } from '@/app/api/me/route';
import { apiRequest } from '@/lib/apiClient';

/**
 * The signed-in user and their linked player. Never persisted: it carries `isAdmin`, which must not
 * outlive the session that fetched it (another person may sign in on the same device).
 */
export const meQuery = () => queryOptions({
  queryKey: ['me'],
  queryFn: () => apiRequest<MeResponse>('/api/me', { method: 'GET' }),
  meta: { persist: false },
});
