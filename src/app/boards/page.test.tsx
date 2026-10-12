import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiRequest } from '@/lib/apiClient';
import { scoliaBoardsQuery } from '@/lib/queries/boards';
import type { ScoliaBoard } from '@/lib/scolia/types';
import BoardsPage from './page';

const { realtime } = vi.hoisted(() => ({ realtime: { handlers: null as null | { onReconcile: () => void } } }));
vi.mock('@/lib/apiClient', () => ({ apiRequest: vi.fn() }));
vi.mock('@/hooks/useScoliaBoardRealtime', () => ({
  useScoliaBoardRealtime: (handlers: { onReconcile: () => void }) => { realtime.handlers = handlers; },
}));

const board = (name: string): ScoliaBoard => ({
  id: `${name}-id`, name, serialNumber: `${name}-serial`, isHomeSbc: false,
  workerConnectionStatus: 'connected', boardStatus: 'Ready', workerHeartbeatAt: new Date().toISOString(),
});

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
function renderPage(client: QueryClient) {
  render(<QueryClientProvider client={client}><BoardsPage /></QueryClientProvider>);
}
const boardFetches = () => vi.mocked(apiRequest).mock.calls.filter(([url]) => url === '/api/scolia/boards').length;

beforeEach(() => { vi.clearAllMocks(); realtime.handlers = null; });
afterEach(() => cleanup());

it('shows boards cached from an earlier visit at once while they refresh', async () => {
  vi.mocked(apiRequest).mockReturnValue(new Promise(() => {}));
  const client = newClient();
  client.setQueryData(scoliaBoardsQuery().queryKey, [board('Vik')]);
  renderPage(client);
  expect(screen.getByText('Vik')).toBeInTheDocument();
  expect(screen.queryByText('Loading boards…')).not.toBeInTheDocument();
  await waitFor(() => expect(boardFetches()).toBe(1));
});

it('reads the boards again after subscribing when the first read started before the subscription', async () => {
  let resolveFirst: (value: { boards: ScoliaBoard[] }) => void = () => {};
  vi.mocked(apiRequest)
    .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve as typeof resolveFirst; }))
    .mockResolvedValue({ boards: [board('Bergen')] });
  renderPage(newClient());
  expect(screen.getByText('Loading boards…')).toBeInTheDocument();
  realtime.handlers!.onReconcile(); // subscribed while the first read is still in flight
  expect(boardFetches()).toBe(1);
  resolveFirst({ boards: [board('Vik')] });
  expect(await screen.findByText('Bergen')).toBeInTheDocument();
  expect(boardFetches()).toBe(2);
});

it('reads once on a reconcile with no read in flight', async () => {
  vi.mocked(apiRequest).mockResolvedValue({ boards: [board('Vik')] });
  renderPage(newClient());
  expect(await screen.findByText('Vik')).toBeInTheDocument();
  realtime.handlers!.onReconcile();
  await waitFor(() => expect(boardFetches()).toBe(2));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(boardFetches()).toBe(2);
});
