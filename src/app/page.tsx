"use client";
import dynamic from 'next/dynamic';
import Image from 'next/image';
import Link from 'next/link';
import { BarChart3, ChevronDown, Radio, Target, Trophy, Users } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

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
          <div className="space-y-6">
            <div className="flex items-center gap-4">
              <Image
                src="/icon-192x192.png"
                alt="Dart Scoreboard"
                width={64}
                height={64}
                className="size-14 object-contain md:size-16"
                priority
              />
              <h1 className="text-2xl font-semibold md:text-3xl">Dart Scoreboard</h1>
            </div>
            <div className="flex items-center gap-3">
              <Button asChild size="lg">
                <Link href="/new">New Match</Link>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="lg" className="group">
                    More
                    <ChevronDown className="transition-transform duration-200 group-data-[state=open]:rotate-180" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" sideOffset={8} className="w-56 rounded-xl p-1.5 shadow-xl">
                  <DropdownMenuItem asChild className="cursor-pointer rounded-lg py-2.5">
                    <Link href="/tournament/new">
                      <Trophy />
                      New Tournament
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild className="cursor-pointer rounded-lg py-2.5">
                    <Link href="/practice">
                      <Target />
                      Practice
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild className="cursor-pointer rounded-lg py-2.5">
                    <Link href="/players">
                      <Users />
                      Players
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild className="cursor-pointer rounded-lg py-2.5">
                    <Link href="/boards">
                      <Radio />
                      Scolia Boards
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild className="cursor-pointer rounded-lg py-2.5">
                    <Link href="/elo-multi">
                      <BarChart3 />
                      Multiplayer Elo
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
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
