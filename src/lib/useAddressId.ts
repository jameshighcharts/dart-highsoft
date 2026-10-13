"use client";

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * The id in the browser's address (`<prefix><id>`), for a page served from one static shell for
 * every id (the rewrites in next.config.ts). The shell is prerendered without an id, and behind a
 * rewrite the router may report the shell's own path, so the id is read from the address after
 * mount, and again on every navigation; null until then.
 */
export function useAddressId(prefix: string): string | null {
  const pathname = usePathname();
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    const path = window.location.pathname;
    const segment = path.startsWith(prefix) ? path.slice(prefix.length).split('/')[0] : '';
    setId(segment ? decodeURIComponent(segment) : null);
  }, [pathname, prefix]);
  return id;
}
