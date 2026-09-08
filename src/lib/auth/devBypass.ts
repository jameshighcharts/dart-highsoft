const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);

export function isLoopbackHostname(hostname: string | null | undefined): boolean {
  return Boolean(hostname && LOOPBACK_HOSTNAMES.has(hostname));
}

// Opt-in local preview without Slack. Only active under `next dev`
// (NODE_ENV=development) AND when either AUTH_DEV_BYPASS=1 is set or the
// request is coming from localhost/127.0.0.1. A production build always has
// NODE_ENV=production, so this can never be on in a deployment. Also used by
// the Playwright E2E server (see `dev:test`).
export function isAuthDevBypassEnabled(hostname?: string | null): boolean {
  if (process.env.NODE_ENV !== 'development') return false;
  return process.env.AUTH_DEV_BYPASS === '1' || isLoopbackHostname(hostname);
}

type PerformanceAuditRequest = {
  nextUrl: { hostname: string };
  headers: { get(name: string): string | null };
};

/** Lets the CI runner audit the real home page without weakening a deployment. */
export function isAuthPerformanceBypassEnabled(request: PerformanceAuditRequest): boolean {
  const isLoopback = request.nextUrl.hostname === 'localhost' || request.nextUrl.hostname === '127.0.0.1';
  return (
    process.env.NODE_ENV === 'production'
    && process.env.CI === 'true'
    && process.env.VERCEL !== '1'
    && process.env.AUTH_LHCI_BYPASS === '1'
    && isLoopback
    && request.headers.get('x-hsdart-lighthouse') === 'enabled'
  );
}

export const DEV_BYPASS_USER = {
  name: 'Local dev',
  email: 'dev@localhost',
  image: null,
  slackUserId: 'UDEVLOCAL',
  slackTeamId: process.env.AUTH_SLACK_TEAM_ID?.trim() || 'TDEVLOCAL',
  isAdmin: true,
  provider: 'dev',
} as const;
