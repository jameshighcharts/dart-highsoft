// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import type { NextAuthRequest } from 'next-auth';

vi.mock('@/auth', () => ({
  auth: (handler: (request: NextAuthRequest) => NextResponse) => handler,
}));
vi.mock('@/lib/auth/devBypass', () => ({
  isAuthDevBypassEnabled: () => false,
  isAuthPerformanceBypassEnabled: () => false,
}));

import proxy, { config } from './proxy';

function request(path: string, session: NextAuthRequest['auth']) {
  return Object.assign(new NextRequest(`https://darts.example${path}`), { auth: session });
}

const googleSession = {
  expires: '2099-01-01T00:00:00Z',
  user: {
    email: 'member@highsoft.com',
    slackTeamId: 'TWORK',
    slackUserId: null,
    isAdmin: false,
    provider: 'google',
  },
} satisfies NonNullable<NextAuthRequest['auth']>;

// The auth mock exposes the wrapped handler instead of invoking OAuth.
async function run(path: string, session: NextAuthRequest['auth']) {
  return proxy(request(path, session), { params: Promise.resolve({}) });
}

describe('authentication proxy', () => {
  it('runs for pages only: API routes check the session themselves (withSession)', () => {
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    for (const path of ['/', '/profile', '/match/abc', '/admin/players', '/login']) expect(matcher.test(path), path).toBe(true);
    for (const path of ['/api/me', '/api/shared/leaderboard', '/api/highdarts/sheet', '/_next/static/chunks/a.js', '/icon-192x192.png']) {
      expect(matcher.test(path), path).toBe(false);
    }
  });

  it('lets a Google session without a Slack link reach the app', async () => {
    for (const path of ['/', '/profile']) {
      const response = await run(path, googleSession);
      expect(response?.headers.get('location')).toBeNull();
      expect(response?.status).toBe(200);
    }
  });

  it('does not bounce an authenticated Google user back to login', async () => {
    const login = await run('/login', googleSession);
    expect(login?.headers.get('location')).toBe('https://darts.example/');
    const home = await run('/', googleSession);
    expect(home?.headers.get('location')).toBeNull();
  });

  it('keeps anonymous and incomplete sessions outside protected routes', async () => {
    for (const session of [null, { ...googleSession, user: { ...googleSession.user, email: null } }, { ...googleSession, user: { ...googleSession.user, slackTeamId: null } }]) {
      const page = await run('/profile', session);
      expect(page?.headers.get('location')).toBe('https://darts.example/login?callbackUrl=%2Fprofile');
    }
  });
});
