"use client";

import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { routePrefetch } from '@/lib/queries/routePrefetch';

/**
 * Starts loading a page's data as soon as a link to it is hovered, focused or touched, so the data
 * is usually cached before the click lands. Next's Link already prefetches the page's code.
 */
/** pointerover fires for every element inside a link, and live queries are never fresh. */
const PREFETCH_COOLDOWN_MS = 5_000;

export function RouteDataPrefetcher() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const lastPrefetchAt = new Map<string, number>();
    const prefetch = (event: Event) => {
      const link = (event.target as Element | null)?.closest?.('a[href]');
      if (!(link instanceof HTMLAnchorElement) || link.origin !== window.location.origin) return;
      // The page already on screen keeps its own data fresh.
      if (link.pathname === window.location.pathname) return;
      const prefetchRoute = routePrefetch(link.pathname);
      if (!prefetchRoute) return;
      const now = Date.now();
      if (now - (lastPrefetchAt.get(link.pathname) ?? 0) < PREFETCH_COOLDOWN_MS) return;
      lastPrefetchAt.set(link.pathname, now);
      // prefetchQuery also skips data that is still fresh.
      void prefetchRoute(queryClient).catch(() => {});
    };
    document.addEventListener('pointerover', prefetch, { passive: true });
    document.addEventListener('focusin', prefetch);
    document.addEventListener('touchstart', prefetch, { passive: true });
    return () => {
      document.removeEventListener('pointerover', prefetch);
      document.removeEventListener('focusin', prefetch);
      document.removeEventListener('touchstart', prefetch);
    };
  }, [queryClient]);

  return null;
}
