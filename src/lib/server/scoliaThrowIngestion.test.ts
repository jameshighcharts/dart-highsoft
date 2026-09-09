import { describe, expect, it, vi } from 'vitest';

vi.mock('./backgroundJobs.ts', () => ({
  enqueueDartIQLiveThrow: vi.fn().mockResolvedValue(undefined),
}));

import { ingestScoliaThrowEvent, type StoredScoliaEvent } from './scoliaThrowIngestion.ts';
import {
  createSupabaseMock,
  filterValue,
  rowsHandler,
  type MockOp,
  type MockRow,
  type RpcHandler,
  type TableHandler,
} from '@/test-utils/gameSupabaseMock';
import {
  BOARD_ID,
  CRICKET_WIN_SCRIPT,
  cricketSession,
  PLAYER_A,
  PLAYER_B,
  scriptCricketRows,
  SESSION_ID,
  sessionPlayerRows,
} from '@/test-utils/gameFixtures';

const ORDER = [PLAYER_A, PLAYER_B];
const EVENT_ID = 501;

function throwEvent(overrides: Partial<StoredScoliaEvent> = {}): StoredScoliaEvent {
  return {
    id: EVENT_ID,
    board_id: BOARD_ID,
    message_id: 'msg-501',
    event_type: 'THROW_DETECTED',
    payload: { sector: 'T20', bounceout: false, coordinates: [10.5, -20], angle: { horizontal: 5, vertical: -3 } },
    ...overrides,
  };
}

/** scolia_events: records status updates, answers the takeout lookups. */
function scoliaEventsTable(options: { takeoutAfter?: boolean } = {}): TableHandler {
  return (op: MockOp) => {
    if (op.type === 'update') return { data: null, error: null, count: 1 };
    if (op.filters.some((filter) => filter.column === 'event_type')) {
      return { data: options.takeoutAfter ? [{ id: 999 }] : [], error: null };
    }
    return { data: [{ board_id: BOARD_ID, received_at: '2026-09-01T10:05:00.000Z' }], error: null };
  };
}

function activeMatchRow(): MockRow {
  return {
    id: 'match-1',
    scolia_board_id: BOARD_ID,
    winner_player_id: null,
    completed_at: null,
    ended_early: false,
    start_score: '501',
    finish: 'double_out',
    legs_to_win: 1,
    fair_ending: false,
    tournament_match_id: null,
    created_at: '2026-09-01T09:00:00.000Z',
  };
}

function gameTables(rows: MockRow[], session = cricketSession({ scolia_board_id: BOARD_ID })) {
  return {
    throws: [] as MockRow[],
    matches: [] as MockRow[],
    game_sessions: [session as unknown as MockRow],
    game_session_players: sessionPlayerRows(ORDER),
    game_throws: rows,
    scolia_events: scoliaEventsTable(),
  };
}

function appendGameRpc(gameSessions: MockRow[]): RpcHandler {
  return (args) => {
    const row = {
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
    };
    if (args.p_finalize === true) {
      Object.assign(gameSessions[0]!, {
        status: 'completed',
        winner_player_id: args.p_winner_player_id,
        completed_at: '2026-09-02T12:00:00.000Z',
      });
    }
    return { data: [row], error: null };
  };
}

function finalizeGameRpc(gameSessions: MockRow[]): RpcHandler {
  return (args) => {
    Object.assign(gameSessions[0]!, {
      status: 'completed',
      winner_player_id: args.p_winner_player_id,
      completed_at: '2026-09-02T12:00:00.000Z',
    });
    return { data: [gameSessions[0]], error: null };
  };
}

function gameSupabase(
  rows: MockRow[],
  options: {
    session?: ReturnType<typeof cricketSession>;
    tables?: Record<string, MockRow[] | TableHandler>;
    rpcs?: Record<string, RpcHandler>;
  } = {}
) {
  const tables = { bull_off_events: [], ...gameTables(rows, options.session), ...options.tables };
  const gameSessions = tables.game_sessions as MockRow[];
  return createSupabaseMock({ bull_off_events: [], ...tables }, {
    append_game_throw_atomic: appendGameRpc(gameSessions),
    finalize_game_session_atomic: finalizeGameRpc(gameSessions),
    ...options.rpcs,
  });
}

function statusUpdate(supabase: ReturnType<typeof createSupabaseMock>) {
  const updates = supabase.opsFor('scolia_events', 'update');
  expect(updates).toHaveLength(1);
  expect(filterValue(updates[0]!, 'id')).toBe(EVENT_ID);
  return updates[0]!.payload as MockRow;
}

