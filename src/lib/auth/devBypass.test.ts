import { afterEach, describe, expect, it, vi } from 'vitest';

import { isAuthDevBypassEnabled, isAuthPerformanceBypassEnabled } from './devBypass';

function request(hostname: string, header = 'enabled') {
  return {
    nextUrl: { hostname },
    headers: new Headers({ 'x-hsdart-lighthouse': header }),
  };
}

describe('isAuthPerformanceBypassEnabled', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('permits the explicit local production audit', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CI', 'true');
    vi.stubEnv('AUTH_LHCI_BYPASS', '1');
    vi.stubEnv('VERCEL', '');

    expect(isAuthPerformanceBypassEnabled(request('localhost'))).toBe(true);
  });

  it('stays disabled on Vercel and non-loopback hosts', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CI', 'true');
    vi.stubEnv('AUTH_LHCI_BYPASS', '1');
    vi.stubEnv('VERCEL', '1');

    expect(isAuthPerformanceBypassEnabled(request('localhost'))).toBe(false);
    vi.stubEnv('VERCEL', '');
    expect(isAuthPerformanceBypassEnabled(request('hsdart.vercel.app'))).toBe(false);
  });

  it('requires the audit flag and request header', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CI', 'true');
    vi.stubEnv('VERCEL', '');

    expect(isAuthPerformanceBypassEnabled(request('localhost'))).toBe(false);
    vi.stubEnv('AUTH_LHCI_BYPASS', '1');
    expect(isAuthPerformanceBypassEnabled(request('localhost', 'wrong'))).toBe(false);
  });
});

describe('isAuthDevBypassEnabled', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('never enables preview identity overrides in production', () => {
    vi.stubEnv('AUTH_DEV_BYPASS', '1');
    vi.stubEnv('AUTH_DEV_SLACK_USER_ID', 'UPREVIEW');
    vi.stubEnv('NODE_ENV', 'production');
    expect(isAuthDevBypassEnabled()).toBe(false);
    vi.stubEnv('NODE_ENV', 'development');
    expect(isAuthDevBypassEnabled()).toBe(true);
    vi.stubEnv('AUTH_DEV_BYPASS', '');
    expect(isAuthDevBypassEnabled()).toBe(false);
  });
});
