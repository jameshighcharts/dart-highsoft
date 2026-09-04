"use client";
import dynamic from 'next/dynamic';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';

const QRCode = dynamic(() => import('react-qr-code'), { ssr: false });

const GridLeaderboard = dynamic(
  () => import('@/components/GridLeaderboard').then(m => ({ default: m.GridLeaderboard })),
  { ssr: false }
);

export default function Home() {
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  return (
    <main className="w-[90%] mx-auto p-4 md:p-6 space-y-6">
      <GridLeaderboard
        headerContent={
          <nav className="mx-auto grid w-full max-w-2xl grid-cols-3 gap-2" aria-label="Start playing">
            {[
              { href: '/new', label: 'New match', icon: '/game-icons/newmatch.png' },
              // The trophy is a narrow portrait shape (aspect 0.72) next to two
              // near-square icons, so object-contain fits it by height and it
              // reads smaller than its neighbours. Scale it up: a transform does
              // not affect layout, so the card and the icon box are unchanged.
              { href: '/tournament/new', label: 'New tournament', icon: '/game-icons/tournament.png', scale: 'scale-[1.05]' },
              { href: '/practice', label: 'Practice', icon: '/game-icons/practice1.png' },
            ].map(({ href, label, icon, scale }) => (
              <Link
                key={href}
                href={href}
                className="flex min-h-[8rem] flex-col items-center gap-1 rounded-lg border border-border p-3 text-center transition-colors hover:border-accent/60 hover:bg-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex size-20 items-center justify-center sm:size-24">
                  <Image
                    src={icon}
                    alt=""
                    width={192}
                    height={192}
                    className={`size-20 shrink-0 object-contain sm:size-24 ${scale ?? ''}`}
                  />
                </span>
                <span className="text-sm font-bold leading-tight">{label}</span>
              </Link>
            ))}
          </nav>
        }
      />

      {origin && (
        <div className="fixed bottom-4 left-4 z-40 hidden flex-col items-center gap-2 rounded-lg bg-background/90 p-3 shadow-md ring-1 ring-border sm:flex">
          <div className="text-xs font-semibold text-muted-foreground">New match</div>
          <QRCode value={`${origin}/new`} size={96} />
        </div>
      )}
    </main>
  );
}
