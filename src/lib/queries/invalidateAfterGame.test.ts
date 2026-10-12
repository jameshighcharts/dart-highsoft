import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/shared/fetchShared', () => ({ expireSharedData: vi.fn(async () => {}) }));

import { expireSharedData } from '@/lib/shared/fetchShared';
import { invalidateAfterGame } from './invalidateAfterGame';

describe('invalidateAfterGame', () => {
  it('refreshes only this browser when opening a finished game', async () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    invalidateAfterGame(queryClient, { resultJustHappened: false });
    expect(expireSharedData).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['leaderboard'] }, { cancelRefetch: false });
  });

  it('purges the shared copies before refreshing when the result just happened', async () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    invalidateAfterGame(queryClient, { resultJustHappened: true });
    expect(expireSharedData).toHaveBeenCalledOnce();
    expect(invalidate).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['stats'] }, { cancelRefetch: false }));
  });
});
