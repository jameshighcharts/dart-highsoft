import { beforeEach, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { POST } from './route';
import { fixture, finish } from '@/test-utils/highdartsFixtures';
import { buildStandings } from '@/lib/highdarts/standings';
const { guard, rpc } = vi.hoisted(() => ({ guard: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/auth/requireAdmin', () => ({
  requireAdmin: guard,
  isGuardResponse: (v: unknown) => v instanceof NextResponse,
}));
vi.mock('@/lib/supabaseServer', () => ({
  getSupabaseServerClient: () => ({ rpc }),
}));
const [a, b, c, d, e] = [1, 2, 3, 4, 5].map(
  (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
);
const snapshot = {
  players: [],
  fixtures: [
    finish(fixture('bergen', a, b, 1), a, 90, 70),
    finish(fixture('bergen', c, d, 2), c, 80, 30),
    finish(fixture('bergen', a, e, 3), a, 90, 30),
  ],
};
const tie = buildStandings(snapshot).ties[0];
const request = (context = tie.context, playerIds = [d, e]) =>
  new Request('http://localhost', {
    method: 'POST',
    body: JSON.stringify({ context, playerIds }),
  });
beforeEach(() => {
  vi.clearAllMocks();
  guard.mockResolvedValue({ user: { isAdmin: true } });
  rpc.mockImplementation(async (name: string) =>
    name === 'highdarts_snapshot'
      ? { data: snapshot, error: null }
      : { data: 'created', error: null },
  );
});
it('requires admin before reading or creating a tie-break', async () => {
  guard.mockResolvedValue(
    NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
  );
  expect((await POST(request())).status).toBe(403);
  expect(rpc).not.toHaveBeenCalled();
});
it('creates only a current tie between the actual contenders', async () => {
  expect((await POST(request())).status).toBe(201);
  expect(rpc).toHaveBeenLastCalledWith('create_highdarts_tiebreak_atomic', {
    p_expected: snapshot,
    p_context: tie.context,
    p_office: 'bergen',
    p_player_ids: [d, e],
  });
  expect((await POST(request(tie.context, [a, b]))).status).toBe(409);
});
it('rejects stale ties and duplicate player selection', async () => {
  expect((await POST(request('outdated'))).status).toBe(409);
  expect((await POST(request(tie.context, [d, d]))).status).toBe(400);
});
