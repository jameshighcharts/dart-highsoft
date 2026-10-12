import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/shared/sharedData', () => ({ readSharedData: vi.fn() }));

import { readSharedData } from '@/lib/shared/sharedData';
import { GET } from './route';

const get = (name: string, query = '') =>
  GET(new NextRequest(`http://localhost/api/shared/${name}${query}`), { params: Promise.resolve({ name }) });

afterEach(() => {
  vi.mocked(readSharedData).mockReset();
});

describe('GET /api/shared/[name]', () => {
  it('returns the cached JSON without letting the browser or CDN keep it', async () => {
    vi.mocked(readSharedData).mockResolvedValue('{"a":1}');
    const response = await get('bullers', '?x=1');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"a":1}');
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(vi.mocked(readSharedData).mock.calls[0][0]).toBe('bullers');
    expect(vi.mocked(readSharedData).mock.calls[0][1].get('x')).toBe('1');
  });

  it('answers 404 for unknown data and 502 when loading fails', async () => {
    vi.mocked(readSharedData).mockResolvedValueOnce(null);
    expect((await get('nope')).status).toBe(404);
    vi.spyOn(console, 'error').mockImplementationOnce(() => {});
    vi.mocked(readSharedData).mockRejectedValueOnce(new Error('timeout'));
    expect((await get('bullers')).status).toBe(502);
  });
});
