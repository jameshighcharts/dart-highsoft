import { describe, expect, it } from 'vitest';

import { appendGameThrow, loadGameSnapshot, removeLastGameThrow } from './gameThrowLifecycle.ts';
import { createSupabaseMock, type MockOp, type MockRow } from '@/test-utils/gameSupabaseMock';
import {
  buildSnapshot,
  CRICKET_WIN_SCRIPT,
  cricketSession,
  PLAYER_A,
  PLAYER_B,
  scriptCricketRows,
  SESSION_ID,
  sessionPlayerRows,
} from '@/test-utils/gameFixtures';

const ORDER = [PLAYER_A, PLAYER_B];

function insertingThrowsTable(onInsert?: (payload: MockRow) => void) {
  return (op: MockOp) => {
    if (op.type === 'insert') {
      onInsert?.(op.payload as MockRow);
      return { data: { id: 'throw-new', created_at: 'now', ...(op.payload as MockRow) }, error: null };
    }
    throw new Error(`Unexpected game_throws op ${op.type}`);
  };
}

describe('loadGameSnapshot', () => {
  it('returns null when the session does not exist', async () => {
    const supabase = createSupabaseMock({ game_sessions: [], game_session_players: [], game_throws: [] });
    await expect(loadGameSnapshot(supabase as never, SESSION_ID)).resolves.toBeNull();
  });

  it('loads players in play order and derives the engine state from the throws', async () => {
    const rows = scriptCricketRows(ORDER, [[PLAYER_A, 'T20'], [PLAYER_A, 'S19']]);
    const supabase = createSupabaseMock({
      game_sessions: [cricketSession()],
      game_session_players: sessionPlayerRows(ORDER).reverse(),
      game_throws: rows.slice().reverse(),
    });

    const snapshot = await loadGameSnapshot(supabase as never, SESSION_ID);

    expect(snapshot).not.toBeNull();
    expect(snapshot!.orderedPlayerIds).toEqual(ORDER);
    expect(snapshot!.players.map((p) => p.display_name)).toEqual(['Player 1', 'Player 2']);
    expect(snapshot!.engine.mode).toBe('cricket');
    expect(snapshot!.state.currentPlayerId).toBe(PLAYER_A);
    expect(snapshot!.state.dartsThrownInTurn).toBe(2);
    expect(snapshot!.state.turnSegments).toEqual(['T20', 'S19']);
  });

  it('throws when a query fails', async () => {
    const supabase = createSupabaseMock({
      game_sessions: () => ({ data: null, error: { message: 'boom' } }),
      game_session_players: [],
      game_throws: [],
    });
    await expect(loadGameSnapshot(supabase as never, SESSION_ID)).rejects.toThrow('boom');
  });
});

