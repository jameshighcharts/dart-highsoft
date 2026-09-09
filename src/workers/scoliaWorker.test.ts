// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BoardConnection } from './scoliaWorker';
import { ingestScoliaThrowEvent } from '../lib/server/scoliaThrowIngestion';
import type { ScoliaRealtimeCommentaryPublisher } from '../services/scoliaRealtimeCommentaryPublisher';
import type { ScoliaMessage } from '../lib/scolia/protocol';

vi.mock('../lib/server/scoliaThrowIngestion', () => ({ ingestScoliaThrowEvent: vi.fn() }));
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.restoreAllMocks();
});

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup() {
  const status = deferred();
  const stored = { id: 1, board_id: 'board', message_id: 'dart-message',
    event_type: 'THROW_DETECTED', payload: {}, processing_status: 'pending' };
  const prepared = { kind: 'x01', matchId: 'match', revision: '1' };
  const persisted = vi.fn(async () => ({ data: { event: { ...stored },
    prepared: stored.processing_status === 'pending' ? prepared : null }, error: null }));
  const from = vi.fn(() => { throw new Error('Dart persistence must use the combined RPC'); });
  const publishAcceptedThrow = vi.fn(async () => {});
  const connection = new BoardConnection({ id: 'board', name: 'Board', serialNumber: 'serial', isHomeSbc: false },
    'token', { from, rpc: persisted } as unknown as SupabaseClient,
    { publishAcceptedThrow } as unknown as ScoliaRealtimeCommentaryPublisher);
  const internals = connection as unknown as {
    persistMessage: (message: ScoliaMessage) => Promise<void>;
    updateBoard: () => Promise<void>;
    enqueue: (work: () => Promise<void>) => void;
  };
  vi.spyOn(internals, 'updateBoard').mockImplementation(() => status.promise);
  cleanups.push(async () => {
    status.resolve();
    vi.mocked(internals.updateBoard).mockResolvedValue();
    await connection.stop();
  });
  vi.spyOn(console, 'info').mockImplementation(() => {});
  const message = { id: 'dart-message', type: 'THROW_DETECTED', payload: {} };
  vi.mocked(ingestScoliaThrowEvent).mockReset().mockImplementation(async () => {
    stored.processing_status = 'processed';
    return { status: 'processed', target: { kind: 'match', id: 'match' }, throwId: 'dart' };
  });
  return { status, stored, prepared, persisted, from, internals, message, publishAcceptedThrow };
}

describe('Scolia board-status overlap', () => {
  it('scores and publishes before status completes, but keeps later board messages ordered', async () => {
    const { status, internals, message, publishAcceptedThrow, persisted, prepared, from } = setup();
    const later = vi.fn(async () => {});
    internals.enqueue(() => internals.persistMessage(message));
    internals.enqueue(later);
    await vi.waitFor(() => expect(publishAcceptedThrow).toHaveBeenCalledOnce());
    expect(persisted).toHaveBeenCalledOnce();
    expect(persisted).toHaveBeenCalledWith('persist_and_prepare_scolia_throw', {
      p_event: expect.objectContaining({ board_id: 'board', message_id: message.id,
        event_type: 'THROW_DETECTED', payload: message.payload }),
      p_known_match_id: null, p_known_revision: null,
    });
    expect(from).not.toHaveBeenCalled();
    expect(ingestScoliaThrowEvent).toHaveBeenCalledOnce();
    expect(vi.mocked(ingestScoliaThrowEvent).mock.calls[0][3]).toBe(prepared);
    expect(publishAcceptedThrow.mock.calls[0].slice(0, 2)).toEqual(['match', 'dart']);
    expect(later).not.toHaveBeenCalled();
    status.resolve();
    await vi.waitFor(() => expect(later).toHaveBeenCalledOnce());
  });

  it('retries a failed status write without scoring or publishing the accepted dart again', async () => {
    const { status, internals, message, publishAcceptedThrow } = setup();
    const pending = internals.persistMessage(message);
    const failure = expect(pending).rejects.toThrow('status failed');
    await vi.waitFor(() => expect(publishAcceptedThrow).toHaveBeenCalledOnce());
    status.reject(new Error('status failed'));
    await failure;
    vi.mocked(internals.updateBoard).mockResolvedValueOnce();
    await internals.persistMessage(message);
    expect(ingestScoliaThrowEvent).toHaveBeenCalledOnce();
    expect(publishAcceptedThrow).toHaveBeenCalledOnce();
  });

  it('waits for an in-flight status write even if ingestion fails', async () => {
    const { status, internals, message, publishAcceptedThrow } = setup();
    vi.mocked(ingestScoliaThrowEvent).mockRejectedValueOnce(new Error('scoring failed'));
    const finished = vi.fn();
    const pending = internals.persistMessage(message).finally(finished);
    const failure = expect(pending).rejects.toThrow('scoring failed');
    await vi.waitFor(() => expect(ingestScoliaThrowEvent).toHaveBeenCalledOnce());
    expect(finished).not.toHaveBeenCalled();
    expect(publishAcceptedThrow).not.toHaveBeenCalled();
    status.resolve();
    await failure;
  });

  it('does not score or write status when durable event persistence fails', async () => {
    const { internals, message, persisted } = setup();
    persisted.mockRejectedValueOnce(new Error('event failed'));
    await expect(internals.persistMessage(message)).rejects.toThrow('event failed');
    expect(internals.updateBoard).not.toHaveBeenCalled();
    expect(ingestScoliaThrowEvent).not.toHaveBeenCalled();
  });
});
