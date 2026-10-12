import { act, cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Link from 'next/link';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';


const { fetchPlayers } = vi.hoisted(() => ({ fetchPlayers: vi.fn(async () => [{ id: 'p1' }]) }));
vi.mock('@/lib/queries/routePrefetch', () => ({
  routePrefetch: (pathname: string) => pathname === '/players'
    ? (queryClient: QueryClient) => queryClient.prefetchQuery({ queryKey: ['players', 'list'], queryFn: fetchPlayers, staleTime: 0 })
    : undefined,
}));

import { RouteDataPrefetcher } from './RouteDataPrefetcher';

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers({ toFake: ['Date'] }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

function setup() {
  // Prefetched data has no subscriber yet, so it must outlive the test client's usual gcTime of 0.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <RouteDataPrefetcher />
      <Link href="/players"><span>Players</span></Link>
      <Link href="/unknown">Unknown</Link>
      <a href="https://example.com/players">Elsewhere</a>
    </QueryClientProvider>,
  );
  const hover = (text: string) => view.getByText(text).dispatchEvent(new Event('pointerover', { bubbles: true }));
  return { client, hover };
}

it('loads a page’s data when a link to it is hovered', async () => {
  const { client, hover } = setup();
  hover('Players');
  await flush();
  expect(fetchPlayers).toHaveBeenCalledTimes(1);
  expect(client.getQueryData(['players', 'list'])).toEqual([{ id: 'p1' }]);
});

it('prefetches a route at most once per cooldown, even for data that is never fresh', async () => {
  const { hover } = setup();
  hover('Players');
  hover('Players');
  await flush();
  expect(fetchPlayers).toHaveBeenCalledTimes(1);
  vi.setSystemTime(Date.now() + 5_001);
  hover('Players');
  await flush();
  expect(fetchPlayers).toHaveBeenCalledTimes(2);
});

it('ignores links without page data and links to other sites', async () => {
  const { hover } = setup();
  hover('Unknown');
  hover('Elsewhere');
  await flush();
  expect(fetchPlayers).not.toHaveBeenCalled();
});

it('does not prefetch the page that is already on screen', async () => {
  window.history.replaceState({}, '', '/players');
  try {
    const { hover } = setup();
    hover('Players');
    await flush();
    expect(fetchPlayers).not.toHaveBeenCalled();
  } finally {
    window.history.replaceState({}, '', '/');
  }
});
