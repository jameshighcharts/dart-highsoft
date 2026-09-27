// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BoardConnection, recoveryAbandonReason } from './scoliaWorker';
import { ingestScoliaThrowEvent } from '../lib/server/scoliaThrowIngestion';
import { findActiveScoliaBoardOccupant } from '../lib/server/scoliaBoardTarget';
import { updateBullOff } from '../lib/server/bullOff';
import { loadMatch } from '../lib/server/matchGuards';
import type { ScoliaRealtimeCommentaryPublisher } from '../services/scoliaRealtimeCommentaryPublisher';
import type { ScoliaMessage } from '../lib/scolia/protocol';

vi.mock('../lib/server/scoliaThrowIngestion', () => ({ ingestScoliaThrowEvent: vi.fn() }));
vi.mock('../lib/server/scoliaBoardTarget', () => ({ findActiveScoliaBoardTarget: vi.fn(), findActiveScoliaBoardOccupant: vi.fn() }));
vi.mock('../lib/server/bullOff', () => ({ updateBullOff: vi.fn() }));
vi.mock('../lib/server/matchGuards', () => ({ loadMatch: vi.fn() }));

class FakeSocket extends EventTarget {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  static instances: FakeSocket[] = [];
  readyState = FakeSocket.OPEN;
  sent: { type: string }[] = [];
  close = vi.fn(() => { this.readyState = FakeSocket.CLOSED; });
  constructor(readonly url: URL) { super(); FakeSocket.instances.push(this); }
  send(data: string) { this.sent.push(JSON.parse(data)); }
}

type Internals = {
  socket: FakeSocket | null;
  lastMessageAt: number;
  connect: () => Promise<void>;
  checkLiveness: (now?: number) => void;
  enqueue: (work: () => Promise<void>) => void;
  persistMessage: (message: ScoliaMessage) => Promise<void>;
  processPendingThrows: () => Promise<void>;
  updateBoard: (values: Record<string, unknown>) => Promise<void>;
  writeBoard: () => Promise<void>;
};

