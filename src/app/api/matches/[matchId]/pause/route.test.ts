import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PATCH } from './route';

vi.mock('server-only', () => ({}));

const getSupabaseServerClientMock = vi.fn();
const loadMatchMock = vi.fn();
const isMatchActiveMock = vi.fn();

vi.mock('@/lib/supabaseServer', () => ({
  getSupabaseServerClient: () => getSupabaseServerClientMock(),
}));

vi.mock('@/lib/server/matchGuards', () => ({
  loadMatch: (...args: unknown[]) => loadMatchMock(...args),
  isMatchActive: (...args: unknown[]) => isMatchActiveMock(...args),
}));

describe('PATCH /api/matches/[matchId]/pause', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a non-boolean pause value', async () => {
    const request = new Request('http://localhost/api/matches/match-1/pause', {
      method: 'PATCH',
      body: JSON.stringify({ paused: 'yes' }),
      headers: { 'content-type': 'application/json' },
    });

    const response = await PATCH(request, { params: Promise.resolve({ matchId: 'match-1' }) });

    expect(response.status).toBe(400);
    expect(getSupabaseServerClientMock).not.toHaveBeenCalled();
  });

  it('writes a pause timestamp for an active match', async () => {
    const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    getSupabaseServerClientMock.mockReturnValue({ from: () => ({ update }) });
    loadMatchMock.mockResolvedValue({ id: 'match-1' });
    isMatchActiveMock.mockReturnValue(true);

    const request = new Request('http://localhost/api/matches/match-1/pause', {
      method: 'PATCH',
      body: JSON.stringify({ paused: true }),
      headers: { 'content-type': 'application/json' },
    });

    const response = await PATCH(request, { params: Promise.resolve({ matchId: 'match-1' }) });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.pausedAt).toEqual(expect.any(String));
    expect(update).toHaveBeenCalledWith({ paused_at: json.pausedAt });
  });
});
