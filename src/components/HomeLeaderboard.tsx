"use client";

import dynamic from 'next/dynamic';

import { LeaderboardGridSkeleton } from '@/components/LeaderboardGridSkeleton';

// Grid Pro needs the DOM, so the leaderboard renders on the client only.
export const HomeLeaderboard = dynamic(
  () => import('@/components/GridLeaderboard').then((m) => ({ default: m.GridLeaderboard })),
  { ssr: false, loading: () => <LeaderboardGridSkeleton /> },
);
