// Opt-in local preview without Slack. Only active under `next dev`
// (NODE_ENV=development) AND when AUTH_DEV_BYPASS=1 is set. A production
// build always has NODE_ENV=production, so this can never be on in a
// deployment. Also used by the Playwright E2E server (see `dev:test`).
export function isAuthDevBypassEnabled(): boolean {
  return process.env.NODE_ENV === 'development' && process.env.AUTH_DEV_BYPASS === '1';
}

export const DEV_BYPASS_USER = {
  name: 'Local dev',
  email: 'dev@localhost',
  image: null,
  slackUserId: 'UDEVLOCAL',
  slackTeamId: process.env.AUTH_SLACK_TEAM_ID?.trim() || 'TDEVLOCAL',
  isAdmin: true,
} as const;
