import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/lib/supabaseServer', () => ({ getSupabaseServerClient: () => ({ from }) }));
describe('match revision recovery check', () => {
  let rows: Record<string, { data: unknown; error: unknown }>;
  beforeEach(() => {
    rows = {
      matches: { data: { id: 'm' }, error: null },
      dartiq_source_revisions: { data: { revision: 42 }, error: null },
      match_players: { data: [{ player_id: 'p', players: { display_name: 'Ada' } }], error: null },
    };
    from.mockImplementation(table => {
      const query = { select: vi.fn(() => query), eq: vi.fn(() => query),
        maybeSingle: vi.fn(async () => rows[table]), order: vi.fn(async () => rows[table]) };
      return query;
    });
  });
  const get = () => GET(new Request('http://localhost'), { params: Promise.resolve({ matchId: 'm' }) });
  it('returns a compact uncached token covering match changes and player edits', async () => {
    const first = await get();
    expect(first.headers.get('Cache-Control')).toBe('no-store');
    const token = (await first.json()).revision;
    rows.match_players.data = [{ player_id: 'p', players: { display_name: 'New name' } }];
    expect((await (await get()).json()).revision).not.toBe(token);
    rows.dartiq_source_revisions.data = { revision: 43 };
    expect((await (await get()).json()).revision).toContain('43');
    expect(from.mock.calls.some(([table]) => table === 'throws' || table === 'turns')).toBe(false);
  });
  it('returns 404 for deleted matches', async () => {
    rows.matches.data = null;
    expect((await get()).status).toBe(404);
  });
  it('does not report unchanged state when the revision query fails', async () => {
    rows.dartiq_source_revisions.error = { message: 'unavailable' };
    expect((await get()).status).toBe(503);
  });
});
