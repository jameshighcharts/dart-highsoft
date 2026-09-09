import 'server-only';

import { NextResponse } from 'next/server';
import type { Session } from 'next-auth';

import { getAuthenticatedSession, isAuthConfigured } from '@/auth';
import { isAuthDevBypassEnabled } from '@/lib/auth/devBypass';

export type AdminSession = Session & {
  user: Session['user'] & { slackTeamId: string };
};

/**
 * Guard for /api/admin routes. The proxy already redirects anonymous
 * requests, but every handler re-checks so the API fails closed on its own.
 */
export async function requireAdmin(): Promise<AdminSession | NextResponse> {
  if (!isAuthConfigured && !isAuthDevBypassEnabled()) {
    return NextResponse.json({ error: 'Sign-in is not configured' }, { status: 503 });
  }
  const session = await getAuthenticatedSession();
  if (!session?.user.email || !session.user.slackTeamId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!session.user.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return session as AdminSession;
}

export function isGuardResponse(value: AdminSession | NextResponse): value is NextResponse {
  return value instanceof NextResponse;
}

export type UserSession = Session & {
  user: Session['user'] & { slackUserId: string; slackTeamId: string };
};

export const NO_SLACK_IDENTITY_ERROR =
  'Your Google email could not be matched to an active Highsoft Slack account. Sign in with Slack to use your existing player, or retry in a minute. If this continues, ask an admin to check that your Slack and Google emails match and that the Slack app has email lookup access.';

/**
 * Guard for self-service routes: a signed-in member whose Slack identity is
 * known (native Slack sign-in, or Google sign-in resolved by email). Player
 * links are keyed on the Slack user id, so without it there is nothing to edit.
 */
export async function requireUser(): Promise<UserSession | NextResponse> {
  if (!isAuthConfigured && !isAuthDevBypassEnabled()) {
    return NextResponse.json({ error: 'Sign-in is not configured' }, { status: 503 });
  }
  const session = await getAuthenticatedSession();
  if (!session?.user.email || !session.user.slackTeamId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!session.user.slackUserId) {
    return NextResponse.json({ error: NO_SLACK_IDENTITY_ERROR, code: 'NO_SLACK_IDENTITY' }, { status: 409 });
  }
  return session as UserSession;
}
