import { NextResponse } from 'next/server';

import { auth } from '@/auth';
import { isAuthDevBypassEnabled, isAuthPerformanceBypassEnabled } from '@/lib/auth/devBypass';

// The whole app sits behind Slack or Google sign-in. `/login` is the gate for the
// game, `/signin` the gate for `/admin` (admin role is checked on the page and
// in every /api/admin handler).
//
// The proxy guards pages only. API routes check the session themselves
// (`withSession`, src/lib/auth/withSession.ts): on Vercel the proxy is a separate
// step in front of every request, which cost each API call about 65 ms.
const PUBLIC_PAGES = new Set(['/login', '/signin']);

export default auth((request) => {
  const { nextUrl } = request;
  const { pathname, search } = nextUrl;
  // Auth.js can attach an error-shaped object on configuration failures.
  // Match getAuthenticatedSession; Google users may not have a Slack link yet.
  const isAuthenticated = Boolean(request.auth?.user?.email && request.auth.user.slackTeamId)
    || isAuthDevBypassEnabled()
    || isAuthPerformanceBypassEnabled(request);

  if (PUBLIC_PAGES.has(pathname)) {
    if (isAuthenticated && pathname === '/login') return NextResponse.redirect(new URL('/', nextUrl));
    if (isAuthenticated && pathname === '/signin') return NextResponse.redirect(new URL('/admin', nextUrl));
    return NextResponse.next();
  }

  if (isAuthenticated) return NextResponse.next();

  const isAdminArea = pathname === '/admin' || pathname.startsWith('/admin/');
  const gate = new URL(isAdminArea ? '/signin' : '/login', nextUrl);
  gate.searchParams.set('callbackUrl', `${pathname}${search}`);
  return NextResponse.redirect(gate);
});

export const config = {
  // Pages: everything except API routes, Next internals and static files (must be a static string).
  matcher: [
    '/((?!api/|_next/static|_next/image|favicon.ico|manifest.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt|xml|webmanifest|woff2?)$).*)',
  ],
};
