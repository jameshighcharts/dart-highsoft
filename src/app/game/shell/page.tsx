"use client";

import { Suspense } from 'react';

import GameClient from '../[id]/GameClient';
import { useAddressId } from '@/lib/useAddressId';

// Every /game/<id> is served from this one static shell (rewrites in next.config.ts), straight
// from the CDN; the game itself loads in the browser.
export default function GameShellPage() {
  const gameId = useAddressId('/game/');
  if (!gameId) return null;
  return (
    <Suspense fallback={null}>
      <GameClient key={gameId} gameId={gameId} />
    </Suspense>
  );
}
