import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { browserSupabaseAccessToken, isSignedOut, resetSupabaseAccessTokenForTests } from './supabaseAccessToken';

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', fetchMock);

const NOW = Date.UTC(2026, 9, 13, 12, 0, 0);
const MINUTE = 60_000;
const tokenResponse = (token: string, expiresAt = NOW + 60 * MINUTE) =>
  new Response(JSON.stringify({ token, expiresAt }), { status: 200 });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  resetSupabaseAccessTokenForTests();
  fetchMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('browserSupabaseAccessToken', () => {
  it('fetches the token once, however many ask together, and reuses it', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse('a'));
    const tokens = await Promise.all([browserSupabaseAccessToken(), browserSupabaseAccessToken(), browserSupabaseAccessToken()]);
    expect(tokens).toEqual(['a', 'a', 'a']);
    expect(await browserSupabaseAccessToken()).toBe('a');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/supabase-token', { credentials: 'same-origin' });
  });

  it('renews five minutes before expiry', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse('a')).mockResolvedValueOnce(tokenResponse('b', NOW + 120 * MINUTE));
    expect(await browserSupabaseAccessToken()).toBe('a');
    vi.setSystemTime(NOW + 54 * MINUTE);
    expect(await browserSupabaseAccessToken()).toBe('a');
    vi.setSystemTime(NOW + 56 * MINUTE);
    expect(await browserSupabaseAccessToken()).toBe('b');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reuses the token kept in sessionStorage after a reload', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse('a'));
    await browserSupabaseAccessToken();
    // A reload starts with empty memory but the same sessionStorage.
    vi.resetModules();
    const reloaded = await import('./supabaseAccessToken');
    expect(await reloaded.browserSupabaseAccessToken()).toBe('a');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the anon key without hammering the server when there is no token', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 503 }));
    expect(await browserSupabaseAccessToken()).toBeNull();
    // Realtime asks on every heartbeat.
    vi.setSystemTime(NOW + 10_000);
    expect(await browserSupabaseAccessToken()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(NOW + 6 * MINUTE);
    await browserSupabaseAccessToken();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps a token that is due for renewal when renewing fails, and asks again before it expires', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse('a'))
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(tokenResponse('b', NOW + 120 * MINUTE));
    await browserSupabaseAccessToken();
    vi.setSystemTime(NOW + 57 * MINUTE);
    expect(await browserSupabaseAccessToken()).toBe('a');
    // The usual wait would end at minute 62, after the token expires at 60.
    vi.setSystemTime(NOW + 60 * MINUTE);
    expect(await browserSupabaseAccessToken()).toBe('b');
  });

  it('drops the token as soon as the session is gone', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse('a')).mockResolvedValueOnce(new Response('{}', { status: 401 }));
    await browserSupabaseAccessToken();
    vi.setSystemTime(NOW + 57 * MINUTE);
    expect(await browserSupabaseAccessToken()).toBeNull();
    expect(sessionStorage.getItem('supabase-access-token')).toBeNull();
  });

  it('tells a signed-out visitor apart from a server without tokens, with the same request', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 401 }));
    expect(await isSignedOut()).toBe(true);
    resetSupabaseAccessTokenForTests();
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 503 }));
    expect(await isSignedOut()).toBe(false);
    resetSupabaseAccessTokenForTests();
    fetchMock.mockResolvedValueOnce(tokenResponse('a'));
    expect(await isSignedOut()).toBe(false);
    expect(await browserSupabaseAccessToken()).toBe('a');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
