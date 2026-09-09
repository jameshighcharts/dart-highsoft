import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from 'next-auth';

const getSession = vi.hoisted(() => vi.fn<() => Promise<Session | null>>());
vi.mock('@/auth', () => ({ getAuthenticatedSession: getSession, isAuthConfigured: true }));
vi.mock('@/lib/auth/devBypass', () => ({ isAuthDevBypassEnabled: () => false }));
import { isGuardResponse, requireAdmin, requireUser } from './requireAdmin';

const session: Session = {
  expires: '2099-01-01T00:00:00Z',
  user: { email: 'member@highsoft.com', provider: 'google', slackTeamId: 'TWORK', slackUserId: 'USLACK', isAdmin: false },
};
beforeEach(() => getSession.mockReset());

describe('primary Slack player identity guards', () => {
  it('passes the mapped workspace and Slack ID to self-service routes', async () => {
    getSession.mockResolvedValue(session);
    const result = await requireUser();
    expect(isGuardResponse(result)).toBe(false);
    if (isGuardResponse(result)) throw new Error('Unexpected refusal');
    expect(result.user.slackUserId).toBe('USLACK');
    expect(result.user.slackTeamId).toBe('TWORK');
  });

  it('keeps unmatched Google users away from player mutations without redirecting', async () => {
    getSession.mockResolvedValue({ ...session, user: { ...session.user, slackUserId: null } });
    const result = await requireUser();
    if (!isGuardResponse(result)) throw new Error('Unexpected access');
    expect(result.status).toBe(409);
    expect(result.headers.get('location')).toBeNull();
    expect(await result.json()).toMatchObject({ code: 'NO_SLACK_IDENTITY' });
  });

  it('does not promote matched Google users to admin', async () => {
    getSession.mockResolvedValue(session);
    const result = await requireAdmin();
    if (!isGuardResponse(result)) throw new Error('Unexpected admin access');
    expect(result.status).toBe(403);
  });
});
