import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DELETE } from './route';

vi.mock('server-only', () => ({}));

const getSupabaseServerClientMock = vi.fn();
const loadMatchMock = vi.fn();

vi.mock('@/lib/supabaseServer', () => ({
  getSupabaseServerClient: () => getSupabaseServerClientMock(),
}));

vi.mock('@/lib/server/matchGuards', () => ({
  loadMatch: (...args: unknown[]) => loadMatchMock(...args),
}));

function deleteRequest(passcode?: string) {
  return new Request('http://localhost/api/matches/match-1', {
    method: 'DELETE',
    headers: passcode ? { 'x-admin-passcode': passcode } : undefined,
  });
}

describe('DELETE /api/matches/[matchId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GAME_DELETE_PASSCODE = '123';
  });

  it('requires the configured admin passcode', async () => {
    const response = await DELETE(deleteRequest('wrong'), {
      params: Promise.resolve({ matchId: 'match-1' }),
    });

    expect(response.status).toBe(401);
    expect(getSupabaseServerClientMock).not.toHaveBeenCalled();
  });

  it('deletes a standalone match', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const supabase = { from: vi.fn(() => ({ delete: () => ({ eq }) })) };
    getSupabaseServerClientMock.mockReturnValue(supabase);
    loadMatchMock.mockResolvedValue({ id: 'match-1', tournament_match_id: null });

    const response = await DELETE(deleteRequest('123'), {
      params: Promise.resolve({ matchId: 'match-1' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(eq).toHaveBeenCalledWith('id', 'match-1');
  });

  it('refuses to delete an individual tournament match', async () => {
    const from = vi.fn();
    getSupabaseServerClientMock.mockReturnValue({ from });
    loadMatchMock.mockResolvedValue({ id: 'match-1', tournament_match_id: 'tm-1' });

    const response = await DELETE(deleteRequest('123'), {
      params: Promise.resolve({ matchId: 'match-1' }),
    });

    expect(response.status).toBe(403);
    expect(from).not.toHaveBeenCalled();
  });
});
