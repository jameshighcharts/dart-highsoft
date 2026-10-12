"use client";

import { useQueryClient } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { useEffect } from 'react';

import { LeaderboardGridSkeleton } from '@/components/LeaderboardGridSkeleton';
import { prefetchHomeLeaderboard } from '@/lib/queries/homeLeaderboard';

const loadGrid = () => import('@/components/GridLeaderboard').then((m) => ({ default: m.GridLeaderboard }));

// Start downloading the grid's code as soon as the page's own code runs, alongside hydration.
if (typeof window !== 'undefined') void loadGrid();

// Grid Pro needs the DOM, so the leaderboard renders on the client only.
const GridLeaderboard = dynamic(loadGrid, { ssr: false, loading: () => <LeaderboardGridSkeleton /> });

export function HomeLeaderboard() {
  const queryClient = useQueryClient();
  // Start the leaderboard and trend requests together with the grid's code instead of after it.
  useEffect(() => {
    void prefetchHomeLeaderboard(queryClient).catch(() => {});
  }, [queryClient]);
  return <GridLeaderboard />;
}
