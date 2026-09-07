import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CommentaryPolicy } from '../lib/commentary/commentaryPolicy';
import { CommentaryVisitTiming } from '../lib/commentary/commentaryVisitTiming';
import { RealtimePlayback } from '../lib/commentary/realtimePlayback';
import { RealtimeResponseQueue } from '../lib/commentary/realtimeResponseQueue';
import { ScoliaRealtimeCommentaryPublisher } from './scoliaRealtimeCommentaryPublisher';

describe('Scolia commentary serialization', () => {
  it('scopes recovery and lets another match recover while one connection is blocked', async () => {
    const sessions = [
      { id: 'a1', match_id: 'a', epoch: 0 },
      { id: 'a2', match_id: 'a', epoch: 0 },
      { id: 'b1', match_id: 'b', epoch: 0 },
    ];
    const deliveries = sessions.map((session, index) => ({
      session_id: session.id, throw_id: `dart-${index}`, status: 'pending', attempts: 0,
    }));
    const query = {
      select: vi.fn(() => query), eq: vi.fn(() => query), order: vi.fn(() => query),
      limit: vi.fn(() => query), in: vi.fn(() => query),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: deliveries, error: null }).then(resolve),
    };
    const from = vi.fn(() => query);
    const publisher = new ScoliaRealtimeCommentaryPublisher({ from } as unknown as SupabaseClient, 'test-key');
    const internals = publisher as unknown as {
      loadActiveSessions: (ids?: readonly string[]) => Promise<typeof sessions>;
      connection: (session: typeof sessions[number]) => Promise<object>;
      ensureDelivery: (id: string, dartId: string) => Promise<object>;
      activeSessions: (matchId: string) => Promise<[]>;
    };
    vi.spyOn(internals, 'loadActiveSessions').mockResolvedValue(sessions);
    const liveRead = vi.spyOn(internals, 'activeSessions').mockResolvedValue([]);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(internals, 'connection').mockImplementation(async (session) => {
      if (session.match_id === 'a') await blocked;
      return {};
    });
    const recovered: string[] = [];
    vi.spyOn(internals, 'ensureDelivery').mockImplementation(async (id) => {
      recovered.push(id);
      return { status: 'sent' }; // A live send already won; don't redeliver it.
    });
    const ids = sessions.map((session) => session.id);
    const sweep = publisher.flushPending(ids);
    await vi.waitFor(() => expect(recovered).toEqual(['b1']));
    const live = publisher.publishAcceptedThrow('a', 'new-dart');
    await Promise.resolve();
    expect(liveRead).not.toHaveBeenCalled();
    release();
    await Promise.all([sweep, live]);
    expect(recovered).toEqual(['b1', 'a1', 'a2']);
    expect(liveRead).toHaveBeenCalledWith('a');
    expect(query.in).toHaveBeenCalledWith('session_id', ids);
    expect(internals.loadActiveSessions).toHaveBeenCalledWith(ids);
    expect(from).toHaveBeenCalledExactlyOnceWith('commentary_realtime_deliveries');
    publisher.close();
  });

  it('waits for an accepted dart before handling its takeout, while other matches progress', async () => {
    const publisher = new ScoliaRealtimeCommentaryPublisher({} as SupabaseClient, 'test-key');
    const internals = publisher as unknown as { activeSessions: (matchId: string) => Promise<[]> };
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const calls: string[] = [];
    vi.spyOn(internals, 'activeSessions').mockImplementation(async (matchId) => {
      calls.push(matchId);
      if (calls.length === 1) await blocked;
      return [];
    });
    const dart = publisher.publishAcceptedThrow('match-a', 'dart');
    await Promise.resolve();
    const takeout = publisher.publishTakeoutFinished('match-a', 'takeout');
    await publisher.publishAcceptedThrow('match-b', 'other-dart');
    expect(calls).toEqual(['match-a', 'match-b']);
    release();
    await Promise.all([dart, takeout]);
    expect(calls).toEqual(['match-a', 'match-b', 'match-a']);
    publisher.close();
  });

  it('does not poison the match queue after a failed database read', async () => {
    const publisher = new ScoliaRealtimeCommentaryPublisher({} as SupabaseClient, 'test-key');
    const internals = publisher as unknown as { activeSessions: (matchId: string) => Promise<[]> };
    vi.spyOn(internals, 'activeSessions').mockRejectedValueOnce(new Error('offline')).mockResolvedValue([]);
    await expect(publisher.publishAcceptedThrow('match', 'dart')).rejects.toThrow('offline');
    await expect(publisher.publishTakeoutFinished('match', 'takeout')).resolves.toBe(0);
    publisher.close();
  });
});


