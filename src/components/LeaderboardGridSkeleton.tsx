import { LoadingReveal } from '@/components/LoadingReveal';
import { Skeleton } from '@/components/ui/skeleton';

/** The home leaderboard's toolbar and table shape, shown while the grid code or its data loads. */
export function LeaderboardGridSkeleton() {
  return (
    <LoadingReveal label="Loading leaderboard..." className="flex flex-col gap-[14px]">
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-9 w-56 rounded-lg" />
        <Skeleton className="h-9 w-72 rounded-lg" />
      </div>
      <div className="overflow-hidden rounded-lg border border-white/10">
        <Skeleton className="h-[84px] rounded-none border-b border-white/10" />
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="flex h-[47px] items-center gap-4 border-b border-white/5 px-3 last:border-b-0">
            <Skeleton className="size-6 rounded-md" />
            <Skeleton className="size-6 rounded-full" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="ml-auto h-5 w-28 rounded-full" />
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="hidden h-4 w-40 md:block" />
          </div>
        ))}
      </div>
    </LoadingReveal>
  );
}
