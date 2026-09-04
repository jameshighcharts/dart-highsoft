import { NextResponse } from 'next/server';

import { auth } from '@/auth';
import { isAuthDevBypassEnabled, isAuthPerformanceBypassEnabled } from '@/lib/auth/devBypass';

// The whole app sits behind Sign in with Slack. `/login` is the gate for the
// game, `/signin` the gate for `/admin` (admin role is checked on the page and
// in every /api/admin handler). Server-to-server endpoints authenticate on
// their own (Slack request signatures, background-job bearer secret).
const PUBLIC_PAGES = new Set(['/login', '/signin']);
const PUBLIC_API_PREFIXES = ['/api/auth/', '/api/slack/', '/api/background-jobs'];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PAGES.has(pathname)) return true;
  return PUBLIC_API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

export default auth((request) => {
  const { nextUrl } = request;
  const { pathname, search } = nextUrl;
  // Auth.js can attach an error-shaped object on configuration failures.
  // Require a real, fully identified Slack user so failures fail closed.
  const isAuthenticated = Boolean(request.auth?.user?.slackUserId)
    || isAuthDevBypassEnabled()
    || isAuthPerformanceBypassEnabled(request);

  if (isPublic(pathname)) {
    if (isAuthenticated && pathname === '/login') return NextResponse.redirect(new URL('/', nextUrl));
    if (isAuthenticated && pathname === '/signin') return NextResponse.redirect(new URL('/admin', nextUrl));
    return NextResponse.next();
  }

  if (isAuthenticated) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const isAdminArea = pathname === '/admin' || pathname.startsWith('/admin/');
  const gate = new URL(isAdminArea ? '/signin' : '/login', nextUrl);
  gate.searchParams.set('callbackUrl', `${pathname}${search}`);
  return NextResponse.redirect(gate);
});

export const config = {
  // Everything except Next internals and static files (must be a static string).
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt|xml|webmanifest|woff2?)$).*)',
  ],
};