describe('Scolia takeout commentary', () => {
  it.each(['playing', 'recent', 'quiet', 'takeout-gap', 'recent-walk-on'] as const)('updates context during a %s gap without forced interruption', async (state) => {
    const publisher = new ScoliaRealtimeCommentaryPublisher({} as SupabaseClient, 'test-key');
    const socket = { readyState: 1, send: vi.fn() };
    const policy = new CommentaryPolicy();
    const playback = new RealtimePlayback();
    const responseQueue = new RealtimeResponseQueue<Record<string, unknown>>();
    if (state === 'playing') {
      playback.created('still-audible');
      playback.generationFinished('still-audible', true);
    }
    if (state === 'recent') policy.recordAmbientCall(Date.now());
    if (state === 'takeout-gap') policy.recordAmbientCall(Date.now() - 4_500);
    if (state === 'recent-walk-on') {
      policy.recordWalkOn(Date.now() - 14_000);
      policy.responseFinished();
    }
    const shouldAnnounce = state === 'quiet' || state === 'takeout-gap';
    const connection = {
      socket, policy, playback, responseQueue, visitTiming: new CommentaryVisitTiming(),
      pendingTakeoutHandoff: {
        sourceDartId: 'dart', turnId: 'turn', playerId: 'ada', playerName: 'Ada', scoreRemaining: 40,
      },
    };
    const internals = publisher as unknown as {
      activeSessions: () => Promise<{ id: string; epoch: number; persona_id: string }[]>;
      connection: () => Promise<typeof connection>;
    };
    vi.spyOn(internals, 'activeSessions').mockResolvedValue([{ id: 'listener', epoch: 0, persona_id: 'chad' }]);
    vi.spyOn(internals, 'connection').mockResolvedValue(connection);
    expect(await publisher.publishTakeoutFinished('match', 'takeout')).toBe(shouldAnnounce ? 1 : 0);
    const events = socket.send.mock.calls.map(([raw]) => JSON.parse(raw));
    expect(events.map((event) => event.type)).toEqual(shouldAnnounce
      ? ['conversation.item.create', 'response.create'] : ['conversation.item.create']);
    expect(connection.pendingTakeoutHandoff).toBeNull();
    connection.visitTiming.reset();
    responseQueue.reset();
    publisher.close();
  });
});

describe('Scolia pause reactions', () => {
  it.each(['waiting', 'resumed', 'completed', 'playing', 'expired'] as const)(
    'only speaks during a verified idle pause: %s', async (state) => {
      let stillWaiting = true;
      const supabase = { from: () => ({ select: () => ({ eq: () => ({
        single: async () => {
          if (state === 'resumed') stillWaiting = false;
          return { data: { ended_early: false, winner_player_id: null,
            completed_at: state === 'completed' ? '2026-09-04' : null }, error: null };
        },
      }) }) }) };
      const publisher = new ScoliaRealtimeCommentaryPublisher(supabase as unknown as SupabaseClient, 'test-key');
      const session = { id: 'listener', epoch: 0, persona_id: 'chad' };
      const connection = {
        session, socket: { readyState: 1, send: vi.fn() },
        policy: new CommentaryPolicy(), playback: new RealtimePlayback(),
        visitTiming: new CommentaryVisitTiming(),
        responseQueue: new RealtimeResponseQueue<Record<string, unknown>>(),
      };
      if (state === 'playing') connection.playback.created('audible');
      const internals = publisher as unknown as {
        connections: Map<string, typeof connection>;
        activeSessions: () => Promise<typeof session[]>;
        publishIdleCall: (liveConnection: typeof connection, matchId: string, takeoutId: string, check: () => boolean) => Promise<void>;
      };
      internals.connections.set(session.id, connection);
      vi.spyOn(internals, 'activeSessions').mockResolvedValue(state === 'expired' ? [] : [session]);
      await internals.publishIdleCall(connection, 'match', 'takeout', () => stillWaiting);
      expect(connection.socket.send).toHaveBeenCalledTimes(state === 'waiting' ? 1 : 0);
      if (state === 'waiting') {
        const message = JSON.parse(connection.socket.send.mock.calls[0][0]);
        expect(message.type).toBe('response.create');
        expect(message.response.metadata.source).toBe('scolia-worker-idle');
      }
      connection.responseQueue.reset();
      connection.visitTiming.reset();
      internals.connections.clear();
      publisher.close();
    }
  );
});

describe('Scolia stale speech', () => {
  it('clears audible output and drops a queued replacement when its lifetime expires', () => {
    vi.useFakeTimers();
    const publisher = new ScoliaRealtimeCommentaryPublisher({} as SupabaseClient, 'test-key');
    const connection = {
      session: { id: 'listener' },
      socket: { readyState: 1, send: vi.fn(), close: vi.fn() },
      policy: new CommentaryPolicy(), playback: new RealtimePlayback(),
      visitTiming: new CommentaryVisitTiming(),
      responseQueue: new RealtimeResponseQueue<Record<string, unknown>>(),
      pendingStoryResponses: new Map(), activeStoryResponse: null, transcript: '',
    };
    const internals = publisher as unknown as {
      enqueueProviderResponse: (liveConnection: typeof connection, event: Record<string, unknown>) => void;
    };
    try {
      connection.responseQueue.enqueue({ type: 'response.create', event_id: 'old' });
      connection.responseQueue.markCreated('old-response');
      connection.playback.created('old-response');
      internals.enqueueProviderResponse(connection, { type: 'response.create', event_id: 'queued' });
      expect(connection.socket.send).not.toHaveBeenCalled();
      vi.advanceTimersByTime(6_000);
      expect(connection.socket.send.mock.calls.map(([raw]) => JSON.parse(raw).type))
        .toEqual(['response.cancel', 'output_audio_buffer.clear']);
      expect(connection.responseQueue.complete('old-response').next).toBeNull();
      expect(connection.playback.busy).toBe(false);
    } finally {
      connection.visitTiming.reset();
      connection.responseQueue.reset();
      vi.useRealTimers();
    }
  });
});
