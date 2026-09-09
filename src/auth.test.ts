import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextAuthConfig } from 'next-auth';
import type { JWT } from 'next-auth/jwt';

const captured: { config?: NextAuthConfig } = vi.hoisted(() => ({}));
const resolve = vi.hoisted(() => vi.fn());
vi.mock('next-auth', () => ({ default: (config: NextAuthConfig) => { captured.config = config; return {}; } }));
vi.mock('@/lib/slack/members', async (original) => ({
  ...await original<typeof import('@/lib/slack/members')>(), lookupSlackUserIdByEmail: resolve,
}));

beforeEach(async () => {
  vi.resetModules();
  resolve.mockReset();
  vi.stubEnv('AUTH_SLACK_TEAM_ID', 'TWORK');
  vi.stubEnv('AUTH_SLACK_ALLOWED_EMAIL_DOMAINS', 'highsoft.com');
  vi.stubEnv('AUTH_SLACK_ADMIN_EMAILS', 'admin@highsoft.com');
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-09T12:00:00Z'));
  await import('./auth');
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); vi.restoreAllMocks(); });

async function jwt(token: JWT, provider?: 'google' | 'slack') {
  const callback = captured.config?.callbacks?.jwt;
  if (!callback) throw new Error('Missing JWT callback');
  const result = await callback({
    token, user: { id: 'provider-user' },
    account: provider ? { provider, type: 'oidc', providerAccountId: 'provider-user' } : null,
    ...(provider ? { profile: {
      email: 'member@highsoft.com', email_verified: true,
      'https://slack.com/team_id': 'TWORK', 'https://slack.com/user_id': 'USLACK',
    } } : {}),
  });
  if (!result) throw new Error('Missing JWT');
  return result;
}

describe('Google uses the primary Slack identity', () => {
  it('maps Google sign-in to the Slack identity used for existing player links', async () => {
    resolve.mockResolvedValue('USLACK');
    const google = await jwt({}, 'google');
    const slack = await jwt({}, 'slack');
    expect([google.slackTeamId, google.slackUserId]).toEqual([slack.slackTeamId, slack.slackUserId]);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith('member@highsoft.com', 'TWORK');
    expect(google.isAdmin).toBe(false);
  });

  it('recovers an already signed-in Google user after a failed lookup with bounded retries', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    resolve.mockRejectedValueOnce(new Error('offline')).mockResolvedValue('USLACK');
    const token = await jwt({}, 'google');
    expect(token.slackUserId).toBeUndefined();
    await jwt(token);
    expect(resolve).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_001);
    expect((await jwt(token)).slackUserId).toBe('USLACK');
  });

  it('refreshes legacy Google sessions and removes a mapping when Slack no longer confirms it', async () => {
    resolve.mockResolvedValueOnce('USLACK').mockResolvedValue(null);
    const token = await jwt({ provider: 'google', email: 'member@highsoft.com', slackUserId: 'OLD' });
    expect(token.slackUserId).toBe('USLACK');
    await jwt(token);
    expect(resolve).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(300_001);
    expect((await jwt(token)).slackUserId).toBeUndefined();
  });

  it('clears an old identity on provider/account switches, including failed Google lookup', async () => {
    resolve.mockResolvedValue(null);
    const token = await jwt({ slackUserId: 'PREVIOUS', slackTeamId: 'TOLD' }, 'google');
    expect(token.slackUserId).toBeUndefined();
    expect((await jwt(token, 'slack')).slackUserId).toBe('USLACK');
  });

  it('never resolves native Slack sessions through Google email', async () => {
    const token = await jwt({}, 'slack');
    vi.advanceTimersByTime(600_000);
    expect((await jwt(token)).slackUserId).toBe('USLACK');
    expect(resolve).not.toHaveBeenCalled();
  });

  it('does not look up disallowed Google emails or accept an old mapping for them', async () => {
    const token = await jwt({ provider: 'google', email: 'person@example.com', slackUserId: 'OLD' });
    expect(token.slackUserId).toBeUndefined();
    expect(resolve).not.toHaveBeenCalled();
  });
});
