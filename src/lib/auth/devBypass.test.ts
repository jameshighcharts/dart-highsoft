import { afterEach, describe, expect, it, vi } from 'vitest';

import { isAuthPerformanceBypassEnabled } from './devBypass';

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
