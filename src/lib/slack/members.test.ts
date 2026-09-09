import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn<typeof fetch>();
const member = {
  id: 'U123', team_id: 'TWORK', deleted: false, is_bot: false,
  profile: { email: 'member@highsoft.com' },
};

async function lookup() {
  return (await import('./members')).lookupSlackUserIdByEmail;
}

function reply(user = member) {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true, user })));
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('SLACK_BOT_TOKEN', 'test-bot');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Slack identity lookup', () => {
  it('normalizes email, validates workspace and shares concurrent lookups', async () => {
    reply();
    const resolve = await lookup();
    expect(await Promise.all([resolve(' Member@Highsoft.com ', 'TWORK'), resolve('member@highsoft.com', 'TWORK')])).toEqual(['U123', 'U123']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ body: 'email=member%40highsoft.com', cache: 'no-store', signal: expect.any(AbortSignal) });
  });

  it.each([
    { team_id: 'TOTHER' }, { profile: { email: 'someone@highsoft.com' } },
    { deleted: true }, { is_bot: true }, { is_app_user: true },
    { is_restricted: true }, { is_ultra_restricted: true },
  ])('rejects an ineligible Slack account: %j', async (overrides) => {
    reply({ ...member, ...overrides });
    expect(await (await lookup())('member@highsoft.com', 'TWORK')).toBeNull();
  });

  it.each([null, {}, { ok: true }, { ok: true, user: { id: 'U123' } }])('rejects malformed responses: %j', async (body) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(body)));
    await expect((await lookup())('member@highsoft.com', 'TWORK')).rejects.toMatchObject({ reason: 'invalid_response' });
  });

  it('distinguishes missing configuration, scopes, rate limits and absent members', async () => {
    const resolve = await lookup();
    vi.stubEnv('SLACK_BOT_TOKEN', '');
    await expect(resolve('member@highsoft.com', 'TWORK')).rejects.toMatchObject({ reason: 'not_configured' });
    vi.stubEnv('SLACK_BOT_TOKEN', 'scope-test');
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: false, error: 'missing_scope' })));
    await expect(resolve('member@highsoft.com', 'TWORK')).rejects.toMatchObject({ reason: 'missing_scope' });
    vi.stubEnv('SLACK_BOT_TOKEN', 'rate-test');
    fetchMock.mockResolvedValue(new Response('', { status: 429 }));
    await expect(resolve('member@highsoft.com', 'TWORK')).rejects.toMatchObject({ reason: 'rate_limited' });
    vi.stubEnv('SLACK_BOT_TOKEN', 'not-found-test');
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: false, error: 'users_not_found' })));
    expect(await resolve('member@highsoft.com', 'TWORK')).toBeNull();
  });

  it('backs off after transport failure and recovers after the cache expires', async () => {
    vi.useFakeTimers();
    const resolve = await lookup();
    fetchMock.mockRejectedValue(new Error('network unavailable'));
    await expect(resolve('member@highsoft.com', 'TWORK')).rejects.toThrow();
    await expect(resolve('member@highsoft.com', 'TWORK')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_001);
    reply();
    expect(await resolve('member@highsoft.com', 'TWORK')).toBe('U123');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
