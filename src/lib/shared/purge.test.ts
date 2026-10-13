import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ updateTag: vi.fn() }));
vi.mock('@/auth', () => ({ getAuthenticatedSession: vi.fn() }));

import { updateTag } from 'next/cache';
import { getAuthenticatedSession } from '@/auth';
import { purgeSharedResults } from './purge';
import { SHARED_RESULTS_TAG } from './tag';

afterEach(() => {
  vi.mocked(updateTag).mockReset();
});

describe('purgeSharedResults', () => {
  it('purges for a signed-in member', async () => {
    vi.mocked(getAuthenticatedSession).mockResolvedValueOnce({ user: { email: 'a@highsoft.com' } } as never);
    await purgeSharedResults();
    expect(updateTag).toHaveBeenCalledWith(SHARED_RESULTS_TAG);
  });

  it('does nothing for anyone else', async () => {
    vi.mocked(getAuthenticatedSession).mockResolvedValueOnce(null);
    await purgeSharedResults();
    expect(updateTag).not.toHaveBeenCalled();
  });
});