describe('appendGameThrow', () => {
  it('stamps the next slot from the derived state and persists the engine event as meta', async () => {
    const rows = scriptCricketRows(ORDER, [[PLAYER_A, 'T20'], [PLAYER_A, 'T20']]);
    let inserted: MockRow | null = null;
    const supabase = createSupabaseMock({ game_throws: insertingThrowsTable((payload) => { inserted = payload; }) });

    const result = await appendGameThrow(supabase as never, buildSnapshot(rows), { segment: 'T20', scored: 60 });

    expect(result.ok).toBe(true);
    expect(inserted).toEqual({
      session_id: SESSION_ID,
      player_id: PLAYER_A,
      round_number: 1,
      turn_index: 0,
      dart_index: 3,
      segment: 'T20',
      scored: 60,
      meta: { type: 'cricket_throw', playerId: PLAYER_A, target: 20, marks: 3, pointsScored: 60, closed: false },
      scolia_event_id: null,
      impact_x_mm: null,
      impact_y_mm: null,
      angle_horizontal_deg: null,
      angle_vertical_deg: null,
    });
    if (!result.ok) throw new Error('unreachable');
    expect(result.throw.id).toBe('throw-new');
    expect(result.state.currentPlayerId).toBe(PLAYER_B);
    expect(result.state.turnIndex).toBe(1);
    expect(result.state.dartsThrownInTurn).toBe(0);
    expect(supabase.opsFor('game_sessions')).toHaveLength(0);
  });

  it('moves to the next turn and round after the last player finishes three darts', async () => {
    const rows = scriptCricketRows(ORDER, CRICKET_WIN_SCRIPT.slice(0, 5));
    let inserted: MockRow | null = null;
    const supabase = createSupabaseMock({ game_throws: insertingThrowsTable((payload) => { inserted = payload; }) });

    const result = await appendGameThrow(supabase as never, buildSnapshot(rows), { segment: 'S5' });

    expect(result.ok).toBe(true);
    expect(inserted).toEqual(expect.objectContaining({ player_id: PLAYER_B, round_number: 1, turn_index: 1, dart_index: 3 }));
    if (!result.ok) throw new Error('unreachable');
    expect(result.state).toEqual(expect.objectContaining({ currentPlayerId: PLAYER_A, round: 2, turnIndex: 2 }));
  });

  it('passes Scolia geometry through to the row', async () => {
    let inserted: MockRow | null = null;
    const supabase = createSupabaseMock({ game_throws: insertingThrowsTable((payload) => { inserted = payload; }) });

    await appendGameThrow(supabase as never, buildSnapshot([]), {
      segment: 'D16',
      scoliaEventId: 77,
      impactXmm: 1.5,
      impactYmm: -2,
      angleHorizontalDeg: 3,
      angleVerticalDeg: 4,
    });

    expect(inserted).toEqual(expect.objectContaining({
      scolia_event_id: 77,
      impact_x_mm: 1.5,
      impact_y_mm: -2,
      angle_horizontal_deg: 3,
      angle_vertical_deg: 4,
    }));
  });

  it('rejects an invalid segment with 400', async () => {
    const supabase = createSupabaseMock({});
    const result = await appendGameThrow(supabase as never, buildSnapshot([]), { segment: 'X5' });
    expect(result).toEqual({ ok: false, status: 400, error: 'Invalid segment', code: 'invalid_segment' });
    expect(supabase.ops).toHaveLength(0);
  });

  it('rejects a scored value that does not match the segment with 400', async () => {
    const supabase = createSupabaseMock({});
    const result = await appendGameThrow(supabase as never, buildSnapshot([]), { segment: 'T20', scored: 20 });
    expect(result).toEqual({ ok: false, status: 400, error: 'scored does not match segment', code: 'invalid_segment' });
    expect(supabase.ops).toHaveLength(0);
  });

  it('rejects a stale client throwing for the wrong player with 409 wrong_player', async () => {
    const supabase = createSupabaseMock({});
    const result = await appendGameThrow(supabase as never, buildSnapshot([]), { segment: 'S20', playerId: PLAYER_B });
    expect(result).toEqual(expect.objectContaining({ ok: false, status: 409, code: 'wrong_player' }));
    expect(supabase.ops).toHaveLength(0);
  });

  it('accepts a playerId that matches the current player', async () => {
    const supabase = createSupabaseMock({ game_throws: insertingThrowsTable() });
    const result = await appendGameThrow(supabase as never, buildSnapshot([]), { segment: 'S20', playerId: PLAYER_A });
    expect(result.ok).toBe(true);
  });

  it('rejects when the session is not active with 409 not_active', async () => {
    const supabase = createSupabaseMock({});
    const snapshot = buildSnapshot([], ORDER, cricketSession({ status: 'ended_early' }));
    const result = await appendGameThrow(supabase as never, snapshot, { segment: 'S20' });
    expect(result).toEqual({ ok: false, status: 409, error: 'Game is not active', code: 'not_active' });
  });

  it('rejects when the derived state is already finished with 409 finished', async () => {
    const supabase = createSupabaseMock({});
    const snapshot = buildSnapshot(scriptCricketRows(ORDER, CRICKET_WIN_SCRIPT));
    expect(snapshot.state.finished).toBe(true);
    const result = await appendGameThrow(supabase as never, snapshot, { segment: 'S20' });
    expect(result).toEqual({ ok: false, status: 409, error: 'Game is already finished', code: 'finished' });
  });

  it('maps a unique violation on insert to 409 slot_taken', async () => {
    const supabase = createSupabaseMock({
      game_throws: () => ({ data: null, error: { message: 'duplicate key', code: '23505' } }),
    });
    const result = await appendGameThrow(supabase as never, buildSnapshot([]), { segment: 'S20' });
    expect(result).toEqual(expect.objectContaining({ ok: false, status: 409, code: 'slot_taken' }));
  });

  it('throws on any other insert error', async () => {
    const supabase = createSupabaseMock({
      game_throws: () => ({ data: null, error: { message: 'connection lost', code: '08006' } }),
    });
    await expect(appendGameThrow(supabase as never, buildSnapshot([]), { segment: 'S20' })).rejects.toThrow('connection lost');
  });

  it('finalizes the session when the dart finishes the game', async () => {
    const rows = scriptCricketRows(ORDER, CRICKET_WIN_SCRIPT.slice(0, -1));
    const supabase = createSupabaseMock({
      game_throws: insertingThrowsTable(),
      game_sessions: () => ({ data: null, error: null, count: 1 }),
    });

    const result = await appendGameThrow(supabase as never, buildSnapshot(rows), { segment: 'SB' });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.state.finished).toBe(true);
    expect(result.state.winnerId).toBe(PLAYER_A);
    const updates = supabase.opsFor('game_sessions', 'update');
    expect(updates).toHaveLength(1);
    expect(updates[0]!.payload).toEqual(expect.objectContaining({ status: 'completed', winner_player_id: PLAYER_A }));
    expect((updates[0]!.payload as MockRow).completed_at).toEqual(expect.any(String));
    expect(updates[0]!.filters).toEqual([
      { kind: 'eq', column: 'id', value: SESSION_ID },
      { kind: 'eq', column: 'status', value: 'active' },
    ]);
  });
});

