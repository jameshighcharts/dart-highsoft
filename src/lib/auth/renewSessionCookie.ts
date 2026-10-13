import type { NextRequest } from 'next/server';

type AuthAsMiddleware = (request: NextRequest) => Promise<Response | undefined>;

const SESSION_COOKIE = /^(__Secure-)?authjs\.session-token(\.\d+)?=/;

/**
 * Renews the sign-in cookie (another 30 days) on `response`. NextAuth only renews it when `auth` is
 * called with the request, the way middleware calls it, and then puts the cookie on a response of
 * its own rather than the one passed in, so the cookie is copied across.
 */
export async function renewSessionCookie(auth: unknown, request: NextRequest, response: Response): Promise<void> {
  const renewed = await (auth as AuthAsMiddleware)(request);
  for (const cookie of renewed?.headers.getSetCookie() ?? []) {
    // Only the session cookie (and its chunks, when large): NextAuth also sets a CSRF token and a
    // callback URL pointing at this request, which would redirect a later sign-in here.
    if (SESSION_COOKIE.test(cookie)) response.headers.append('set-cookie', cookie);
  }
}
