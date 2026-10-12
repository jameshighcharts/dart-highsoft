import { afterEach, describe, expect, it, vi } from 'vitest';

import { serializeQueryCache } from '@/lib/queryCacheSerialization';
import { expireSharedData, fetchShared } from './fetchShared';

// The test setup replaces this module with its fallbacks everywhere else.
vi.unmock('@/lib/shared/fetchShared');

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', fetchMock);

afterEach(() => {
  fetchMock.mockReset();
});

describe('fetchShared', () => {
  it('reads the server copy, with Maps restored', async () => {
    fetchMock.mockResolvedValue(new Response(serializeQueryCache({ byId: new Map([['a', [1, 2]]]) })));
    const fallback = vi.fn();
    await expect(fetchShared('leaderboard', { tz: 'Europe/Oslo', limit: undefined }, fallback))
      .resolves.toEqual({ byId: new Map([['a', [1, 2]]]) });
    expect(fetchMock).toHaveBeenCalledWith('/api/shared/leaderboard?tz=Europe%2FOslo', { credentials: 'same-origin' });
    expect(fallback).not.toHaveBeenCalled();
  });

  it('computes the data in the browser when the server cannot answer', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 502 }));
    await expect(fetchShared('bullers', {}, async () => 'local')).resolves.toBe('local');
    expect(fetchMock).toHaveBeenCalledWith('/api/shared/bullers', { credentials: 'same-origin' });

    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    await expect(fetchShared('bullers', {}, async () => 'offline')).resolves.toBe('offline');
  });

  it('expires the server copies without failing when it cannot', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expireSharedData();
    expect(fetchMock).toHaveBeenCalledWith('/api/shared/revalidate', { method: 'POST', credentials: 'same-origin' });
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    await expect(expireSharedData()).resolves.toBeUndefined();
  });
});
