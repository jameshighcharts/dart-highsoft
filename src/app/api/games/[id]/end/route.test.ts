import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PATCH } from './route';
import { createSupabaseMock, type MockOp, type MockRow } from '@/test-utils/gameSupabaseMock';
import { cricketSession, SESSION_ID } from '@/test-utils/gameFixtures';

vi.mock('server-only', () => ({}));

const getSupabaseServerClientMock = vi.fn();

vi.mock('@/lib/supabaseServer', () => ({
  getSupabaseServerClient: () => getSupabaseServerClientMock(),
}));

const request = new Request(`http://localhost/api/games/${SESSION_ID}/end`, { method: 'PATCH' });
const params = Promise.resolve({ id: SESSION_ID });

describe('PATCH /api/games/[id]/end', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('returns 404 for a missing game', async () => {
    getSupabaseServerClientMock.mockReturnValue(createSupabaseMock({ game_sessions: [] }));
    const response = await PATCH(request, { params });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Game not found' });
  });

  it.each(['completed', 'ended_early'] as const)('returns 409 when the game is already %s', async (status) => {
    const supabase = createSupabaseMock({ game_sessions: [cricketSession({ status }) as unknown as MockRow] });
    getSupabaseServerClientMock.mockReturnValue(supabase);

    const response = await PATCH(request, { params });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'Game is already finished' });
    expect(supabase.opsFor('game_sessions', 'update')).toHaveLength(0);
  });

  it('ends an active game early, guarded on status = active', async () => {
    const sessions = [cricketSession() as unknown as MockRow];
    const supabase = createSupabaseMock({ game_sessions: sessions });
    getSupabaseServerClientMock.mockReturnValue(supabase);

    const response = await PATCH(request, { params });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    const update = supabase.opsFor('game_sessions', 'update')[0]!;
    expect(update.payload).toEqual({ status: 'ended_early', completed_at: expect.any(String) });
    expect(update.options).toEqual({ count: 'exact' });
    expect(update.filters).toEqual([
      { kind: 'eq', column: 'id', value: SESSION_ID },
      { kind: 'eq', column: 'status', value: 'active' },
    ]);
    expect(sessions[0]!.status).toBe('ended_early');
  });

  it('returns 409 when the game was finished concurrently', async () => {
    const supabase = createSupabaseMock({
      game_sessions: (op: MockOp) => op.type === 'update'
        ? { data: null, error: null, count: 0 }
        : { data: [cricketSession() as unknown as MockRow], error: null },
    });
    getSupabaseServerClientMock.mockReturnValue(supabase);

    const response = await PATCH(request, { params });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'Game is already finished' });
  });

  it('returns 500 when the update fails', async () => {
    const supabase = createSupabaseMock({
      game_sessions: (op: MockOp) => op.type === 'update'
        ? { data: null, error: { message: 'update failed' } }
        : { data: [cricketSession() as unknown as MockRow], error: null },
    });
    getSupabaseServerClientMock.mockReturnValue(supabase);

    const response = await PATCH(request, { params });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'update failed' });
  });
});
