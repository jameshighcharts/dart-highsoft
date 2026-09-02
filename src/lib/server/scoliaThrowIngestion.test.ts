import { describe, expect, it } from 'vitest';

import { ingestScoliaThrowEvent, type StoredScoliaEvent } from './scoliaThrowIngestion.ts';
import { createSupabaseMock, filterValue, type MockOp, type MockRow, type TableHandler } from '@/test-utils/gameSupabaseMock';
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

function statusUpdate(supabase: ReturnType<typeof createSupabaseMock>) {
  const updates = supabase.opsFor('scolia_events', 'update');
  expect(updates).toHaveLength(1);
  expect(filterValue(updates[0]!, 'id')).toBe(EVENT_ID);
  return updates[0]!.payload as MockRow;
}

describe('ingestScoliaThrowEvent dispatch', () => {
  it('ignores an event with an invalid payload', async () => {
    const supabase = createSupabaseMock({ scolia_events: scoliaEventsTable() });
    const result = await ingestScoliaThrowEvent(supabase as never, throwEvent({ payload: { sector: 'T20' } }));
    expect(result).toEqual({ status: 'ignored', reason: 'Invalid THROW_DETECTED payload' });
    expect(statusUpdate(supabase)).toEqual(expect.objectContaining({ processing_status: 'ignored', processing_error: 'Invalid THROW_DETECTED payload' }));
  });

  it('ignores the event when the board has no active match or game', async () => {
    const supabase = createSupabaseMock({
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
    const supabase = createSupabaseMock(gameTables(rows));

    const result = await ingestScoliaThrowEvent(supabase as never, throwEvent());

    expect(result).toEqual({ status: 'processed', target: { kind: 'game', id: SESSION_ID }, throwId: expect.any(String) });
    const inserts = supabase.opsFor('game_throws', 'insert');
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.payload).toEqual({
      session_id: SESSION_ID,
      player_id: PLAYER_A,
      round_number: 1,
      turn_index: 0,
      dart_index: 3,
      segment: 'T20',
      scored: 60,
      meta: expect.objectContaining({ type: 'cricket_throw', playerId: PLAYER_A, target: 20 }),
      scolia_event_id: EVENT_ID,
      impact_x_mm: 10.5,
      impact_y_mm: -20,
      angle_horizontal_deg: 5,
      angle_vertical_deg: -3,
    });
    expect(statusUpdate(supabase)).toEqual(expect.objectContaining({ processing_status: 'processed', processing_error: null }));
    expect(supabase.opsFor('legs')).toHaveLength(0);
  });

  it('translates Scolia sector vocabulary before storing', async () => {
    const supabase = createSupabaseMock(gameTables([]));
    await ingestScoliaThrowEvent(supabase as never, throwEvent({ payload: { sector: 'Bull', bounceout: false } }));
    expect(supabase.opsFor('game_throws', 'insert')[0]!.payload).toEqual(expect.objectContaining({
      segment: 'DB',
      scored: 50,
      impact_x_mm: null,
      angle_vertical_deg: null,
    }));
  });

  it('finalizes the game session when the Scolia dart wins the game', async () => {
    const rows = scriptCricketRows(ORDER, CRICKET_WIN_SCRIPT.slice(0, -1));
    const tables = gameTables(rows);
    const supabase = createSupabaseMock(tables);

    const result = await ingestScoliaThrowEvent(supabase as never, throwEvent({ payload: { sector: '25', bounceout: false } }));

    expect(result.status).toBe('processed');
    const updates = supabase.opsFor('game_sessions', 'update');
    expect(updates).toHaveLength(1);
    expect(updates[0]!.payload).toEqual(expect.objectContaining({ status: 'completed', winner_player_id: PLAYER_A }));
    expect(tables.game_sessions[0]!.status).toBe('completed');
  });

  it('replays an already stored game throw without inserting again', async () => {
    const rows = scriptCricketRows(ORDER, [[PLAYER_A, 'T20']]);
    rows[0]!.scolia_event_id = EVENT_ID;
    const supabase = createSupabaseMock(gameTables(rows));

    const result = await ingestScoliaThrowEvent(supabase as never, throwEvent());

    expect(result).toEqual({ status: 'processed', target: { kind: 'game', id: SESSION_ID }, throwId: 'throw-1' });
    expect(supabase.opsFor('game_throws', 'insert')).toHaveLength(0);
    expect(supabase.opsFor('matches')).toHaveLength(0);
    expect(statusUpdate(supabase)).toEqual(expect.objectContaining({ processing_status: 'processed' }));
  });

  it('completes the session while replaying a stored winning dart that was never finalized', async () => {
    const rows = scriptCricketRows(ORDER, CRICKET_WIN_SCRIPT);
    rows[rows.length - 1]!.scolia_event_id = EVENT_ID;
    const supabase = createSupabaseMock(gameTables(rows));

    await ingestScoliaThrowEvent(supabase as never, throwEvent());

    expect(supabase.opsFor('game_sessions', 'update')).toHaveLength(1);
    expect(supabase.opsFor('game_throws', 'insert')).toHaveLength(0);
  });

  it('ignores darts for a game that is already finished', async () => {
    const rows = scriptCricketRows(ORDER, CRICKET_WIN_SCRIPT);
    const supabase = createSupabaseMock(gameTables(rows));

    const result = await ingestScoliaThrowEvent(supabase as never, throwEvent());

    expect(result).toEqual({ status: 'ignored', reason: 'The assigned game is already finished' });
    expect(supabase.opsFor('game_throws', 'insert')).toHaveLength(0);
    expect(statusUpdate(supabase)).toEqual(expect.objectContaining({ processing_status: 'ignored' }));
  });

  it('drops a fourth dart detected before the previous round was taken out', async () => {
    const rows = scriptCricketRows(ORDER, [[PLAYER_A, 'T20'], [PLAYER_A, 'T19'], [PLAYER_A, 'T18']]);
    rows[2]!.scolia_event_id = 400;
    const supabase = createSupabaseMock({ ...gameTables(rows), scolia_events: scoliaEventsTable({ takeoutAfter: false }) });

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
    const supabase = createSupabaseMock({ ...gameTables(rows), scolia_events: scoliaEventsTable({ takeoutAfter: true }) });

    const result = await ingestScoliaThrowEvent(supabase as never, throwEvent());

    expect(result.status).toBe('processed');
    expect(supabase.opsFor('game_throws', 'insert')[0]!.payload).toEqual(expect.objectContaining({
      player_id: PLAYER_B,
      turn_index: 1,
      dart_index: 1,
    }));
  });

  it('settles a slot race by reusing the dart that won the insert', async () => {
    const rows = scriptCricketRows(ORDER, [[PLAYER_A, 'T20']]);
    const racedRow = { ...rows[0]!, id: 'throw-raced', dart_index: 2, scolia_event_id: EVENT_ID };
    let lookups = 0;
    const gameThrows: TableHandler = (op) => {
      if (op.type === 'insert') return { data: null, error: { message: 'duplicate key', code: '23505' } };
      if (filterValue(op, 'scolia_event_id') === EVENT_ID) {
        // The first duplicate check (before dispatch) finds nothing; the retry after the race does.
        lookups += 1;
        return { data: lookups === 1 ? [] : [racedRow], error: null };
      }
      return { data: rows, error: null };
    };
    const supabase = createSupabaseMock({ ...gameTables(rows), game_throws: gameThrows });

    const result = await ingestScoliaThrowEvent(supabase as never, throwEvent());

    expect(result).toEqual({ status: 'processed', target: { kind: 'game', id: SESSION_ID }, throwId: 'throw-raced' });
  });

  it('marks the event failed and rethrows when ingestion crashes', async () => {
    const supabase = createSupabaseMock({
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
      throws: [],
      game_throws: [],
      matches: [activeMatchRow()],
      game_sessions: [],
      legs: [],
      scolia_events: scoliaEventsTable(),
    });

    const result = await ingestScoliaThrowEvent(supabase as never, throwEvent());

    // No open leg in this fixture, so the X01 path stops early. That is enough
    // to prove the dispatch: the legs table is only consulted for matches.
    expect(result).toEqual({ status: 'ignored', reason: 'The assigned match has no active leg' });
    const legQueries = supabase.opsFor('legs', 'select');
    expect(legQueries).toHaveLength(1);
    expect(filterValue(legQueries[0]!, 'match_id')).toBe('match-1');
    expect(supabase.opsFor('game_throws', 'insert')).toHaveLength(0);
    expect(supabase.opsFor('game_session_players')).toHaveLength(0);
  });
});
