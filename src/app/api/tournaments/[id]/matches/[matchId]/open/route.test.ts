import { beforeEach, expect, it, vi } from 'vitest';
import { POST } from './route';
const mocks = vi.hoisted(() => ({ client: vi.fn(), available: vi.fn() }));
vi.mock('@/lib/supabaseServer', () => ({ getSupabaseServerClient: mocks.client }));
vi.mock('@/lib/server/scoliaBoardTarget', () => ({ assertScoliaBoardAvailable: mocks.available }));
const id = '10000000-0000-4000-8000-000000000001';
const matchId = '20000000-0000-4000-8000-000000000001';
const boardId = '30000000-0000-4000-8000-000000000001';
const open = () => POST(new Request('http://localhost/open', { method: 'POST' }), { params: Promise.resolve({ id, matchId }) });
function setup({ member = true, completed = false, assigned = false, conflict = false, manual = false } = {}) {
  const update = vi.fn();
  const filters = vi.fn();
  const from = vi.fn((table: string) => {
    let updating = false;
    const result = () => ({ data: table === 'tournament_matches' ? (member ? { id: 'slot' } : null)
      : table === 'tournaments' ? { scolia_board_id: manual ? null : boardId, commentary_enabled: true }
      : updating ? (conflict ? null : { id: matchId })
      : { scolia_board_id: assigned ? boardId : null, completed_at: completed ? '2026-09-08' : null, winner_player_id: null, ended_early: false, paused_at: null },
      error: updating && conflict ? { code: '23505', message: 'conflict' } : null });
    const query = {
      select: vi.fn(() => query), eq: vi.fn((...args) => { filters(...args); return query; }),
      is: vi.fn(() => query), single: vi.fn(async () => result()), maybeSingle: vi.fn(async () => result()),
      update: vi.fn((value) => { updating = true; update(value); return query; }),
    };
    return query;
  });
  mocks.client.mockReturnValue({ from });
  return { update, from, filters };
}
beforeEach(() => { vi.clearAllMocks(); mocks.available.mockResolvedValue({ ok: true }); });
it('claims a ready board for the requested tournament match and returns commentary', async () => {
  const { update, filters } = setup();
  const response = await open();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ commentaryEnabled: true });
  expect(update).toHaveBeenCalledWith({ scolia_board_id: boardId });
  expect(filters).toHaveBeenCalledWith('tournament_id', id);
  expect(filters).toHaveBeenCalledWith('tournament_match_id', 'slot');
});
it('rejects matches outside the tournament before claiming a board', async () => {
  const { update } = setup({ member: false });
  expect((await open()).status).toBe(404);
  expect(update).not.toHaveBeenCalled();
});
it('does not take a board occupied by another game', async () => {
  const { update } = setup();
  mocks.available.mockResolvedValue({ ok: false, status: 409, error: 'Board in use' });
  expect((await open()).status).toBe(409);
  expect(update).not.toHaveBeenCalled();
});
it('reports a concurrent board claim as a conflict', async () => {
  setup({ conflict: true });
  expect((await open()).status).toBe(409);
});
it('reopens an already assigned match without requiring the board to be Ready', async () => {
  const { update } = setup({ assigned: true });
  expect((await open()).status).toBe(200);
  expect(mocks.available).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
});
it('opens completed matches without taking a board or starting commentary', async () => {
  const { update } = setup({ completed: true });
  const response = await open();
  expect(await response.json()).toEqual({ commentaryEnabled: false });
  expect(update).not.toHaveBeenCalled();
  expect(mocks.available).not.toHaveBeenCalled();
});
it('opens manual tournament matches without claiming a board', async () => {
  const { update } = setup({ manual: true });
  expect((await open()).status).toBe(200);
  expect(update).not.toHaveBeenCalled();
});
