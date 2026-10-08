// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ check: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/server/scoliaPhaseReset', () => ({ checkScoliaPhaseReset: mocks.check }));
vi.mock('@/lib/supabaseServer', () => ({ getSupabaseServerClient: () => ({ from: mocks.from }) }));
import { POST } from './route';
const matchId = '00000000-0000-4000-8000-000000000001';
const context = { params: Promise.resolve({ matchId }) };
function request(origin = 'http://localhost', body?: object) {
  return new NextRequest(`http://localhost/api/matches/${matchId}/scolia/reset-phase`, { method: 'POST', headers: { origin }, body: body && JSON.stringify(body) });
}
beforeEach(() => { vi.clearAllMocks(); mocks.check.mockResolvedValue({ boardId: 'board' }); });

describe('startup reset endpoint', () => {
  it('rejects cross-origin requests before accessing the board', async () => {
    expect((await POST(request('https://elsewhere.example'), context)).status).toBe(403);
    expect(mocks.check).not.toHaveBeenCalled();
  });
  it('rejects reset after a dart registers', async () => {
    mocks.check.mockResolvedValue({ error: 'A dart has already registered. Reset cancelled.' });
    expect((await POST(request(), context)).status).toBe(409);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('passes the manual flag to the guard only when requested', async () => {
    mocks.check.mockResolvedValue({ error: 'nope' });
    await POST(request(), context);
    expect(mocks.check).toHaveBeenLastCalledWith(expect.anything(), matchId, { manual: false });
    await POST(request('http://localhost', { manual: true }), context);
    expect(mocks.check).toHaveBeenLastCalledWith(expect.anything(), matchId, { manual: true });
  });
  it.each([false, true])('queues a reset or reuses an existing pending request (%s)', async existing => {
    const insert = vi.fn();
    const query = { select: () => query, eq: () => query, in: () => query, limit: () => query,
      maybeSingle: async () => ({ data: existing ? { id: 'command' } : null, error: null }),
      insert: (value: unknown) => { insert(value); return query; },
      single: async () => ({ data: { id: 'command' }, error: null }) };
    mocks.from.mockReturnValue(query);
    const response = await POST(request(), context);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ commandId: 'command' });
    if (existing) expect(insert).not.toHaveBeenCalled();
    else expect(insert).toHaveBeenCalledWith({ board_id: 'board', match_id: matchId, command_type: 'RESET_PHASE', payload: {} });
  });
});
