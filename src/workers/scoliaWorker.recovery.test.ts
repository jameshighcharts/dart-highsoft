// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import http from 'node:http';
import net from 'node:net';
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

const { FakeSocket } = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events');
  class FakeSocket extends EventEmitter {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    static instances: FakeSocket[] = [];
    readyState = FakeSocket.OPEN;
    sent: { type: string }[] = [];
    close = vi.fn(() => { this.readyState = FakeSocket.CLOSED; });
    terminate = vi.fn(() => { this.readyState = FakeSocket.CLOSED; });
    ping = vi.fn();
    constructor(readonly url: URL, readonly options?: { handshakeTimeout?: number }) {
      super();
      FakeSocket.instances.push(this);
    }
    send(data: string) { this.sent.push(JSON.parse(data)); }
  }
  return { FakeSocket };
});
vi.mock('ws', () => ({ WebSocket: FakeSocket }));

type Internals = {
  socket: InstanceType<typeof FakeSocket> | null;
  lastMessageAt: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  recoveryNeeded: boolean;
  connect: () => void;
  heartbeat: () => Promise<void>;
  needsRestart: (now?: number) => boolean;
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
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  for (const connection of connections.splice(0)) await connection.stop();
  vi.useRealTimers();
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
    board.lastMessageAt = Date.now() - 16_000;

    board.checkLiveness();
    expect(first.sent).toEqual([{ type: 'GET_SBC_STATUS', id: expect.any(String) }]);
    board.checkLiveness(Date.now() + 9_000);
    expect(first.terminate).not.toHaveBeenCalled();

    board.checkLiveness(Date.now() + 10_000);
    // A close handshake Scolia ignores would keep the old socket alive and the board locked (4101).
    expect(first.terminate).toHaveBeenCalledOnce();
    expect(first.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(FakeSocket.instances).toHaveLength(2);

    // The abandoned socket's late close event must not open a competing connection.
    first.emit('close', 1006);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it('bounds the opening handshake', () => {
    const board = connect();
    board.connect();
    expect(FakeSocket.instances[0].options).toEqual({ handshakeTimeout: 15_000 });
  });

  it('retries after a failed handshake', async () => {
    vi.useFakeTimers();
    const board = connect();
    board.connect();
    const first = FakeSocket.instances[0];
    first.readyState = FakeSocket.CONNECTING;
    first.emit('error', new Error('Unexpected server response: 503'));
    first.emit('close', 1006);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it('abandons a connection attempt that never finishes', async () => {
    vi.useFakeTimers();
    const board = connect();
    board.connect();
    const first = FakeSocket.instances[0];
    first.readyState = FakeSocket.CONNECTING;
    board.checkLiveness(Date.now() + 20_000);
    expect(first.terminate).not.toHaveBeenCalled();
    board.checkLiveness(Date.now() + 25_000);
    expect(first.terminate).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it('reconnects a board that has no socket and no reconnect pending', () => {
    const board = connect();
    board.checkLiveness();
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('does not open a second socket while a reconnect is already scheduled', async () => {
    vi.useFakeTimers();
    const board = connect();
    board.connect();
    FakeSocket.instances[0].emit('close', 1006);
    expect(board.reconnectTimer).not.toBeNull();
    board.checkLiveness();
    expect(FakeSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it('abandons a socket whose pongs stop arriving', () => {
    vi.useFakeTimers();
    const board = connect();
    board.connect();
    const socket = FakeSocket.instances[0];
    board.lastMessageAt = Date.now();
    board.checkLiveness();
    expect(socket.ping).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(100);
    socket.emit('pong');

    vi.advanceTimersByTime(9_900);
    board.lastMessageAt = Date.now() - 1;
    board.checkLiveness();
    expect(socket.ping).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(4_000);
    board.checkLiveness();
    expect(socket.terminate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    board.checkLiveness();
    expect(socket.terminate).toHaveBeenCalledOnce();
  });

  it('does not treat missing pongs as fatal when Scolia never answers pings', () => {
    vi.useFakeTimers();
    const board = connect();
    board.connect();
    const socket = FakeSocket.instances[0];
    board.lastMessageAt = Date.now();
    board.checkLiveness();
    vi.advanceTimersByTime(8_000);
    board.lastMessageAt = Date.now();
    board.checkLiveness();
    expect(socket.terminate).not.toHaveBeenCalled();
    expect(socket.ping).toHaveBeenCalledTimes(1);
  });

  it('leaves a chatty socket alone', async () => {
    const board = connect();
    await board.connect();
    board.lastMessageAt = Date.now();
    board.checkLiveness();
    expect(FakeSocket.instances[0].sent).toEqual([]);
  });
});

// The reconnect loop relies on ws always following a failed handshake with 'close'.
// Node 22's built-in WebSocket did not, which left boards stuck until the worker restarted.
describe('ws handshake failure contract', () => {
  async function closeCode(server: http.Server | net.Server, handshakeTimeout?: number) {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as net.AddressInfo;
    const { WebSocket } = await vi.importActual<typeof import('ws')>('ws');
    try {
      return await new Promise<number>((resolve) => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}`, { handshakeTimeout });
        socket.on('error', () => {});
        socket.on('close', resolve);
      });
    } finally {
      server.close();
      if ('closeAllConnections' in server) server.closeAllConnections();
    }
  }

  it('closes after the server refuses the upgrade', async () => {
    const server = http.createServer((_request, response) => response.writeHead(503).end());
    expect(await closeCode(server)).toBe(1006);
  });

  it('closes when the server never answers the handshake', async () => {
    const sockets: net.Socket[] = [];
    const server = net.createServer((socket) => { sockets.push(socket); });
    expect(await closeCode(server, 100)).toBe(1006);
    sockets.forEach((socket) => socket.destroy());
  });
});

describe('connection status', () => {
  const status: ScoliaMessage = { type: 'SBC_STATUS', id: 'status', payload: { boardStatus: 'Ready', boardPhase: 'Throw' } };
  const connectionStatuses = (board: Internals) => vi.mocked(board.updateBoard).mock.calls
    .map(([values]) => values.worker_connection_status).filter(Boolean);

  it('never reports a closed board as connected from a message processed late', async () => {
    const board = connect();
    board.connect();
    FakeSocket.instances[0].emit('close', 1006);
    await board.persistMessage(status);
    expect(connectionStatuses(board)).toEqual(['connecting', 'reconnecting']);
  });

  it('writes repeated status replies only when the board state changes', async () => {
    const board = connect();
    await board.persistMessage(status);
    await board.persistMessage(status);
    expect(board.updateBoard).toHaveBeenCalledOnce();
    await board.persistMessage({ ...status, payload: { boardStatus: 'Ready', boardPhase: 'Takeout' } });
    expect(board.updateBoard).toHaveBeenCalledTimes(2);
  });
});

describe('restart watchdog', () => {
  it('asks for a restart when a board cannot reach Scolia for ten minutes', async () => {
    vi.useFakeTimers();
    const board = connect();
    board.connect();
    FakeSocket.instances[0].emit('close', 1006);
    expect(board.needsRestart(Date.now() + 9 * 60_000)).toBe(false);
    expect(board.needsRestart(Date.now() + 10 * 60_000)).toBe(true);
    FakeSocket.instances[0].removeAllListeners();
    await vi.advanceTimersByTimeAsync(2_000);
    FakeSocket.instances.at(-1)!.emit('open');
    expect(board.needsRestart(Date.now() + 60 * 60_000)).toBe(false);
  });

  it('does not restart over a configuration error a restart cannot fix', () => {
    const board = connect();
    board.connect();
    FakeSocket.instances[0].emit('close', 4102);
    expect(board.needsRestart(Date.now() + 60 * 60_000)).toBe(false);
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
    vi.mocked(findActiveScoliaBoardOccupant).mockResolvedValue({ kind: 'match', id: 'new-match', createdAt: secondsAgo(10), bullOffThrowing: false });
    const board = connect(supabase);
    await board.processPendingThrows();
    expect(ingestScoliaThrowEvent).not.toHaveBeenCalled();
    expect(marked).toEqual([expect.objectContaining({ processing_status: 'ignored', processing_error: 'Thrown before the current match or game started' })]);
  });

  it('keeps recovering later darts when one keeps failing', async () => {
    const events = [1, 2].map((id) => ({ id, board_id: 'board', message_id: `m${id}`, event_type: 'THROW_DETECTED', payload: {}, received_at: secondsAgo(5) }));
    const { supabase } = pending(events);
    vi.mocked(findActiveScoliaBoardOccupant).mockResolvedValue({ kind: 'match', id: 'match', createdAt: secondsAgo(600), bullOffThrowing: false });
    vi.mocked(ingestScoliaThrowEvent).mockReset()
      .mockRejectedValueOnce(new Error('stubborn'))
      .mockResolvedValueOnce({ status: 'ignored', reason: 'fine' });
    const board = connect(supabase);
    await board.processPendingThrows();
    expect(ingestScoliaThrowEvent).toHaveBeenCalledTimes(2);
  });

  it('stops polling for stored darts once nothing is left to recover, until a failure', async () => {
    const { supabase } = pending([]);
    const board = connect(supabase);
    await board.processPendingThrows();
    expect(board.recoveryNeeded).toBe(false);
    const enqueue = vi.spyOn(board, 'enqueue');
    await board.heartbeat();
    expect(enqueue).not.toHaveBeenCalled();

    board.enqueue(async () => { throw new Error('scoring failed'); });
    await vi.waitFor(() => expect(board.recoveryNeeded).toBe(true));
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
