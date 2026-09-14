import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabaseServer', () => ({
  getSupabaseServerClient: () => ({ rpc }),
}));
const fixtureId = '00000000-0000-4000-8000-000000000001';
const body = {
  highdartsFixtureId: fixtureId,
  startScore: 301,
  finishRule: 'single_out',
  legsToWin: 2,
  fairEnding: false,
  playerIds: [
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003',
  ],
};
function request(overrides = {}) {
  return new NextRequest('http://localhost/api/matches', {
    method: 'POST',
    body: JSON.stringify({ ...body, ...overrides }),
  });
}
beforeEach(() => rpc.mockReset());
it('claims a fixture through the atomic creation RPC', async () => {
  rpc.mockReturnValue({
    single: async () => ({ data: { id: 'new-match' }, error: null }),
  });
  expect((await POST(request())).status).toBe(201);
  expect(rpc).toHaveBeenCalledWith(
    'create_highdarts_match_atomic',
    expect.objectContaining({
      p_fixture_id: fixtureId,
      p_start_score: '301',
      p_finish: 'single_out',
      p_legs_to_win: 2,
      p_fair_ending: false,
    }),
  );
});
it('maps a double claim to 409', async () => {
  rpc.mockReturnValue({
    single: async () => ({
      data: null,
      error: { code: '23505', message: 'Already linked' },
    }),
  });
  expect((await POST(request())).status).toBe(409);
});
it('maps invalid tournament settings to 400', async () => {
  rpc.mockReturnValue({
    single: async () => ({
      data: null,
      error: { code: '22023', message: 'Wrong settings' },
    }),
  });
  expect((await POST(request({ startScore: 501 }))).status).toBe(400);
});
it('rejects fair ending instead of silently coercing it', async () => {
  expect((await POST(request({ fairEnding: true }))).status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
});
it('rejects a malformed fixture ID', async () => {
  expect((await POST(request({ highdartsFixtureId: 'bad' }))).status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
});
