import { describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));

import { revalidateTag } from 'next/cache';
import { SHARED_DATA_TAG } from '@/lib/shared/tag';
import { POST } from './route';

describe('POST /api/shared/revalidate', () => {
  it('expires the shared data at once', async () => {
    const response = await POST();
    expect(response.status).toBe(204);
    expect(revalidateTag).toHaveBeenCalledWith(SHARED_DATA_TAG, { expire: 0 });
  });
});
