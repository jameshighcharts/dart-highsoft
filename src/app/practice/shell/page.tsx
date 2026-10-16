"use client";

import { useQuery } from '@tanstack/react-query';

import PracticeClient from '@/components/PracticeClient';
import { practicePlayerQuery } from '@/lib/queries/practice';
import { useAddressId } from '@/lib/useAddressId';

// Every /practice/<player id> is served from this one static shell (rewrites in next.config.ts),
// straight from the CDN; the player loads in the browser.
export default function PracticePlayerShellPage() {
  const playerId = useAddressId('/practice/');
  const player = useQuery({ ...practicePlayerQuery(playerId ?? ''), enabled: Boolean(playerId) });
  if (!playerId || player.isPending) return null;
  if (!player.data) {
    return <p className="container mx-auto p-6 text-center text-muted-foreground">This player does not exist.</p>;
  }
  return <PracticeClient key={playerId} player={player.data} />;
}
