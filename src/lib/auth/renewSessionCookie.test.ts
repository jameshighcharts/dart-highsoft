// @vitest-environment node
import { encode } from '@auth/core/jwt';
import NextAuth from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { describe, expect, it } from 'vitest';

import { renewSessionCookie } from './renewSessionCookie';

const SECRET = 'renew-session-cookie-test-secret-at-least-32-chars';
// Production serves over HTTPS, where NextAuth's session cookie has the __Secure- prefix.
const COOKIE = '__Secure-authjs.session-token';

// The real NextAuth, configured like src/auth.ts as far as sessions go.
const { auth } = NextAuth({ providers: [], secret: SECRET, session: { strategy: 'jwt' }, trustHost: true });

async function requestWithSession() {
  const token = await encode({ token: { email: 'member@highsoft.com', slackTeamId: 'T1' }, secret: SECRET, salt: COOKIE });
  return new NextRequest('https://darts.example/api/supabase-token', { headers: { cookie: `${COOKIE}=${token}` } });
}

describe('renewSessionCookie', () => {
  it('puts the renewed session cookie on the response, about 30 days out', async () => {
    const response = NextResponse.json({ ok: true });
    await renewSessionCookie(auth, await requestWithSession(), response);
    const cookie = response.headers.getSetCookie().find((value) => value.startsWith(`${COOKIE}=`));
    expect(cookie).toBeDefined();
    const expires = new Date(/Expires=([^;]+)/i.exec(cookie!)![1]).getTime();
    expect(expires - Date.now()).toBeGreaterThan(29 * 24 * 3600_000);
    // NextAuth's CSRF and callback-URL cookies are left out.
    expect(response.headers.getSetCookie().every((value) => value.startsWith(`${COOKIE}=`))).toBe(true);
  });

  it('adds nothing without a session', async () => {
    const response = NextResponse.json({ ok: true });
    await renewSessionCookie(auth, new NextRequest('https://darts.example/api/supabase-token'), response);
    expect(response.headers.getSetCookie().filter((value) => value.startsWith(`${COOKIE}=`))).toEqual([]);
  });
});