describe('removeLastGameThrow', () => {
  it('deletes the highest (turn_index, dart_index) slot and returns the recomputed state', async () => {
    const rows = scriptCricketRows(ORDER, [[PLAYER_A, 'T20'], [PLAYER_A, 'T19'], [PLAYER_A, 'T18'], [PLAYER_B, 'S5']]);
    const supabase = createSupabaseMock({ game_throws: rows.slice() });
    // Snapshot rows arrive out of order to prove sorting happens server-side.
    const snapshot = buildSnapshot(rows.slice().reverse());

    const result = await removeLastGameThrow(supabase as never, snapshot);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.deleted.id).toBe('throw-4');
    expect(result.reopened).toBe(false);
    expect(result.state).toEqual(expect.objectContaining({ currentPlayerId: PLAYER_B, turnIndex: 1, dartsThrownInTurn: 0 }));
    const deletes = supabase.opsFor('game_throws', 'delete');
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.options).toEqual({ count: 'exact' });
    expect(deletes[0]!.filters).toEqual([{ kind: 'eq', column: 'id', value: 'throw-4' }]);
    expect(supabase.opsFor('game_sessions')).toHaveLength(0);
  });

  it('returns 404 when there is nothing to undo', async () => {
    const supabase = createSupabaseMock({});
    const result = await removeLastGameThrow(supabase as never, buildSnapshot([]));
    expect(result).toEqual({ ok: false, status: 404, error: 'No darts to undo' });
  });

  it('returns 409 when the requested throwId is not the latest dart', async () => {
    const rows = scriptCricketRows(ORDER, [[PLAYER_A, 'T20'], [PLAYER_A, 'T19']]);
    const supabase = createSupabaseMock({});
    const result = await removeLastGameThrow(supabase as never, buildSnapshot(rows), 'throw-1');
    expect(result).toEqual({ ok: false, status: 409, error: 'Only the latest dart can be undone' });
    expect(supabase.ops).toHaveLength(0);
  });

  it('accepts the matching throwId', async () => {
    const rows = scriptCricketRows(ORDER, [[PLAYER_A, 'T20'], [PLAYER_A, 'T19']]);
    const supabase = createSupabaseMock({ game_throws: rows.slice() });
    const result = await removeLastGameThrow(supabase as never, buildSnapshot(rows), 'throw-2');
    expect(result.ok).toBe(true);
  });

  it('returns 404 when the dart was already removed concurrently', async () => {
    const rows = scriptCricketRows(ORDER, [[PLAYER_A, 'T20']]);
    const supabase = createSupabaseMock({ game_throws: () => ({ data: null, error: null, count: 0 }) });
    const result = await removeLastGameThrow(supabase as never, buildSnapshot(rows));
    expect(result).toEqual({ ok: false, status: 404, error: 'Dart was already removed' });
  });

  it('reopens a completed session when the deleted dart was the winner', async () => {
    const rows = scriptCricketRows(ORDER, CRICKET_WIN_SCRIPT);
    const session = cricketSession({ status: 'completed', winner_player_id: PLAYER_A, completed_at: '2026-09-01T11:00:00.000Z' });
    const supabase = createSupabaseMock({
      game_throws: rows.slice(),
      game_sessions: () => ({ data: null, error: null, count: 1 }),
    });

    const result = await removeLastGameThrow(supabase as never, buildSnapshot(rows, ORDER, session));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.reopened).toBe(true);
    expect(result.state.finished).toBe(false);
    expect(result.state.currentPlayerId).toBe(PLAYER_A);
    const updates = supabase.opsFor('game_sessions', 'update');
    expect(updates).toHaveLength(1);
    expect(updates[0]!.payload).toEqual({ status: 'active', winner_player_id: null, completed_at: null });
    expect(updates[0]!.options).toEqual({ count: 'exact' });
    expect(updates[0]!.filters).toEqual([
      { kind: 'eq', column: 'id', value: SESSION_ID },
      { kind: 'eq', column: 'status', value: 'completed' },
    ]);
  });

  it('reports reopened=false when someone else already reopened the session', async () => {
    const rows = scriptCricketRows(ORDER, CRICKET_WIN_SCRIPT);
    const session = cricketSession({ status: 'completed', winner_player_id: PLAYER_A });
    const supabase = createSupabaseMock({
      game_throws: rows.slice(),
      game_sessions: () => ({ data: null, error: null, count: 0 }),
    });
    const result = await removeLastGameThrow(supabase as never, buildSnapshot(rows, ORDER, session));
    expect(result.ok && result.reopened).toBe(false);
  });

  it('refuses to undo darts of a session that was ended early', async () => {
    const rows = scriptCricketRows(ORDER, [[PLAYER_A, 'T20']]);
    const supabase = createSupabaseMock({});
    const session = cricketSession({ status: 'ended_early', completed_at: '2026-09-01T11:00:00.000Z' });
    const result = await removeLastGameThrow(supabase as never, buildSnapshot(rows, ORDER, session));
    expect(result).toEqual({ ok: false, status: 409, error: 'Game was ended early' });
    expect(supabase.ops).toHaveLength(0);
  });
});
