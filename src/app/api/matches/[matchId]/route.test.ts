import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DELETE } from './route';

vi.mock('server-only', () => ({}));

const getSupabaseServerClientMock = vi.fn();
const loadMatchMock = vi.fn();
const sessionMock = vi.fn();
vi.mock('@/auth', () => ({ getAuthenticatedSession: () => sessionMock() }));

vi.mock('@/lib/supabaseServer', () => ({
  getSupabaseServerClient: () => getSupabaseServerClientMock(),
}));

vi.mock('@/lib/server/matchGuards', () => ({
  loadMatch: (...args: unknown[]) => loadMatchMock(...args),
}));

function deleteRequest() {
  return new Request('http://localhost/api/matches/match-1', { method: 'DELETE' });
}

describe('DELETE /api/matches/[matchId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionMock.mockResolvedValue({ user: { email: 'player@example.com', slackTeamId: 'team' } });
  });

  it('requires a signed-in workspace session', async () => {
    sessionMock.mockResolvedValue(null);
    const response = await DELETE(deleteRequest(), {
      params: Promise.resolve({ matchId: 'match-1' }),
    });

    expect(response.status).toBe(401);
    expect(getSupabaseServerClientMock).not.toHaveBeenCalled();
  });

  it('deletes a standalone match without a passcode', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const supabase = { from: vi.fn(() => ({ delete: () => ({ eq }) })) };
    getSupabaseServerClientMock.mockReturnValue(supabase);
    loadMatchMock.mockResolvedValue({ id: 'match-1', tournament_match_id: null });

    const response = await DELETE(deleteRequest(), {
      params: Promise.resolve({ matchId: 'match-1' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(eq).toHaveBeenCalledWith('id', 'match-1');
  });

  it.each([{ tournament_match_id: 'tm-1' }, { highdarts_fixture_id: 'fixture-1' }])('refuses to delete a linked tournament result: %j', async (link) => {
    const from = vi.fn();
    getSupabaseServerClientMock.mockReturnValue({ from });
    loadMatchMock.mockResolvedValue({ id: 'match-1', ...link });

    const response = await DELETE(deleteRequest(), {
      params: Promise.resolve({ matchId: 'match-1' }),
    });

    expect(response.status).toBe(403);
    expect(from).not.toHaveBeenCalled();
  });
});
