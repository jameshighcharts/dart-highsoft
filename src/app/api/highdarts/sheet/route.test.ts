import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fixture } from '@/test-utils/highdartsFixtures';
import { GET } from './route';
const { load } = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('@/lib/highdarts/server', () => ({ loadHighdarts: load }));
vi.mock('@/lib/supabaseServer', () => ({ getSupabaseServerClient: () => ({}) }));
beforeEach(() => vi.clearAllMocks());
const draw = (sogndal: number) => ({ players: [], fixtures: [
  ...Array.from({ length: 30 }, (_, i) => fixture('bergen', 'a', 'b', i + 1)),
  ...Array.from({ length: 33 }, (_, i) => fixture('vik', 'c', 'd', i + 1)),
  ...Array.from({ length: sogndal }, (_, i) => fixture('sogndal', 'e', 'f', i + 1)),
] });
describe('sheet feed rollout compatibility', () => {
  it.each([13, 17])('serves a complete draw with %i Sogndal fixtures', async (count) => {
    load.mockResolvedValue(draw(count));
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).fixtures).toHaveLength(63 + count);
  });
  it('rejects an incomplete admission instead of publishing partial results', async () => {
    load.mockResolvedValue(draw(16));
    expect((await GET()).status).toBe(503);
  });
  it('rejects duplicate numbers even when the total looks complete', async () => {
    const snapshot = draw(17);
    snapshot.fixtures[1].fixture_no = 1;
    load.mockResolvedValue(snapshot);
    expect((await GET()).status).toBe(503);
  });
});
