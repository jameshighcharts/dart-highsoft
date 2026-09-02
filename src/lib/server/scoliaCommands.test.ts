import { describe, expect, it, vi } from 'vitest';

import { enqueueCurrentRoundScoliaThrowCommand } from './scoliaCommands';
import type { MatchRow } from './matchGuards';

const match = {
  id: 'match-1',
  winner_player_id: null,
  completed_at: null,
  ended_early: false,
  start_score: '501',
  finish: 'double_out',
  legs_to_win: 1,
  fair_ending: false,
  tournament_match_id: null,
  scolia_board_id: 'board-1',
} satisfies MatchRow;

function sourceEventQuery() {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { board_id: 'board-1', received_at: '2026-09-01T10:00:00.000Z' },
      error: null,
    }),
  };
}

function takeoutQuery(data: { id: number } | null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  };
}

describe('enqueueCurrentRoundScoliaThrowCommand', () => {
  it('queues a zero-based correction for a Scolia throw in the current round', async () => {
    const eventQueries = [sourceEventQuery(), takeoutQuery(null)];
    const insert = vi.fn().mockResolvedValue({ error: null });
    const supabase = {
      from: vi.fn((table: string) => table === 'scolia_events'
        ? eventQueries.shift()
        : { insert }),
    };

    await enqueueCurrentRoundScoliaThrowCommand(
      supabase as never,
      match,
      { dartIndex: 2, scoliaEventId: 42 },
      'THROW_CORRECTED'
    );

    expect(insert).toHaveBeenCalledWith({
      board_id: 'board-1',
      match_id: 'match-1',
      command_type: 'THROW_CORRECTED',
      payload: { throwIndex: 1 },
    });
  });

  it('does not notify Scolia after that physical round was taken out', async () => {
    const eventQueries = [sourceEventQuery(), takeoutQuery({ id: 99 })];
    const insert = vi.fn();
    const supabase = {
      from: vi.fn((table: string) => table === 'scolia_events'
        ? eventQueries.shift()
        : { insert }),
    };

    await enqueueCurrentRoundScoliaThrowCommand(
      supabase as never,
      match,
      { dartIndex: 3, scoliaEventId: 42 },
      'DELETE_THROW'
    );

    expect(insert).not.toHaveBeenCalled();
  });

  it('does nothing for manual matches and manual throws', async () => {
    const from = vi.fn();
    await enqueueCurrentRoundScoliaThrowCommand(
      { from } as never,
      { ...match, scolia_board_id: null },
      { dartIndex: 1, scoliaEventId: 42 },
      'DELETE_THROW'
    );
    await enqueueCurrentRoundScoliaThrowCommand(
      { from } as never,
      match,
      { dartIndex: 1, scoliaEventId: null },
      'DELETE_THROW'
    );
    expect(from).not.toHaveBeenCalled();
  });
});
