// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ScoliaRealtimeCommentaryPublisher } from './scoliaRealtimeCommentaryPublisher';

const { FakeSocket } = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events');
  class FakeSocket extends EventEmitter {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    static instances: FakeSocket[] = [];
    readyState = FakeSocket.CONNECTING;
    ping = vi.fn();
    send = vi.fn();
    close = vi.fn(() => this.finish());
    terminate = vi.fn(() => this.finish());
    constructor() { super(); FakeSocket.instances.push(this); }
    open() { this.readyState = FakeSocket.OPEN; this.emit('open'); }
    private finish() {
      if (this.readyState === FakeSocket.CLOSED) return;
      this.readyState = FakeSocket.CLOSED;
      this.emit('close', 1006);
    }
  }
  return { FakeSocket };
});
vi.mock('ws', () => ({ WebSocket: FakeSocket }));

afterEach(() => {
  FakeSocket.instances = [];
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const session = { id: 'listener', match_id: 'match', openai_call_id: 'call', epoch: 0, persona_id: 'chad' };

async function openConnection() {
  const publisher = new ScoliaRealtimeCommentaryPublisher({} as SupabaseClient, 'test-key');
  const internals = publisher as unknown as {
    connection: (value: typeof session) => Promise<unknown>;
    seedConnection: () => Promise<void>;
    connections: Map<string, unknown>;
  };
  vi.spyOn(internals, 'seedConnection').mockResolvedValue();
  const ready = internals.connection(session);
  FakeSocket.instances[0].open();
  await ready;
  return { publisher, internals, socket: FakeSocket.instances[0] };
}

describe('OpenAI sideband liveness', () => {
  it('cuts a socket that stops answering pings so the next delivery reconnects', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { publisher, internals, socket } = await openConnection();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(socket.ping).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(socket.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(socket.terminate).toHaveBeenCalledOnce();
    expect(internals.connections.size).toBe(0);
    publisher.close();
  });

  it('keeps a socket that answers its pings', async () => {
    vi.useFakeTimers();
    const { publisher, socket } = await openConnection();
    for (let round = 0; round < 3; round++) {
      await vi.advanceTimersByTimeAsync(15_000);
      socket.emit('pong');
    }
    await vi.advanceTimersByTimeAsync(10_000);
    expect(socket.ping).toHaveBeenCalledTimes(3);
    expect(socket.terminate).not.toHaveBeenCalled();
    publisher.close();
  });

  it('terminates a handshake that never completes and survives a second error', async () => {
    vi.useFakeTimers();
    const publisher = new ScoliaRealtimeCommentaryPublisher({} as SupabaseClient, 'test-key');
    const internals = publisher as unknown as { connection: (value: typeof session) => Promise<unknown> };
    const ready = internals.connection(session);
    const rejected = expect(ready).rejects.toThrow('timed out');
    const socket = FakeSocket.instances[0];
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    expect(socket.terminate).toHaveBeenCalledOnce();
    // ws may report more than one error for a socket torn down mid-handshake; none may go unhandled.
    expect(() => { socket.emit('error', new Error('first')); socket.emit('error', new Error('late')); }).not.toThrow();
    publisher.close();
  });
});
