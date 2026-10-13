"use client";

import { Suspense } from 'react';

import MatchClient from '../[id]/MatchClient';
import { useAddressId } from '@/lib/useAddressId';

// Every /match/<id> is served from this one static shell (rewrites in next.config.ts), straight
// from the CDN; the match itself loads in the browser.
export default function MatchShellPage() {
  const matchId = useAddressId('/match/');
  if (!matchId) return null;
  return (
    <Suspense fallback={null}>
      <MatchClient key={matchId} matchId={matchId} />
    </Suspense>
  );
}
