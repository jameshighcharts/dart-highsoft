import { expect, it, vi } from 'vitest';
import { PATCH } from './route';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabaseServer', () => ({
  getSupabaseServerClient: () => ({ rpc }),
}));
const id = '00000000-0000-4000-8000-000000000001';
it('reports a started match as a clear conflict', async () => {
  rpc.mockResolvedValue({
    error: {
      code: '55000',
      message: 'Scoring has started. Start a new match from the Bengt page.',
    },
  });
  const response = await PATCH(
    new Request('http://localhost', {
      method: 'PATCH',
      body: JSON.stringify({ fixtureId: id }),
    }),
    { params: Promise.resolve({ matchId: id }) },
  );
  expect(response.status).toBe(409);
  expect((await response.json()).error).toContain('Bengt page');
});
it('validates malformed JSON before calling the database', async () => {
  const response = await PATCH(
    new Request('http://localhost', { method: 'PATCH', body: '{' }),
    { params: Promise.resolve({ matchId: id }) },
  );
  expect(response.status).toBe(400);
});
