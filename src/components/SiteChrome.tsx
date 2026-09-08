'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

// Routes that render their own full-page shell (light admin surface and the
// sign-in screen) instead of the dark scoreboard navigation.
const BARE_PREFIXES = ['/admin', '/signin', '/login'];

export function SiteChrome({ nav, children }: { nav: ReactNode; children: ReactNode }) {
  const pathname = usePathname() ?? '';
  const bare = BARE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  const navRef = useRef<HTMLDivElement>(null);
  const hoveredLink = useRef<HTMLAnchorElement | null>(null);
  const [indicator, setIndicator] = useState({ left: 0, top: 0, width: 0, visible: false });
  const positionIndicator = useCallback((link: HTMLAnchorElement) => {
    const wrapper = navRef.current;
    const header = link.closest('nav');
    if (!wrapper || !header) return;
    const bounds = link.getBoundingClientRect();
    const origin = wrapper.getBoundingClientRect();
    const headerBounds = header.getBoundingClientRect();
    setIndicator({ left: bounds.left - origin.left + 6, top: headerBounds.bottom - origin.top - 4, width: Math.max(0, bounds.width - 12), visible: bounds.width > 0 });
  }, []);
  const showIndicator = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return;
    const link = target.closest<HTMLAnchorElement>('a.site-nav-link--desktop');
    if (!link) return;
    hoveredLink.current = link;
    positionIndicator(link);
  };
  const hideIndicator = () => {
    hoveredLink.current = null;
    setIndicator((current) => ({ ...current, visible: false }));
  };
  useEffect(() => {
    const wrapper = navRef.current;
    if (!wrapper) return;
    const observer = new ResizeObserver(() => {
      if (hoveredLink.current) positionIndicator(hoveredLink.current);
    });
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [bare, positionIndicator]);

  if (bare) return <>{children}</>;
  return (
    <div className="min-h-screen pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0">
      <div ref={navRef} className="relative"
        onPointerOver={(event) => showIndicator(event.target)}
        onPointerLeave={() => {
          const focused = navRef.current?.querySelector<HTMLAnchorElement>('a.site-nav-link--desktop:focus-visible');
          if (focused) { hoveredLink.current = focused; positionIndicator(focused); }
          else hideIndicator();
        }}
        onFocusCapture={(event) => showIndicator(event.target)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) hideIndicator();
        }}>
        {nav}
        <span aria-hidden="true" data-nav-indicator className="pointer-events-none absolute left-0 top-0 z-10 hidden h-1 rounded-full bg-gradient-to-r from-cyan-300 via-blue-400 to-violet-400 shadow-[0_1px_8px_rgba(79,163,245,0.35)] transition-[transform,width,opacity] duration-250 ease-out motion-reduce:transition-none lg:block"
          style={{ width: indicator.width, transform: `translate(${indicator.left}px, ${indicator.top}px)`, opacity: indicator.visible ? 1 : 0 }} />
      </div>
      <main className="px-3 py-2 md:p-6">{children}</main>
    </div>
  );
}
