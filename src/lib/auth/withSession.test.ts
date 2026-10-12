import { NextRequest, NextResponse } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The test setup replaces withSession with a pass-through for route tests.
vi.unmock('@/lib/auth/withSession');
vi.mock('@/auth', () => ({ getAuthenticatedSession: vi.fn() }));
vi.mock('@/lib/auth/devBypass', () => ({ isAuthPerformanceBypassEnabled: vi.fn(() => false) }));

import { getAuthenticatedSession } from '@/auth';
import { isAuthPerformanceBypassEnabled } from '@/lib/auth/devBypass';
import { withSession } from './withSession';

const SESSION = { user: { email: 'a@highsoft.com', slackTeamId: 'T1' }, expires: '2099-01-01T00:00:00Z' };
const request = () => new NextRequest('https://darts.example/api/me');

afterEach(() => {
  vi.mocked(getAuthenticatedSession).mockReset();
  vi.mocked(isAuthPerformanceBypassEnabled).mockReturnValue(false);
});

describe('withSession', () => {
  it('turns away a request without a signed-in member before the handler runs', async () => {
    vi.mocked(getAuthenticatedSession).mockResolvedValue(null);
    const handler = vi.fn(async (_request: NextRequest) => NextResponse.json({ ok: true }));
    const response = await withSession(handler)(request());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('runs the handler with its own arguments for a signed-in member, and reports the check in Server-Timing', async () => {
    vi.mocked(getAuthenticatedSession).mockResolvedValue(SESSION as never);
    const handler = vi.fn(async (_request: NextRequest, context: { params: Promise<{ id: string }> }) =>
      NextResponse.json({ id: (await context.params).id }, { headers: { 'Server-Timing': 'shared;dur=1.0' } }));
    const req = request();
    const response = await withSession(handler)(req, { params: Promise.resolve({ id: 'x' }) });
    expect(await response.json()).toEqual({ id: 'x' });
    expect(handler.mock.calls[0][0]).toBe(req);
    expect(response.headers.get('server-timing')).toMatch(/^shared;dur=1\.0, auth;dur=\d+\.\d$/);
  });

  it('lets the CI Lighthouse audit through without a session', async () => {
    vi.mocked(isAuthPerformanceBypassEnabled).mockReturnValue(true);
    vi.mocked(getAuthenticatedSession).mockResolvedValue(null);
    const response = await withSession(async (_request: NextRequest) => new Response('ok'))(request());
    expect(response.status).toBe(200);
    expect(getAuthenticatedSession).not.toHaveBeenCalled();
  });

  it('keeps a response whose headers cannot change', async () => {
    vi.mocked(getAuthenticatedSession).mockResolvedValue(SESSION as never);
    const response = await withSession(async (_request: NextRequest) => Response.redirect('https://darts.example/elsewhere', 307))(request());
    expect(response.status).toBe(307);
  });
});
