"use client";
import dynamic from 'next/dynamic';
import Image from 'next/image';
import Link from 'next/link';

const GridLeaderboard = dynamic(
  () => import('@/components/GridLeaderboard').then(m => ({ default: m.GridLeaderboard })),
  { ssr: false }
);

export default function Home() {
  return (
    <main className="w-full mx-auto space-y-4 sm:w-[90%] sm:p-4 md:p-6 md:space-y-6">
      <GridLeaderboard
        headerContent={
          <nav className="mx-auto grid w-full max-w-2xl grid-cols-3 gap-2" aria-label="Start playing">
            {[
              { href: '/new', label: 'New match', icon: '/game-icons/newmatch.png', theme: 'hover:bg-[linear-gradient(145deg,#103849,#101b38_65%,#15172e),linear-gradient(120deg,#67e8f9,#60a5fa_55%,#a78bfa)] hover:shadow-[0_8px_32px_rgba(34,211,238,0.32)]' },
              // The trophy is a narrow portrait shape (aspect 0.72) next to two
              // near-square icons, so object-contain fits it by height and it
              // reads smaller than its neighbours. Scale it up: a transform does
              // not affect layout, so the card and the icon box are unchanged.
              { href: '/tournament/new', label: 'New tournament', icon: '/game-icons/tournament.png', scale: 'scale-[1.05]', theme: 'hover:bg-[linear-gradient(145deg,#35203f,#211731_65%,#15172e),linear-gradient(120deg,#c4b5fd,#c084fc_55%,#f9a8d4)] hover:shadow-[0_8px_32px_rgba(192,132,252,0.32)]' },
              { href: '/practice', label: 'Practice', icon: '/game-icons/practice1.png', theme: 'hover:bg-[linear-gradient(145deg,#113c35,#102b30_65%,#101c2c),linear-gradient(120deg,#6ee7b7,#2dd4bf_55%,#67e8f9)] hover:shadow-[0_8px_32px_rgba(45,212,191,0.32)]' },
            ].map(({ href, label, icon, scale, theme }) => (
              <Link
                key={href}
                href={href}
                className={`group relative isolate flex min-h-[8rem] flex-col items-center gap-1 overflow-hidden rounded-2xl border border-white/10 bg-slate-900/40 p-3 text-center [background-origin:border-box] [background-clip:padding-box,border-box] transition-[transform,box-shadow,filter,border-width,padding] duration-200 hover:border-[3px] hover:border-transparent hover:p-2.5 hover:brightness-125 focus-visible:border-[3px] focus-visible:p-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-4 focus-visible:ring-offset-background motion-reduce:transform-none motion-reduce:transition-none ${theme}`}
              >
                <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-white/[0.09] to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100 motion-reduce:transition-none" />
                <span className="flex size-20 items-center justify-center transition-transform duration-200 group-hover:scale-110 motion-reduce:transform-none motion-reduce:transition-none sm:size-24">
                  <Image
                    src={icon}
                    alt=""
                    width={192}
                    height={192}
                    className={`size-20 shrink-0 object-contain sm:size-24 ${scale ?? ''}`}
                  />
                </span>
                <span className="relative text-sm font-extrabold leading-tight tracking-tight text-slate-100 group-hover:text-white sm:text-base">{label}</span>
              </Link>
            ))}
          </nav>
        }
      />
    </main>
  );
}
