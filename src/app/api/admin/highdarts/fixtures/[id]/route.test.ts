import { beforeEach, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { PATCH } from './route';
const { guard, rpc } = vi.hoisted(() => ({ guard: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/auth/requireAdmin', () => ({
  requireAdmin: guard,
  isGuardResponse: (value: unknown) => value instanceof NextResponse,
}));
vi.mock('@/lib/supabaseServer', () => ({
  getSupabaseServerClient: () => ({ rpc }),
}));
const id = '00000000-0000-4000-8000-000000000001';
const request = () =>
  new Request('http://localhost', {
    method: 'PATCH',
    body: JSON.stringify({ side: 'a', playerId: id }),
  });
beforeEach(() => {
  vi.clearAllMocks();
  guard.mockResolvedValue({ user: { isAdmin: true } });
});
it('requires admin before accepting a mapping', async () => {
  guard.mockResolvedValue(
    NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
  );
  expect(
    (await PATCH(request(), { params: Promise.resolve({ id }) })).status,
  ).toBe(403);
  expect(rpc).not.toHaveBeenCalled();
});
it('maps all occurrences through a single atomic RPC', async () => {
  rpc.mockResolvedValue({ error: null });
  expect(
    (await PATCH(request(), { params: Promise.resolve({ id }) })).status,
  ).toBe(200);
  expect(rpc).toHaveBeenCalledWith('map_highdarts_player_atomic', {
    p_fixture_id: id,
    p_side: 'a',
    p_player_id: id,
  });
});
it('returns 409 when the fixture was claimed while mapping', async () => {
  rpc.mockResolvedValue({
    error: { code: '55000', message: 'Fixture is already claimed' },
  });
  expect(
    (await PATCH(request(), { params: Promise.resolve({ id }) })).status,
  ).toBe(409);
});
