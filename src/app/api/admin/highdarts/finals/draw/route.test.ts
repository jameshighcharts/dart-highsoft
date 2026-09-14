import { beforeEach, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { POST, DELETE } from './route';
import { completedGroups } from '@/test-utils/highdartsFixtures';
import { buildStandings } from '@/lib/highdarts/standings';
import { projectFinals } from '@/lib/highdarts/finals';
const { guard, rpc } = vi.hoisted(() => ({ guard: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/auth/requireAdmin', () => ({
  requireAdmin: guard,
  isGuardResponse: (v: unknown) => v instanceof NextResponse,
}));
vi.mock('@/lib/supabaseServer', () => ({
  getSupabaseServerClient: () => ({ rpc }),
}));
const snapshot = completedGroups();
const selection = projectFinals(buildStandings(snapshot)).selection;
const request = (body: unknown = selection) =>
  new Request('http://localhost', {
    method: 'POST',
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  guard.mockResolvedValue({ user: { isAdmin: true } });
  rpc.mockImplementation(async (name: string) =>
    name === 'highdarts_snapshot'
      ? { data: snapshot, error: null }
      : { error: null },
  );
});
it('denies nonadmins before reading standings or mutating fixtures', async () => {
  guard.mockResolvedValue(
    NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
  );
  expect((await POST(request())).status).toBe(403);
  expect((await DELETE()).status).toBe(403);
  expect(rpc).not.toHaveBeenCalled();
});
it('rejects a stringified request body and malformed pairs', async () => {
  expect((await POST(request(JSON.stringify(selection)))).status).toBe(400);
  expect(
    (await POST(request({ ...selection, playoffs: [['bad']] }))).status,
  ).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
});
it('persists the server-validated graph with a full snapshot comparison', async () => {
  expect((await POST(request())).status).toBe(200);
  expect(rpc).toHaveBeenLastCalledWith(
    'lock_highdarts_draw_atomic',
    expect.objectContaining({
      p_expected: snapshot,
      p_games: expect.arrayContaining([
        expect.objectContaining({
          stage: 'final',
          position: 1,
          player_a_id: null,
          player_b_id: null,
        }),
      ]),
    }),
  );
});
it('rejects duplicate or stale locks without creating another graph', async () => {
  rpc.mockImplementation(async (name: string) =>
    name === 'highdarts_snapshot'
      ? { data: snapshot, error: null }
      : { error: { code: '55000', message: 'Results changed' } },
  );
  expect((await POST(request())).status).toBe(409);
  expect((await DELETE()).status).toBe(409);
});