describe('ingestScoliaThrowEvent dispatch', () => {
  it('settles against fresh post-insert rows and retains idempotent retry after a concurrent correction', async () => {
    const match = activeMatchRow();
    const leg = { id: 'leg-1', match_id: match.id, leg_number: 1, starting_player_id: PLAYER_A, winner_player_id: null };
    const turns: MockRow[] = [{
      id: 'turn-1', leg_id: leg.id, player_id: PLAYER_A, turn_number: 1,
      total_scored: 0, busted: false, tiebreak_round: null,
    }];
    const darts: MockRow[] = [1, 2].map((index) => ({
      id: `dart-${index}`, turn_id: 'turn-1', dart_index: index, segment: 'S20', scored: 20, scolia_event_id: null,
    }));
    const supabase = createSupabaseMock({
      bull_off_events: [],
      matches: [match], game_sessions: [], game_throws: [], legs: [leg],
      turns: (op) => op.type === 'select'
        ? rowsHandler(turns.map((turn) => ({ ...turn, throws: darts.filter((dart) => dart.turn_id === turn.id) })))(op)
        : rowsHandler(turns)(op),
      throws: (op) => {
        const result = rowsHandler(darts)(op);
        if (op.type === 'insert') Object.assign(darts[0], { segment: 'S5', scored: 5 });
        return result;
      },
      scolia_events: scoliaEventsTable(),
    }, {
      load_scolia_match_snapshot: () => ({ data: structuredClone({
        match, leg, playerIds: ORDER,
        turns: turns.map((turn) => ({ ...turn, throws: darts.filter((dart) => dart.turn_id === turn.id) })),
      }), error: null }),
    });
    const result = await ingestScoliaThrowEvent(supabase as never, throwEvent());
    expect(result.status).toBe('processed');
    expect(turns[0].total_scored).toBe(85); // 5 + 20 + 60, not the pre-insert 20 + 20 + 60.
    expect(supabase.rpcFor('load_scolia_match_snapshot').map((op) => op.args.p_turn_id)).toEqual([null, 'turn-1']);
    expect(supabase.opsFor('throws', 'insert')).toHaveLength(1);
    await expect(ingestScoliaThrowEvent(supabase as never, throwEvent())).resolves.toEqual(result);
    expect(supabase.opsFor('throws', 'insert')).toHaveLength(1);
    expect(turns[0].total_scored).toBe(85);
  });

  it('ignores an event with an invalid payload', async () => {
    const supabase = createSupabaseMock({ scolia_events: scoliaEventsTable() });
    const result = await ingestScoliaThrowEvent(supabase as never, throwEvent({ payload: { sector: 'T20' } }));
    expect(result).toEqual({ status: 'ignored', reason: 'Invalid THROW_DETECTED payload' });
    expect(statusUpdate(supabase)).toEqual(expect.objectContaining({ processing_status: 'ignored', processing_error: 'Invalid THROW_DETECTED payload' }));
  });

  it('ignores the event when the board has no active match or game', async () => {
    const supabase = createSupabaseMock({
      bull_off_events: [],
      throws: [],
      game_throws: [],
      matches: [],
      game_sessions: [],
      scolia_events: scoliaEventsTable(),
    });

    const result = await ingestScoliaThrowEvent(supabase as never, throwEvent());

    expect(result).toEqual({ status: 'ignored', reason: 'No active match or game is assigned to this board' });
    expect(statusUpdate(supabase)).toEqual(expect.objectContaining({
      processing_status: 'ignored',
      processing_error: 'No active match or game is assigned to this board',
    }));
    expect(supabase.opsFor('game_throws', 'insert')).toHaveLength(0);
  });

  it('records the dart on the active game session with geometry and computed indices', async () => {
    const rows = scriptCricketRows(ORDER, [[PLAYER_A, 'T20'], [PLAYER_A, 'T19']]);
    const supabase = gameSupabase(rows);

    const result = await ingestScoliaThrowEvent(supabase as never, throwEvent());

    expect(result).toEqual({ status: 'processed', target: { kind: 'game', id: SESSION_ID }, throwId: expect.any(String) });
    expect(supabase.rpcFor('append_game_throw_atomic')[0]!.args).toEqual(expect.objectContaining({
      p_session_id: SESSION_ID,
      p_player_id: PLAYER_A,
      p_round_number: 1,
      p_turn_index: 0,
      p_dart_index: 3,
      p_segment: 'T20',
      p_scored: 60,
      p_meta: expect.objectContaining({ type: 'cricket_throw', playerId: PLAYER_A, target: 20 }),
      p_scolia_event_id: EVENT_ID,
      p_impact_x_mm: 10.5,
      p_impact_y_mm: -20,
      p_angle_horizontal_deg: 5,
      p_angle_vertical_deg: -3,
    }));
    expect(statusUpdate(supabase)).toEqual(expect.objectContaining({ processing_status: 'processed', processing_error: null }));
    expect(supabase.opsFor('legs')).toHaveLength(0);
  });

  it('translates Scolia sector vocabulary before storing', async () => {
    const supabase = gameSupabase([]);
    await ingestScoliaThrowEvent(supabase as never, throwEvent({ payload: { sector: 'Bull', bounceout: false } }));
    expect(supabase.rpcFor('append_game_throw_atomic')[0]!.args).toEqual(expect.objectContaining({
      p_segment: 'DB',
      p_scored: 50,
      p_impact_x_mm: null,
      p_angle_vertical_deg: null,
    }));
  });

  it('finalizes the game session when the Scolia dart wins the game', async () => {
    const rows = scriptCricketRows(ORDER, CRICKET_WIN_SCRIPT.slice(0, -1));
    const tables = gameTables(rows);
    const supabase = createSupabaseMock({ bull_off_events: [], ...tables }, {
      append_game_throw_atomic: appendGameRpc(tables.game_sessions),
    });

    const result = await ingestScoliaThrowEvent(supabase as never, throwEvent({ payload: { sector: '25', bounceout: false } }));

    expect(result.status).toBe('processed');
    expect(supabase.rpcFor('append_game_throw_atomic')[0]!.args).toEqual(expect.objectContaining({
      p_finalize: true,
      p_winner_player_id: PLAYER_A,
    }));
    expect(tables.game_sessions[0]!.status).toBe('completed');
  });

  it('replays an already stored game throw without inserting again', async () => {
    const rows = scriptCricketRows(ORDER, [[PLAYER_A, 'T20']]);
    rows[0]!.scolia_event_id = EVENT_ID;
    const supabase = gameSupabase(rows);

    const result = await ingestScoliaThrowEvent(supabase as never, throwEvent());

    expect(result).toEqual({ status: 'processed', target: { kind: 'game', id: SESSION_ID }, throwId: 'throw-1' });
    expect(supabase.opsFor('game_throws', 'insert')).toHaveLength(0);
    expect(supabase.opsFor('matches')).toHaveLength(0);
    expect(statusUpdate(supabase)).toEqual(expect.objectContaining({ processing_status: 'processed' }));
  });

  it('completes the session while replaying a stored winning dart that was never finalized', async () => {
    const rows = scriptCricketRows(ORDER, CRICKET_WIN_SCRIPT);
    rows[rows.length - 1]!.scolia_event_id = EVENT_ID;
    const supabase = gameSupabase(rows);

    await ingestScoliaThrowEvent(supabase as never, throwEvent());

    expect(supabase.rpcFor('finalize_game_session_atomic')).toHaveLength(1);
    expect(supabase.opsFor('game_throws', 'insert')).toHaveLength(0);
  });

  it('ignores darts for a game that is already finished', async () => {
    const rows = scriptCricketRows(ORDER, CRICKET_WIN_SCRIPT);
    const supabase = gameSupabase(rows);

    const result = await ingestScoliaThrowEvent(supabase as never, throwEvent());

    expect(result).toEqual({ status: 'ignored', reason: 'The assigned game is already finished' });
    expect(supabase.opsFor('game_throws', 'insert')).toHaveLength(0);
    expect(statusUpdate(supabase)).toEqual(expect.objectContaining({ processing_status: 'ignored' }));
  });

  it('drops a fourth dart detected before the previous round was taken out', async () => {
    const rows = scriptCricketRows(ORDER, [[PLAYER_A, 'T20'], [PLAYER_A, 'T19'], [PLAYER_A, 'T18']]);
    rows[2]!.scolia_event_id = 400;
    const supabase = gameSupabase(rows, { tables: { scolia_events: scoliaEventsTable({ takeoutAfter: false }) } });

    const result = await ingestScoliaThrowEvent(supabase as never, throwEvent());

    expect(result).toEqual({ status: 'ignored', reason: 'Dart detected before the previous round was taken out' });
    expect(supabase.opsFor('game_throws', 'insert')).toHaveLength(0);
    const takeoutLookup = supabase.opsFor('scolia_events', 'select').find((op) => filterValue(op, 'event_type') === 'TAKEOUT_FINISHED');
    expect(takeoutLookup).toBeDefined();
    expect(filterValue(takeoutLookup!, 'board_id')).toBe(BOARD_ID);
  });

  it('accepts the next player’s first dart once the round was taken out', async () => {
    const rows = scriptCricketRows(ORDER, [[PLAYER_A, 'T20'], [PLAYER_A, 'T19'], [PLAYER_A, 'T18']]);
    rows[2]!.scolia_event_id = 400;
    const supabase = gameSupabase(rows, { tables: { scolia_events: scoliaEventsTable({ takeoutAfter: true }) } });

    const result = await ingestScoliaThrowEvent(supabase as never, throwEvent());

    expect(result.status).toBe('processed');
    expect(supabase.rpcFor('append_game_throw_atomic')[0]!.args).toEqual(expect.objectContaining({
      p_player_id: PLAYER_B,
      p_turn_index: 1,
      p_dart_index: 1,
    }));
  });

  it('settles a slot race by reusing the dart that won the insert', async () => {
    const rows = scriptCricketRows(ORDER, [[PLAYER_A, 'T20']]);
    const racedRow = { ...rows[0]!, id: 'throw-raced', dart_index: 2, scolia_event_id: EVENT_ID };
    let lookups = 0;
    const gameThrows: TableHandler = (op) => {
      if (filterValue(op, 'scolia_event_id') === EVENT_ID) {
        // The first duplicate check (before dispatch) finds nothing; the retry after the race does.
        lookups += 1;
        return { data: lookups === 1 ? [] : [racedRow], error: null };
      }
      return { data: rows, error: null };
    };
    const supabase = gameSupabase(rows, {
      tables: { game_throws: gameThrows },
      rpcs: {
        append_game_throw_atomic: () => ({ data: null, error: { message: 'stale_game_snapshot', code: '40001' } }),
      },
    });

    const result = await ingestScoliaThrowEvent(supabase as never, throwEvent());

    expect(result).toEqual({ status: 'processed', target: { kind: 'game', id: SESSION_ID }, throwId: 'throw-raced' });
  });

  it('marks the event failed and rethrows when ingestion crashes', async () => {
    const supabase = createSupabaseMock({
      bull_off_events: [],
      throws: [],
      game_throws: [],
      matches: () => ({ data: null, error: { message: 'matches down' } }),
      game_sessions: [],
      scolia_events: scoliaEventsTable(),
    });

    await expect(ingestScoliaThrowEvent(supabase as never, throwEvent())).rejects.toThrow('matches down');
    expect(statusUpdate(supabase)).toEqual(expect.objectContaining({ processing_status: 'failed', processing_error: 'matches down', processed_at: null }));
  });

  it('routes a match target down the X01 path', async () => {
    const supabase = createSupabaseMock({
      bull_off_events: [],
      throws: [],
      game_throws: [],
      matches: [activeMatchRow()],
      game_sessions: [],
      legs: [],
      scolia_events: scoliaEventsTable(),
    }, { load_scolia_match_snapshot: () => ({ data: null, error: null }) });

    const result = await ingestScoliaThrowEvent(supabase as never, throwEvent());

    // No open leg in this fixture, so the X01 snapshot stops early.
    expect(result).toEqual({ status: 'ignored', reason: 'The assigned match has no active leg' });
    expect(supabase.rpcFor('load_scolia_match_snapshot')).toEqual([
      { name: 'load_scolia_match_snapshot', args: { p_match_id: 'match-1', p_leg_id: null, p_turn_id: null } },
    ]);
    expect(supabase.opsFor('game_throws', 'insert')).toHaveLength(0);
    expect(supabase.opsFor('game_session_players')).toHaveLength(0);
  });
});

