import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { refreshAfterChange } from './refreshAfterChange';

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const resolvers: Array<(value: number) => void> = [];
  const queryFn = vi.fn(() => new Promise<number>((resolve) => { resolvers.push(resolve); }));
  // An active observer, like a mounted page.
  const unsubscribe = new QueryObserver(client, { queryKey: ['boards'], queryFn }).subscribe(() => {});
  const finish = async (value: number) => { resolvers.shift()?.(value); await new Promise((r) => setTimeout(r, 0)); };
  return { client, queryFn, finish, unsubscribe };
}

it('reads again after a fetch that was already in flight when the change happened', async () => {
  const { client, queryFn, finish, unsubscribe } = setup();
  expect(queryFn).toHaveBeenCalledTimes(1);
  refreshAfterChange(client, ['boards']);
  refreshAfterChange(client, ['boards']);
  await finish(1);
  expect(queryFn).toHaveBeenCalledTimes(2);
  await finish(2);
  expect(client.getQueryData(['boards'])).toBe(2);
  unsubscribe();
});

it('reads once when nothing is in flight', async () => {
  const { client, queryFn, finish, unsubscribe } = setup();
  await finish(1);
  refreshAfterChange(client, ['boards']);
  expect(queryFn).toHaveBeenCalledTimes(2);
  await finish(2);
  expect(queryFn).toHaveBeenCalledTimes(2);
  unsubscribe();
});
