import { RealtimeNarrativeWireState } from '../lib/commentary/realtimeWireFormat';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CommentaryPolicy } from '../lib/commentary/commentaryPolicy';
import { CommentaryVisitTiming } from '../lib/commentary/commentaryVisitTiming';
import { RealtimePlayback } from '../lib/commentary/realtimePlayback';
import { RealtimeResponseQueue } from '../lib/commentary/realtimeResponseQueue';
import { ScoliaRealtimeCommentaryPublisher } from './scoliaRealtimeCommentaryPublisher';

import { warmScoliaDartIQContext, ScoliaDartIQEventCache } from '../lib/commentary/scoliaRealtimeEvent';

vi.mock('../lib/commentary/scoliaRealtimeEvent', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/commentary/scoliaRealtimeEvent')>(),
  warmScoliaDartIQContext: vi.fn(async () => undefined),
}));
afterEach(() => vi.mocked(warmScoliaDartIQContext).mockReset().mockResolvedValue(undefined));

describe('Scolia delivery persistence', () => {
  it.each(['new', 'pending', 'sent', 'failed', 'insert-error', 'read-error'] as const)(
    'preserves delivery state for %s', async (state) => {
      const row = { session_id: 'listener', throw_id: 'dart',
        status: state === 'new' ? 'pending' : state, attempts: state === 'new' ? 0 : 2 };
      const query = {
        upsert: vi.fn(() => query), select: vi.fn(() => query), eq: vi.fn(() => query),
        maybeSingle: vi.fn(async () => ({ data: state === 'new' ? row : null,
          error: state === 'insert-error' ? { message: 'insert failed' } : null })),
        single: vi.fn(async () => ({ data: row,
          error: state === 'read-error' ? { message: 'read failed' } : null })),
      };
      const from = vi.fn(() => query);
      const publisher = new ScoliaRealtimeCommentaryPublisher({ from } as unknown as SupabaseClient, 'test');
      const internals = publisher as unknown as { ensureDelivery: (session: string, dart: string) => Promise<typeof row> };
      const result = internals.ensureDelivery('listener', 'dart');
      if (state === 'insert-error') await expect(result).rejects.toThrow('insert failed');
      else if (state === 'read-error') await expect(result).rejects.toThrow('read failed');
      else await expect(result).resolves.toEqual(row);
      expect(from).toHaveBeenCalledTimes(state === 'new' || state === 'insert-error' ? 1 : 2);
      expect(query.upsert).toHaveBeenCalledWith({ session_id: 'listener', throw_id: 'dart' },
        { onConflict: 'session_id,throw_id', ignoreDuplicates: true });
      if (state !== 'new' && state !== 'insert-error') {
        expect(query.eq.mock.calls).toEqual([['session_id', 'listener'], ['throw_id', 'dart']]);
      }
    });
});

describe('Scolia cache preparation', () => {
  it.each(['ready', 'correction', 'live', 'replaced', 'closed', 'disconnected'] as const)(
    'only installs an unused current warm-up: %s', async (state) => {
      const publisher = new ScoliaRealtimeCommentaryPublisher({} as SupabaseClient, 'test');
      const internals = publisher as unknown as {
        warmCache: (id: string) => void;
        dartIQCache: ScoliaDartIQEventCache;
        cacheWarmups: Map<string, Promise<void>>;
        matchEpochs: Map<string, number>;
        matchWork: Map<string, Promise<void>>;
        connections: Map<string, object>;
      };
      const context = { timeline: [] } as unknown as NonNullable<Awaited<ReturnType<typeof warmScoliaDartIQContext>>>;
      let release!: (value: typeof context) => void;
      vi.mocked(warmScoliaDartIQContext).mockReturnValue(new Promise((resolve) => { release = resolve; }));
      internals.matchEpochs.set('match', 0);
      internals.connections.set('listener', { session: { match_id: 'match' } });
      internals.warmCache('match');
      internals.warmCache('match');
      expect(warmScoliaDartIQContext).toHaveBeenCalledTimes(1);
      const pending = internals.cacheWarmups.get('match');
      expect(internals.matchWork.size).toBe(0);
      if (state === 'correction') internals.matchEpochs.set('match', 1);
      if (state === 'live') internals.matchWork.set('match', Promise.resolve());
      const replacement = { ...context };
      if (state === 'replaced') internals.dartIQCache.set('match', replacement);
      if (state === 'closed' || state === 'disconnected') internals.connections.clear();
      if (state === 'closed') publisher.close();
      release(context);
      await pending;
      expect(internals.dartIQCache.get('match')).toBe(
        state === 'ready' ? context : state === 'replaced' ? replacement : undefined);
      expect(internals.cacheWarmups.size).toBe(0);
    });
});

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
    expect(vi.mocked(warmScoliaDartIQContext).mock.calls.map(([, id]) => id)).toEqual(['b', 'a']);
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
  it('preserves speech past the old six-second cutoff but recovers a stuck response', () => {
    vi.useFakeTimers();
    const publisher = new ScoliaRealtimeCommentaryPublisher({} as SupabaseClient, 'test-key');
    const connection = {
      session: { id: 'listener' },
      socket: { readyState: 1, send: vi.fn(), close: vi.fn() },
      policy: new CommentaryPolicy(), playback: new RealtimePlayback(),
      visitTiming: new CommentaryVisitTiming(),
      responseQueue: new RealtimeResponseQueue<Record<string, unknown>>(),
      pendingStoryResponses: new Map(), activeStoryResponse: null, transcript: '',
      wireState: new RealtimeNarrativeWireState(),
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
      expect(connection.socket.send).not.toHaveBeenCalled();
      expect(connection.playback.busy).toBe(true);
      vi.advanceTimersByTime(24_000);
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
