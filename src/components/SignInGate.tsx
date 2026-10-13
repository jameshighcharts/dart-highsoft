"use client";

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

import { isSignedOut } from '@/lib/supabaseAccessToken';

const OPEN_PAGES = new Set(['/login', '/signin']);

/**
 * Sends a visitor who isn't signed in to sign in. Pages are static shells served from the CDN to
 * anyone; their data comes from API routes and Supabase, which both require a signed-in member
 * (withSession, and the token from /api/supabase-token), so a signed-out visitor only ever sees
 * the empty shell before this redirects. Pages that read data on the server check the session
 * themselves (requirePageSession).
 */
export function SignInGate() {
  const pathname = usePathname();
  useEffect(() => {
    if (OPEN_PAGES.has(pathname)) return;
    let cancelled = false;
    void isSignedOut().then((signedOut) => {
      if (cancelled || !signedOut) return;
      const isAdminArea = pathname === '/admin' || pathname.startsWith('/admin/');
      const gate = new URL(isAdminArea ? '/signin' : '/login', window.location.origin);
      gate.searchParams.set('callbackUrl', `${window.location.pathname}${window.location.search}`);
      window.location.replace(gate.toString());
    });
    return () => {
      cancelled = true;
    };
  }, [pathname]);
  return null;
}