const connections: BoardConnection[] = [];
beforeEach(() => {
  FakeSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  for (const connection of connections.splice(0)) await connection.stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function connect(supabase: Partial<SupabaseClient> = {}) {
  const connection = new BoardConnection({ id: 'board', name: 'Board', serialNumber: 'serial', isHomeSbc: false },
    'token', supabase as SupabaseClient, {} as ScoliaRealtimeCommentaryPublisher);
  connections.push(connection);
  const internals = connection as unknown as Internals;
  vi.spyOn(internals, 'writeBoard').mockResolvedValue();
  vi.spyOn(internals, 'updateBoard');
  return internals;
}

describe('dead connection detection', () => {
  it('probes a quiet socket, then abandons it and reconnects exactly once', async () => {
    vi.useFakeTimers();
    const board = connect();
    await board.connect();
    const first = FakeSocket.instances[0];
    board.lastMessageAt = Date.now() - 31_000;

    board.checkLiveness();
    expect(first.sent).toEqual([{ type: 'GET_SBC_STATUS', id: expect.any(String) }]);
    board.checkLiveness(Date.now() + 19_000);
    expect(first.close).not.toHaveBeenCalled();

    board.checkLiveness(Date.now() + 20_000);
    expect(first.close).toHaveBeenCalledWith(4000, 'Liveness timeout');
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeSocket.instances).toHaveLength(2);

    // The abandoned socket's late close event must not open a competing connection.
    first.dispatchEvent(new Event('close'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it('leaves a chatty socket alone', async () => {
    const board = connect();
    await board.connect();
    board.lastMessageAt = Date.now();
    board.checkLiveness();
    expect(FakeSocket.instances[0].sent).toEqual([]);
  });
});

describe('ordered queue', () => {
  it('moves past an event that keeps failing instead of blocking every later dart', async () => {
    vi.useFakeTimers();
    const board = connect();
    const later = vi.fn(async () => {});
    board.enqueue(async () => { throw new Error('poison'); });
    board.enqueue(later);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(later).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(later).toHaveBeenCalledOnce();
  });
});

describe('RESET_PHASE acknowledgement', () => {
  function acknowledgedReset(matchId: string | null) {
    const query = {
      update: () => query, eq: () => query, select: () => query,
      maybeSingle: async () => ({ data: { command_type: 'RESET_PHASE', match_id: matchId }, error: null }),
      upsert: () => query,
    };
    const upserted = { id: 7, board_id: 'board', message_id: 'ack', event_type: 'ACKNOWLEDGED', payload: {}, processing_status: 'pending' };
    return { from: vi.fn((table: string) => table === 'scolia_events'
      ? { upsert: () => ({ select: () => ({ maybeSingle: async () => ({ data: upserted, error: null }) }) }),
          update: () => ({ eq: async () => ({ error: null }) }) }
      : query) } as unknown as SupabaseClient;
  }
  const ack: ScoliaMessage = { type: 'ACKNOWLEDGED', id: 'ack', payload: { replyTo: 'command' } };

  it('marks the board as throwing again and refreshes its status', async () => {
    const board = connect(acknowledgedReset(null));
    await board.connect();
    await board.persistMessage(ack);
    expect(board.updateBoard).toHaveBeenCalledWith({ board_phase: 'Throw' });
    expect(FakeSocket.instances[0].sent.at(-1)).toMatchObject({ type: 'GET_SBC_STATUS' });
  });

  it('counts the reset as the removal a waiting bull-off needs', async () => {
    const bullOff = { phase: 'throwing', awaitingTakeout: true };
    vi.mocked(loadMatch).mockResolvedValue({ bull_off: bullOff } as never);
    const board = connect(acknowledgedReset('match'));
    await board.connect();
    await board.persistMessage(ack);
    expect(updateBullOff).toHaveBeenCalledWith(expect.anything(), 'match', bullOff, 'takeout');
  });
});

describe('recovering stored darts', () => {
  const secondsAgo = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();
  function pending(events: object[]) {
    const marked: unknown[] = [];
    const supabase = { from: vi.fn(() => {
      const query = {
        select: () => query, eq: () => query, in: () => query,
        order: async () => ({ data: events, error: null }),
        update: (values: unknown) => { marked.push(values); return { eq: async () => ({ error: null }) }; },
      };
      return query;
    }) } as unknown as SupabaseClient;
    return { supabase, marked };
  }

  it('never scores a dart into a match that started after it was thrown', async () => {
    const { supabase, marked } = pending([{ id: 1, board_id: 'board', message_id: 'old', event_type: 'THROW_DETECTED', payload: {}, received_at: secondsAgo(60) }]);
    vi.mocked(findActiveScoliaBoardOccupant).mockResolvedValue({ kind: 'match', id: 'new-match', createdAt: secondsAgo(10) });
    const board = connect(supabase);
    await board.processPendingThrows();
    expect(ingestScoliaThrowEvent).not.toHaveBeenCalled();
    expect(marked).toEqual([expect.objectContaining({ processing_status: 'ignored', processing_error: 'Thrown before the current match or game started' })]);
  });

  it('keeps recovering later darts when one keeps failing', async () => {
    const events = [1, 2].map((id) => ({ id, board_id: 'board', message_id: `m${id}`, event_type: 'THROW_DETECTED', payload: {}, received_at: secondsAgo(5) }));
    const { supabase } = pending(events);
    vi.mocked(findActiveScoliaBoardOccupant).mockResolvedValue({ kind: 'match', id: 'match', createdAt: secondsAgo(600) });
    vi.mocked(ingestScoliaThrowEvent).mockReset()
      .mockRejectedValueOnce(new Error('stubborn'))
      .mockResolvedValueOnce({ status: 'ignored', reason: 'fine' });
    const board = connect(supabase);
    await board.processPendingThrows();
    expect(ingestScoliaThrowEvent).toHaveBeenCalledTimes(2);
  });
});

describe('recoveryAbandonReason', () => {
  const now = Date.parse('2026-09-27T12:00:00Z');
  it('keeps fresh darts thrown during the current match', () => {
    expect(recoveryAbandonReason('2026-09-27T11:59:00Z', '2026-09-27T11:00:00Z', now)).toBeNull();
  });
  it('drops darts thrown before the match began', () => {
    expect(recoveryAbandonReason('2026-09-27T10:59:00Z', '2026-09-27T11:00:00Z', now)).toMatch(/before the current match/);
  });
  it('drops darts that have failed for too long', () => {
    expect(recoveryAbandonReason('2026-09-27T11:50:00Z', null, now)).toMatch(/Gave up/);
  });
});
