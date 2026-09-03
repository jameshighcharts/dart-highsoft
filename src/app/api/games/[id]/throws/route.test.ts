import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DELETE, POST } from './route';
import {
  createSupabaseMock,
  type MockOp,
  type MockRow,
  type RpcHandler,
  type TableHandler,
} from '@/test-utils/gameSupabaseMock';
import {
  BOARD_ID,
  cricketSession,
  PLAYER_A,
  PLAYER_B,
  scriptCricketRows,
  SESSION_ID,
  sessionPlayerRows,
} from '@/test-utils/gameFixtures';

vi.mock('server-only', () => ({}));

const getSupabaseServerClientMock = vi.fn();

vi.mock('@/lib/supabaseServer', () => ({
  getSupabaseServerClient: () => getSupabaseServerClientMock(),
}));

const ORDER = [PLAYER_A, PLAYER_B];
const params = Promise.resolve({ id: SESSION_ID });

function post(body: unknown) {
  return POST(
    new Request(`http://localhost/api/games/${SESSION_ID}/throws`, {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
    { params }
  );
}

function del(body?: unknown) {
  return DELETE(
    new Request(`http://localhost/api/games/${SESSION_ID}/throws`, {
      method: 'DELETE',
      ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
    }),
    { params }
  );
}

function tables(rows: MockRow[], session = cricketSession(), extra: Record<string, MockRow[] | TableHandler> = {}) {
  return {
    game_sessions: [session as unknown as MockRow],
    game_session_players: sessionPlayerRows(ORDER),
    game_throws: rows,
    ...extra,
  };
}

/** scolia_events: source event exists; no takeout followed unless asked. */
function scoliaEvents(takeoutAfter: boolean): TableHandler {
  return (op: MockOp) => {
    if (op.filters.some((filter) => filter.column === 'event_type')) {
      return { data: takeoutAfter ? [{ id: 999 }] : [], error: null };
    }
    return { data: [{ board_id: BOARD_ID, received_at: '2026-09-01T10:05:00.000Z' }], error: null };
  };
}

const appendRpc: RpcHandler = (args) => ({
  data: [{
    id: 'throw-new',
    session_id: args.p_session_id,
    player_id: args.p_player_id,
    round_number: args.p_round_number,
    turn_index: args.p_turn_index,
    dart_index: args.p_dart_index,
    segment: args.p_segment,
    scored: args.p_scored,
    meta: args.p_meta,
    scolia_event_id: args.p_scolia_event_id,
    impact_x_mm: args.p_impact_x_mm,
    impact_y_mm: args.p_impact_y_mm,
    angle_horizontal_deg: args.p_angle_horizontal_deg,
    angle_vertical_deg: args.p_angle_vertical_deg,
    created_at: '2026-09-02T12:00:00.000Z',
  }],
  error: null,
});

function undoRpc(row: MockRow): RpcHandler {
  return () => ({ data: [{ ...row, reopened: false }], error: null });
}

describe('POST /api/games/[id]/throws', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('rejects invalid JSON and malformed fields with 400', async () => {
    getSupabaseServerClientMock.mockReturnValue(createSupabaseMock({}));
    expect((await post('{')).status).toBe(400);
    await expect((await post({ scored: 20 })).json()).resolves.toEqual({ error: 'segment is required' });
    await expect((await post({ segment: 'S20', scored: '20' })).json()).resolves.toEqual({ error: 'scored must be a number' });
    await expect((await post({ segment: 'S20', playerId: 7 })).json()).resolves.toEqual({ error: 'playerId must be a string' });
  });

  it('returns 404 for a missing game', async () => {
    getSupabaseServerClientMock.mockReturnValue(createSupabaseMock(tables([], cricketSession({ id: 'other' }))));
    const response = await post({ segment: 'S20' });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Game not found' });
  });

  it('returns 409 when a Scolia board drives the game', async () => {
    const supabase = createSupabaseMock(tables([], cricketSession({ scolia_board_id: BOARD_ID })));
    getSupabaseServerClientMock.mockReturnValue(supabase);

    const response = await post({ segment: 'S20' });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Manual scoring is disabled while a Scolia board is assigned to this game',
    });
    expect(supabase.opsFor('game_throws', 'insert')).toHaveLength(0);
  });

  it('returns 400 for an invalid segment', async () => {
    getSupabaseServerClientMock.mockReturnValue(createSupabaseMock(tables([])));
    const response = await post({ segment: 'T25' });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid segment', code: 'invalid_segment' });
  });

  it('returns 409 wrong_player for a stale client', async () => {
    getSupabaseServerClientMock.mockReturnValue(createSupabaseMock(tables([])));
    const response = await post({ segment: 'T20', playerId: PLAYER_B });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "It is not this player's turn", code: 'wrong_player' });
  });

  it('records the dart and returns the throw plus the new state with 201', async () => {
    const rows = scriptCricketRows(ORDER, [[PLAYER_A, 'T20']]);
    const supabase = createSupabaseMock(tables(rows), { append_game_throw_atomic: appendRpc });
    getSupabaseServerClientMock.mockReturnValue(supabase);

    const response = await post({ segment: 'T19', scored: 57, playerId: PLAYER_A });
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(json.throw).toEqual(expect.objectContaining({
      session_id: SESSION_ID,
      player_id: PLAYER_A,
      round_number: 1,
      turn_index: 0,
      dart_index: 2,
      segment: 'T19',
      scored: 57,
      scolia_event_id: null,
    }));
    expect(json.state).toEqual(expect.objectContaining({
      currentPlayerId: PLAYER_A,
      dartsThrownInTurn: 2,
      turnSegments: ['T20', 'T19'],
      finished: false,
    }));
  });
});

