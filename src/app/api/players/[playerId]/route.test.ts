import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PATCH } from './route';

vi.mock('server-only', () => ({}));

const getSupabaseServerClientMock = vi.fn();

vi.mock('@/lib/supabaseServer', () => ({
  getSupabaseServerClient: () => getSupabaseServerClientMock(),
}));

describe('PATCH /api/players/[playerId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects locations outside the configured list', async () => {
    const request = new Request('http://localhost/api/players/player-1', {
      method: 'PATCH',
      body: JSON.stringify({ location: 'oslo' }),
      headers: { 'content-type': 'application/json' },
    });

    const response = await PATCH(request, { params: Promise.resolve({ playerId: 'player-1' }) });

    expect(response.status).toBe(400);
    expect(getSupabaseServerClientMock).not.toHaveBeenCalled();
  });

  it('updates a player location', async () => {
    const single = vi.fn().mockResolvedValue({
      data: { id: 'player-1', display_name: 'Player One', location: 'bergen' },
      error: null,
    });
    const eq = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single }) });
    const update = vi.fn().mockReturnValue({ eq });
    getSupabaseServerClientMock.mockReturnValue({ from: () => ({ update }) });

    const request = new Request('http://localhost/api/players/player-1', {
      method: 'PATCH',
      body: JSON.stringify({ location: 'bergen' }),
      headers: { 'content-type': 'application/json' },
    });

    const response = await PATCH(request, { params: Promise.resolve({ playerId: 'player-1' }) });

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith({ location: 'bergen' });
    expect(eq).toHaveBeenCalledWith('id', 'player-1');
  });
});
