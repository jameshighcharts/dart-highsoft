/**
 * API routes anyone may call, relative to src/app/api. They authenticate on their own (Slack
 * request signatures, the background-job bearer secret) or are part of signing in. Every other
 * route wraps its handlers in `withSession` (./withSession.ts); apiRoutes.test.ts fails for a
 * route that does neither.
 */
export const PUBLIC_API_ROUTES = [
  'auth/[...nextauth]',
  'auth/slack/callback',
  'background-jobs',
  'highdarts/sheet',
  'slack/darts',
] as const;
