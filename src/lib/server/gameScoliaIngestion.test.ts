import { describe, expect, it } from 'vitest';

import { ingestGameThrow, ingestPreparedGameThrow, type PreparedScoliaGame } from './gameScoliaIngestion.ts';
import { createSupabaseMock, type MockRow } from '@/test-utils/gameSupabaseMock';

const SESSION_ID = '00000000-0000-4000-8000-0000000000e1';
const BOARD_ID = '00000000-0000-4000-8000-0000000000b0';
const PLAYER_A = '00000000-0000-4000-8000-00000000000a';
const PLAYER_B = '00000000-0000-4000-8000-00000000000b';
const PLAYER_C = '00000000-0000-4000-8000-00000000000c';

function throwRow(id: string, dartIndex: number): MockRow {
  return {
    id,
    session_id: SESSION_ID,
    player_id: PLAYER_A,
    round_number: 1,
    turn_index: 0,
    dart_index: dartIndex,
    segment: 'S1',
    scored: 1,
    meta: {},
    scolia_event_id: 10 + dartIndex,
    impact_x_mm: null,
    impact_y_mm: null,
    angle_horizontal_deg: null,
    angle_vertical_deg: null,
    created_at: `2026-09-02T10:00:0${dartIndex}.000Z`,
  };
}

function setup(takeoutEventId: number | null) {
  const gameThrows = [throwRow('throw-1', 1), throwRow('throw-2', 2)];
  const players = [PLAYER_A, PLAYER_B, PLAYER_C].map((player_id, play_order) => ({
    session_id: SESSION_ID,
    player_id,
    play_order,
    players: { display_name: `Player ${play_order + 1}` },
  }));
  const scoliaEvents: MockRow[] = [
    { id: 12, board_id: BOARD_ID, event_type: 'THROW_DETECTED' },
  ];
  if (takeoutEventId !== null) {
    scoliaEvents.push({ id: takeoutEventId, board_id: BOARD_ID, event_type: 'TAKEOUT_FINISHED' });
  }
  const supabase = createSupabaseMock({
    game_sessions: [{
      id: SESSION_ID,
      mode: 'killer',
      config: {
        lives: 1,
        killerRequirement: 'any',
        hitToKill: 'any',
        selfHitPenalty: true,
        assignment: 'choose',
        assignedNumbers: { [PLAYER_A]: 1, [PLAYER_B]: 2, [PLAYER_C]: 3 },
      },
      status: 'active',
      winner_player_id: null,
      scolia_board_id: BOARD_ID,
      created_at: '2026-09-02T10:00:00.000Z',
      completed_at: null,
    }],
    game_session_players: players,
    game_throws: gameThrows,
    scolia_events: scoliaEvents,
  }, {
    append_game_throw_atomic: (args) => ({
      data: [{
        id: 'throw-3',
        session_id: args.p_session_id,
        player_id: args.p_player_id,
        round_number: args.p_round_number,
        turn_index: args.p_turn_index,
        dart_index: args.p_dart_index,
        segment: args.p_segment,
        scored: args.p_scored,
        meta: args.p_meta,
        scolia_event_id: args.p_scolia_event_id,
        impact_x_mm: null,
        impact_y_mm: null,
        angle_horizontal_deg: null,
        angle_vertical_deg: null,
        created_at: '2026-09-02T10:00:03.000Z',
      }],
      error: null,
    }),
  });
  return supabase;
}

describe('ingestGameThrow takeout boundaries', () => {
  it('drops a dart after Killer ends a turn on dart two and before takeout', async () => {
    const supabase = setup(null);

    const result = await ingestGameThrow(supabase as never, SESSION_ID, 99, BOARD_ID, {
      segment: 'T20',
      scored: 60,
    });

    expect(result).toEqual({ status: 'ignored', reason: 'Dart detected before the previous round was taken out' });
    expect(supabase.rpcFor('append_game_throw_atomic')).toHaveLength(0);
  });

  it('records the next player after takeout completes', async () => {
    const supabase = setup(13);

    const result = await ingestGameThrow(supabase as never, SESSION_ID, 99, BOARD_ID, {
      segment: 'T20',
      scored: 60,
    });

    expect(result).toEqual({ status: 'processed', throwId: 'throw-3' });
    expect(supabase.rpcFor('append_game_throw_atomic')[0]!.args).toEqual(expect.objectContaining({
      p_player_id: PLAYER_B,
      p_turn_index: 1,
      p_dart_index: 1,
      p_scolia_event_id: 99,
    }));
  });

  it('does not admit a retried dart when takeout happened after that incoming event', async () => {
    const supabase = setup(100);

    const result = await ingestGameThrow(supabase as never, SESSION_ID, 99, BOARD_ID, {
      segment: 'T20',
      scored: 60,
    });

    expect(result).toEqual({ status: 'ignored', reason: 'Dart detected before the previous round was taken out' });
    expect(supabase.rpcFor('append_game_throw_atomic')).toHaveLength(0);
    expect(supabase.opsFor('scolia_events')[1]!.filters).toEqual(expect.arrayContaining([
      { kind: 'gt', column: 'id', value: 12 },
      { kind: 'lt', column: 'id', value: 99 },
    ]));
  });
});