it('records a bull-off measurement without creating a scoring turn and ignores a duplicate event', async () => {
  const { createBullOff } = await import('../match/bullOff');
  const match = { ...activeMatchRow(), bull_off: createBullOff(ORDER) };
  const events: MockRow[] = [];
  const supabase = createSupabaseMock({
    bull_off_events: events, throws: [], game_throws: [], matches: [match], game_sessions: [], scolia_events: scoliaEventsTable(),
  }, {
    load_scolia_match_snapshot: () => ({ data: { match, leg: { id: 'leg-1', starting_player_id: PLAYER_A }, playerIds: ORDER, turns: [] }, error: null }),
    update_bull_off_atomic: (args) => { match.bull_off = args.p_state as typeof match.bull_off; events.push({ event_id: EVENT_ID, match_id: match.id }); return { data: true, error: null }; },
  });
  await ingestScoliaThrowEvent(supabase as never, throwEvent());
  expect(match.bull_off.shots[0]).toMatchObject({ playerId: PLAYER_A, distanceMm: 22.6 });
  expect(match.bull_off.awaitingTakeout).toBe(true);
  await ingestScoliaThrowEvent(supabase as never, throwEvent());
  expect(match.bull_off.shots).toHaveLength(1);
  expect(supabase.opsFor('turns')).toHaveLength(0);
  expect(supabase.opsFor('throws', 'insert')).toHaveLength(0);
});
