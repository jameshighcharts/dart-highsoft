import 'server-only';

import { NextResponse } from 'next/server';
import type { Session } from 'next-auth';

import { getAuthenticatedSession, isSlackAuthConfigured } from '@/auth';
import { isAuthDevBypassEnabled } from '@/lib/auth/devBypass';

export type AdminSession = Session & {
  user: Session['user'] & { slackUserId: string; slackTeamId: string };
};

/**
 * Guard for /api/admin routes. The proxy already redirects anonymous
 * requests, but every handler re-checks so the API fails closed on its own.
 */
export async function requireAdmin(): Promise<AdminSession | NextResponse> {
  if (!isSlackAuthConfigured && !isAuthDevBypassEnabled()) {
    return NextResponse.json({ error: 'Slack sign-in is not configured' }, { status: 503 });
  }
  const session = await getAuthenticatedSession();
  if (!session?.user.slackUserId || !session.user.slackTeamId) {
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

export type UserSession = AdminSession;

/** Guard for self-service routes: any signed-in, fully identified workspace member. */
export async function requireUser(): Promise<UserSession | NextResponse> {
  if (!isSlackAuthConfigured && !isAuthDevBypassEnabled()) {
    return NextResponse.json({ error: 'Slack sign-in is not configured' }, { status: 503 });
  }
  const session = await getAuthenticatedSession();
  if (!session?.user.slackUserId || !session.user.slackTeamId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return session as UserSession;
}
