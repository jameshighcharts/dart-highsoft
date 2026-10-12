import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { LoadingReveal } from '@/components/LoadingReveal';
import { type ReactNode } from 'react';

type LeaderboardSectionProps = {
  title: string;
  emptyMessage: string;
  emptySubMessage?: string;
  isEmpty: boolean;
  /** Shows placeholder rows (announced as `loadingLabel`) instead of the empty message. */
  loading?: boolean;
  loadingLabel?: string;
  onClick?: () => void;
  className?: string;
  children: ReactNode;
};

export function LeaderboardSection({
  title,
  emptyMessage,
  emptySubMessage,
  isEmpty,
  loading = false,
  loadingLabel = `Loading ${title}…`,
  onClick,
  className,
  children,
}: LeaderboardSectionProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-xl font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul
          className={`divide-y border rounded bg-card${onClick ? ' cursor-pointer' : ''}`}
          onClick={onClick}
          title={onClick ? `View full ${title} leaderboard` : undefined}
        >
          {children}
          {loading && isEmpty && (
            <LoadingReveal as="li" label={loadingLabel} className="divide-y">
              {Array.from({ length: 10 }, (_, index) => (
                <div key={index} className="flex items-center gap-3 px-3 py-2">
                  <Skeleton className="size-6 rounded-full" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-4 w-12" />
                </div>
              ))}
            </LoadingReveal>
          )}
          {!loading && isEmpty && (
            <li className="px-3 py-4 text-sm text-muted-foreground">
              <div>{emptyMessage}</div>
              {emptySubMessage && <div className="text-xs mt-1">{emptySubMessage}</div>}
            </li>
          )}
        </ul>
      </CardContent>
    </Card>
  );
}
