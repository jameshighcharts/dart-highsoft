import type { QueryClient, QueryKey } from '@tanstack/react-query';

/**
 * Re-reads a query in the background after something changed. A fetch already in flight may have
 * read the data before the change, so it is allowed to land and the data is read once more;
 * changes that overlap share that follow-up read.
 */
export function refreshAfterChange(queryClient: QueryClient, queryKey: QueryKey): void {
  const refetch = () => queryClient.invalidateQueries({ queryKey }, { cancelRefetch: false });
  if (queryClient.isFetching({ queryKey }) > 0) void refetch().then(refetch);
  else void refetch();
}