describe('DELETE /api/games/[id]/throws', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('returns 404 for a missing game', async () => {
    getSupabaseServerClientMock.mockReturnValue(createSupabaseMock(tables([], cricketSession({ id: 'other' }))));
    const response = await del();
    expect(response.status).toBe(404);
  });

  it('returns 404 when there are no darts to undo', async () => {
    getSupabaseServerClientMock.mockReturnValue(createSupabaseMock(tables([])));
    const response = await del();
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'No darts to undo' });
  });

  it('returns 409 when throwId is not the latest dart', async () => {
    const rows = scriptCricketRows(ORDER, [[PLAYER_A, 'T20'], [PLAYER_A, 'T19']]);
    getSupabaseServerClientMock.mockReturnValue(createSupabaseMock(tables(rows)));
    const response = await del({ throwId: 'throw-1' });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'Only the latest dart can be undone' });
  });

  it('deletes the latest dart of a manual game without touching Scolia commands', async () => {
    const rows = scriptCricketRows(ORDER, [[PLAYER_A, 'T20'], [PLAYER_A, 'T19']]);
    const supabase = createSupabaseMock(tables(rows), { undo_last_game_throw_atomic: undoRpc(rows[1]!) });
    getSupabaseServerClientMock.mockReturnValue(supabase);

    const response = await del();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.deletedThrow).toEqual(expect.objectContaining({ id: 'throw-2', dart_index: 2 }));
    expect(json.reopened).toBe(false);
    expect(json.state).toEqual(expect.objectContaining({ dartsThrownInTurn: 1, turnSegments: ['T20'] }));
    expect(supabase.rpcFor('undo_last_game_throw_atomic')[0]!.args).toEqual({
      p_session_id: SESSION_ID,
      p_expected_last_throw_id: 'throw-2',
      p_reopen: false,
    });
    expect(supabase.ops.some((op) => op.table === 'scolia_commands' || op.table === 'scolia_events')).toBe(false);
  });

  it('enqueues DELETE_THROW for a Scolia dart still in the current physical round', async () => {
    const rows = scriptCricketRows(ORDER, [[PLAYER_A, 'T20'], [PLAYER_A, 'T19']]);
    rows[1]!.scolia_event_id = 501;
    const supabase = createSupabaseMock(
      tables(rows, cricketSession({ scolia_board_id: BOARD_ID }), {
        scolia_events: scoliaEvents(false),
        scolia_commands: [],
      }),
      { undo_last_game_throw_atomic: undoRpc(rows[1]!) }
    );
    getSupabaseServerClientMock.mockReturnValue(supabase);

    const response = await del({ throwId: 'throw-2' });

    expect(response.status).toBe(200);
    const inserts = supabase.opsFor('scolia_commands', 'insert');
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.payload).toEqual({
      board_id: BOARD_ID,
      match_id: null,
      game_session_id: SESSION_ID,
      command_type: 'DELETE_THROW',
      payload: { throwIndex: 1 },
    });
  });

  it('does not enqueue a command once the round was taken out', async () => {
    const rows = scriptCricketRows(ORDER, [[PLAYER_A, 'T20'], [PLAYER_A, 'T19'], [PLAYER_A, 'T18']]);
    rows[2]!.scolia_event_id = 501;
    const supabase = createSupabaseMock(
      tables(rows, cricketSession({ scolia_board_id: BOARD_ID }), {
        scolia_events: scoliaEvents(true),
        scolia_commands: [],
      }),
      { undo_last_game_throw_atomic: undoRpc(rows[2]!) }
    );
    getSupabaseServerClientMock.mockReturnValue(supabase);

    const response = await del();

    expect(response.status).toBe(200);
    expect(supabase.opsFor('scolia_commands', 'insert')).toHaveLength(0);
  });

  it('still succeeds when queueing the Scolia command fails', async () => {
    const rows = scriptCricketRows(ORDER, [[PLAYER_A, 'T20']]);
    rows[0]!.scolia_event_id = 501;
    const supabase = createSupabaseMock(
      tables(rows, cricketSession({ scolia_board_id: BOARD_ID }), {
        scolia_events: scoliaEvents(false),
        scolia_commands: () => ({ data: null, error: { message: 'commands down' } }),
      }),
      { undo_last_game_throw_atomic: undoRpc(rows[0]!) }
    );
    getSupabaseServerClientMock.mockReturnValue(supabase);

    const response = await del();

    expect(response.status).toBe(200);
    expect(console.error).toHaveBeenCalledWith('Failed to queue Scolia throw deletion:', expect.any(Error));
  });
});
