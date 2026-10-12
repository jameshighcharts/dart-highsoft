import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
vi.mock('@/lib/supabaseServer', () => ({ getSupabaseServerClient: () => ({}) }));
vi.mock('@/lib/server/matchGuards', () => ({
  loadMatch: vi.fn(async () => ({ id: 'match-1', paused_at: null, tournament_match_id: null })),
  isMatchActive: () => true,
}));
vi.mock('@/lib/server/completeLeg', () => ({ completeLeg: vi.fn(async () => ({ matchCompleted: false })) }));
vi.mock('@/lib/tournament/advance', () => ({ advanceTournament: vi.fn() }));

import { revalidateTag } from 'next/cache';
import { completeLeg } from '@/lib/server/completeLeg';
import { SHARED_DATA_TAG } from '@/lib/shared/tag';
import { POST } from './route';

const complete = (body: unknown) => POST(
  new Request('http://localhost/api/matches/match-1/legs/leg-1/complete', { method: 'POST', body: JSON.stringify(body) }),
  { params: Promise.resolve({ matchId: 'match-1', legId: 'leg-1' }) },
);

describe('POST /api/matches/[matchId]/legs/[legId]/complete', () => {
  beforeEach(() => {
    vi.mocked(revalidateTag).mockReset();
    vi.mocked(completeLeg).mockClear();
  });

  it('purges the shared leaderboards and stats once the leg is saved', async () => {
    const response = await complete({ winnerPlayerId: 'player-1' });
    expect(response.status).toBe(200);
    expect(completeLeg).toHaveBeenCalledOnce();
    expect(revalidateTag).toHaveBeenCalledWith(SHARED_DATA_TAG, { expire: 0 });
  });

  it('leaves the cache alone when the leg is not completed', async () => {
    expect((await complete({})).status).toBe(400);
    vi.spyOn(console, 'error').mockImplementationOnce(() => {});
    vi.mocked(completeLeg).mockRejectedValueOnce(new Error('boom'));
    expect((await complete({ winnerPlayerId: 'player-1' })).status).toBe(500);
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});
