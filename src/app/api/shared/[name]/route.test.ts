import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/shared/sharedData', () => ({ readSharedData: vi.fn() }));
vi.mock('@/auth', () => ({ getAuthenticatedSession: vi.fn() }));

import { getAuthenticatedSession } from '@/auth';
import { readSharedData } from '@/lib/shared/sharedData';
import { GET } from './route';

const SESSION = { user: { email: 'a@highsoft.com', slackTeamId: 'T1' }, expires: '2099-01-01T00:00:00Z' };

const get = (name: string, query = '') =>
  GET(new NextRequest(`http://localhost/api/shared/${name}${query}`), { params: Promise.resolve({ name }) });

beforeEach(() => {
  vi.mocked(getAuthenticatedSession).mockResolvedValue(SESSION as never);
});

afterEach(() => {
  vi.mocked(readSharedData).mockReset();
});

describe('GET /api/shared/[name]', () => {
  it('turns away a request without a signed-in member before loading anything (the proxy skips this route)', async () => {
    vi.mocked(getAuthenticatedSession).mockResolvedValueOnce(null);
    const response = await get('bullers');
    expect(response.status).toBe(401);
    expect(readSharedData).not.toHaveBeenCalled();
  });

  it('returns the cached JSON without letting the browser or CDN keep it', async () => {
    vi.mocked(readSharedData).mockResolvedValue({ body: '{"a":1}', computed: false });
    const response = await get('bullers', '?x=1');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"a":1}');
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('server-timing')).toMatch(/^auth;dur=\d+\.\d, shared;desc="cached";dur=\d+\.\d$/);
    expect(vi.mocked(readSharedData).mock.calls[0][0]).toBe('bullers');
    expect(vi.mocked(readSharedData).mock.calls[0][1].get('x')).toBe('1');
  });

  it('answers 404 for unknown data and 502 when loading fails', async () => {
    vi.mocked(readSharedData).mockResolvedValueOnce(null);
    expect((await get('nope')).status).toBe(404);
    vi.spyOn(console, 'error').mockImplementationOnce(() => {});
    vi.mocked(readSharedData).mockRejectedValueOnce(new Error('timeout'));
    const failed = await get('bullers');
    expect(failed.status).toBe(502);
    expect(failed.headers.get('x-shared-data-load-failed')).toBe('1');
  });
});
