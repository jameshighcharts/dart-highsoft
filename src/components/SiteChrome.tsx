'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

// Routes that render their own full-page shell (light admin surface and the
// sign-in screen) instead of the dark scoreboard navigation.
const BARE_PREFIXES = ['/admin', '/signin', '/login'];

export function SiteChrome({ nav, children }: { nav: ReactNode; children: ReactNode }) {
  const pathname = usePathname() ?? '';
  const bare = BARE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (bare) return <>{children}</>;
  return (
    <div className="min-h-screen pb-16 lg:pb-0">
      {nav}
      <main className="px-3 py-2 md:p-6">{children}</main>
    </div>
  );
}
