"use client";

import { Suspense } from 'react';

import TournamentClient from '../[id]/TournamentClient';
import { useAddressId } from '@/lib/useAddressId';

// Every /tournament/<id> is served from this one static shell (rewrites in next.config.ts), straight
// from the CDN; the tournament itself loads in the browser.
export default function TournamentShellPage() {
  const tournamentId = useAddressId('/tournament/');
  if (!tournamentId) return null;
  return (
    <Suspense fallback={null}>
      <TournamentClient key={tournamentId} tournamentId={tournamentId} />
    </Suspense>
  );
}
