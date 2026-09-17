import { beforeEach, expect, it, vi } from 'vitest';
import { PATCH } from './route';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabaseServer', () => ({ getSupabaseServerClient: () => ({ rpc }) }));
beforeEach(() => vi.clearAllMocks());
const end = () => PATCH(new Request('http://localhost/api/matches/match-1/end', { method: 'PATCH' }), { params: Promise.resolve({ matchId: 'match-1' }) });
it.each([{ ok: true }, { ok: true, resetFixtureId: 'fixture-1' }])('returns the atomic end result %j', async (data) => {
  rpc.mockResolvedValue({ data, error: null });
  const response = await end();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(data);
  expect(rpc).toHaveBeenCalledWith('end_match_early_atomic', { p_match_id: 'match-1' });
});
it.each([['P0002', 404], ['55000', 409], ['42501', 403], ['XX000', 500]])('preserves database failure %s', async (code, status) => {
  rpc.mockResolvedValue({ data: null, error: { code, message: 'Cannot end this match' } });
  const response = await end();
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ error: 'Cannot end this match' });
});
