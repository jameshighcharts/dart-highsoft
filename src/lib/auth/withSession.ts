import { NextResponse, type NextRequest } from 'next/server';

import { getAuthenticatedSession } from '@/auth';
import { isAuthPerformanceBypassEnabled } from '@/lib/auth/devBypass';

/**
 * Runs an API route handler only for a signed-in member (a verified work email in the Slack
 * workspace, as `getAuthenticatedSession` checks), or the CI Lighthouse audit; anyone else gets 401.
 *
 * Every API route checks for itself: there is no proxy in front of requests (on Vercel it was a
 * separate step that cost each request about 65 ms; this check takes a few).
 */
export function withSession<Args extends unknown[]>(
  handler: (...args: Args) => Response | Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args) => {
    // Next passes every route handler the request first, as a NextRequest.
    const request = args[0] as NextRequest | undefined;
    const started = performance.now();
    const signedIn = (request?.nextUrl !== undefined && isAuthPerformanceBypassEnabled(request))
      || (await getAuthenticatedSession()) !== null;
    const timing = `auth;dur=${(performance.now() - started).toFixed(1)}`;
    if (!signedIn) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Server-Timing': timing } });
    }
    const response = await handler(...args);
    try {
      response.headers.append('Server-Timing', timing);
    } catch {
      // Some responses (redirects, passed-through fetches) have immutable headers.
    }
    return response;
  };
}