describe('ingestPreparedGameThrow', () => {
  function prepared(takeoutSinceLastThrow: boolean | null): PreparedScoliaGame {
    return {
      kind: 'game',
      sessionId: SESSION_ID,
      snapshot: {
        session: {
          id: SESSION_ID,
          mode: 'killer',
          config: {
            lives: 1, killerRequirement: 'any', hitToKill: 'any', selfHitPenalty: true, assignment: 'choose',
            assignedNumbers: { [PLAYER_A]: 1, [PLAYER_B]: 2, [PLAYER_C]: 3 },
          },
          status: 'active',
          winner_player_id: null,
          scolia_board_id: BOARD_ID,
          created_at: '2026-09-02T10:00:00.000Z',
          completed_at: null,
        } as never,
        players: [PLAYER_A, PLAYER_B, PLAYER_C].map((player_id, play_order) => ({
          player_id, play_order, display_name: `Player ${play_order + 1}`,
        })),
        throws: [throwRow('throw-1', 1), throwRow('throw-2', 2)] as never,
      },
      takeoutSinceLastThrow,
    };
  }

  function client(rpc: (args: Record<string, unknown>) => { data: unknown; error: { message: string; code?: string } | null }) {
    // The fast path must not read any table: everything arrived with the persisted event.
    return createSupabaseMock({}, { append_scolia_game_throw_atomic: rpc });
  }

  it('appends and settles the event in one call without reading tables', async () => {
    const supabase = client((args) => ({ data: [{ ...throwRow('throw-3', 1), id: 'throw-3', player_id: args.p_player_id }], error: null }));
    const result = await ingestPreparedGameThrow(supabase as never, 99, prepared(true), { segment: 'T20', scored: 60 });
    expect(result).toEqual({ status: 'processed', throwId: 'throw-3' });
    expect(supabase.rpcFor('append_scolia_game_throw_atomic')[0]!.args).toEqual(expect.objectContaining({
      p_event_id: 99, p_player_id: PLAYER_B, p_turn_index: 1, p_dart_index: 1,
    }));
    expect(supabase.ops).toHaveLength(0);
  });

  it('keeps the takeout-before-next-round rule', async () => {
    const supabase = client(() => { throw new Error('must not append'); });
    const result = await ingestPreparedGameThrow(supabase as never, 99, prepared(false), { segment: 'T20', scored: 60 });
    expect(result).toEqual({ status: 'ignored', reason: 'Dart detected before the previous round was taken out' });
  });

  it('admits the dart when the previous dart has no Scolia event to compare with', async () => {
    const supabase = client(() => ({ data: [{ ...throwRow('throw-3', 1), id: 'throw-3' }], error: null }));
    const result = await ingestPreparedGameThrow(supabase as never, 99, prepared(null), { segment: 'T20', scored: 60 });
    expect(result).toEqual({ status: 'processed', throwId: 'throw-3' });
  });

  it('hands a taken slot back to the re-reading path', async () => {
    const supabase = client(() => ({ data: null, error: { message: 'stale_game_snapshot', code: '40001' } }));
    expect(await ingestPreparedGameThrow(supabase as never, 99, prepared(true), { segment: 'T20', scored: 60 })).toBeNull();
  });

  it('ignores a dart for a game that is no longer active', async () => {
    const game = prepared(true);
    game.snapshot.session = null;
    const supabase = client(() => { throw new Error('must not append'); });
    expect(await ingestPreparedGameThrow(supabase as never, 99, game, { segment: 'T20', scored: 60 }))
      .toEqual({ status: 'ignored', reason: 'The assigned game is no longer active' });
  });
});
