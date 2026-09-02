import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  connectScoliaBoard,
  disconnectScoliaBoard,
  listScoliaBoards,
} from '@/lib/scolia/client';

const board = {
  name: 'Main board',
  serialNumber: 'SCOLIA-123',
  isHomeSbc: true,
};

describe('Scolia REST client', () => {
  beforeEach(() => {
    process.env.SCOLIA_ACCESS_TOKEN = 'test-token';
    process.env.SCOLIA_API_BASE_URL = 'https://scolia.test';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SCOLIA_ACCESS_TOKEN;
    delete process.env.SCOLIA_API_BASE_URL;
  });

  it('lists boards with bearer authentication and no caching', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([board]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(listScoliaBoards()).resolves.toEqual([board]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://scolia.test/api/social/boards',
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
      })
    );
  });

  it('connects a board by serial number', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(board), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(connectScoliaBoard('SCOLIA-123')).resolves.toEqual(board);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://scolia.test/api/social/boards',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ serialNumber: 'SCOLIA-123' }),
      })
    );
  });

  it('URL-encodes serial numbers when disconnecting', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(disconnectScoliaBoard('board/one')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://scolia.test/api/social/boards/board%2Fone',
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('fails safely when the server token is missing', async () => {
    delete process.env.SCOLIA_ACCESS_TOKEN;
    vi.stubGlobal('fetch', vi.fn());

    await expect(listScoliaBoards()).rejects.toMatchObject({
      message: 'SCOLIA_ACCESS_TOKEN is not configured on the server',
      status: 503,
    });
  });

  it('preserves useful Scolia client errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Board has already been connected.' }), { status: 409 })
      )
    );

    await expect(connectScoliaBoard('SCOLIA-123')).rejects.toMatchObject({
      message: 'Board has already been connected.',
      status: 409,
      diagnostics: {
        upstreamStatus: 409,
        payload: { error: 'Board has already been connected.' },
        requestId: null,
      },
    });
  });

  it('captures a safe upstream request id for diagnostics', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'Forbidden resource', code: 'forbidden' }), {
          status: 403,
          headers: { 'x-request-id': 'request-123' },
        })
      )
    );

    await expect(connectScoliaBoard('SCOLIA-123')).rejects.toMatchObject({
      message: 'Forbidden resource',
      status: 403,
      diagnostics: {
        upstreamStatus: 403,
        payload: { message: 'Forbidden resource', code: 'forbidden' },
        requestId: 'request-123',
      },
    });
  });

  it('rejects malformed board responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([{ name: 'Broken' }]), { status: 200 })));

    await expect(listScoliaBoards()).rejects.toMatchObject({
      message: 'Scolia returned an invalid board list',
      status: 502,
    });
  });
});
