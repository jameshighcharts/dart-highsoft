import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/server/supabaseToken', () => ({ signSupabaseToken: vi.fn() }));
vi.mock('@/auth', () => ({ isAuthConfigured: true, auth: vi.fn() }));
// renewSessionCookie has its own test against the real NextAuth.
vi.mock('@/lib/auth/renewSessionCookie', () => ({
  renewSessionCookie: vi.fn(async (_auth: unknown, _request: unknown, response: Response) => {
    response.headers.append('set-cookie', '__Secure-authjs.session-token=renewed; Path=/; HttpOnly');
  }),
}));

import { NextRequest } from 'next/server';
import { signSupabaseToken } from '@/lib/server/supabaseToken';
import { GET } from './route';

const request = () => new NextRequest('https://darts.example/api/supabase-token');

afterEach(() => {
  vi.mocked(signSupabaseToken).mockReset();
});

describe('GET /api/supabase-token', () => {
  it('returns a fresh token that nothing may cache', async () => {
    vi.mocked(signSupabaseToken).mockResolvedValue({ token: 'jwt', expiresAt: 123, expiresIn: 3600 });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ token: 'jwt', expiresAt: 123, expiresIn: 3600 });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('set-cookie')).toContain('authjs.session-token=renewed');
  });

  it('answers 503 while no signing key is configured, and 500 for a broken one', async () => {
    vi.mocked(signSupabaseToken).mockResolvedValueOnce(null);
    expect((await GET(request())).status).toBe(503);
    vi.spyOn(console, 'error').mockImplementationOnce(() => {});
    vi.mocked(signSupabaseToken).mockRejectedValueOnce(new Error('bad key'));
    expect((await GET(request())).status).toBe(500);
  });
});
