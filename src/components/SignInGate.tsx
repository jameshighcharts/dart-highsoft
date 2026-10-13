"use client";

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

import { forgetSupabaseAccessToken, isSignedOut, SIGNED_OUT_EVENT } from '@/lib/supabaseAccessToken';

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
    if (OPEN_PAGES.has(pathname)) {
      // Signing out, and an expired session, end up here: the database token goes with the session.
      forgetSupabaseAccessToken();
      return;
    }
    let cancelled = false;
    const toSignIn = () => {
      if (cancelled) return;
      const isAdminArea = pathname === '/admin' || pathname.startsWith('/admin/');
      const gate = new URL(isAdminArea ? '/signin' : '/login', window.location.origin);
      gate.searchParams.set('callbackUrl', `${window.location.pathname}${window.location.search}`);
      window.location.replace(gate.toString());
    };
    void isSignedOut().then((signedOut) => {
      if (signedOut) toSignIn();
    });
    // A tab left open: the session can end while it stays on one page (the token renewal finds out).
    window.addEventListener(SIGNED_OUT_EVENT, toSignIn);
    return () => {
      cancelled = true;
      window.removeEventListener(SIGNED_OUT_EVENT, toSignIn);
    };
  }, [pathname]);
  return null;
}
