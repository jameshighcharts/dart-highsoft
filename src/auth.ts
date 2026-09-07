import NextAuth from 'next-auth';
import type { NextAuthConfig, Session } from 'next-auth';
import Slack from 'next-auth/providers/slack';

import { DEV_BYPASS_USER, isAuthDevBypassEnabled } from '@/lib/auth/devBypass';

import {
  getSlackProfileEmail,
  getSlackProfileTeamId,
  getSlackProfileUserId,
  isAdminEmail,
  isAllowedEmailDomain,
  isAllowedSlackWorkspace,
  isSlackEmailVerified,
  normalizeSlackTeamId,
  parseCommaSeparatedList,
} from '@/lib/auth/slackWorkspace';

// Same env contract as the Compass app so one Slack app + one .env block
// works for both. Sign in with Slack (OpenID Connect) needs the redirect URL
// https://YOUR_APP/api/auth/callback/slack registered on the Slack app.
const allowedSlackTeamId = normalizeSlackTeamId(process.env.AUTH_SLACK_TEAM_ID);
const allowedEmailDomains = parseCommaSeparatedList(process.env.AUTH_SLACK_ALLOWED_EMAIL_DOMAINS);
const adminEmails = parseCommaSeparatedList(process.env.AUTH_SLACK_ADMIN_EMAILS);

export const isSlackAuthConfigured = Boolean(
  process.env.AUTH_SECRET &&
    process.env.AUTH_SLACK_ID &&
    process.env.AUTH_SLACK_SECRET &&
    allowedSlackTeamId &&
    allowedEmailDomains.length > 0,
);

export const slackTeamId = allowedSlackTeamId;

const config: NextAuthConfig = {
  providers: isSlackAuthConfigured && allowedSlackTeamId
    ? [
        Slack({
          authorization: {
            params: {
              // Hint Slack to open the approved workspace first. Cosmetic; the
              // signIn callback below is the real gate.
              team: allowedSlackTeamId,
            },
          },
        }),
      ]
    : [],
  session: { strategy: 'jwt' },
  pages: { signIn: '/signin' },
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider !== 'slack') return false;
      if (!isAllowedSlackWorkspace(profile, allowedSlackTeamId)) {
        return '/signin?error=SlackWorkspaceRestricted';
      }
      if (!isSlackEmailVerified(profile)) {
        return '/signin?error=SlackEmailNotVerified';
      }
      if (!isAllowedEmailDomain(getSlackProfileEmail(profile), allowedEmailDomains)) {
        return '/signin?error=SlackEmailDomainRestricted';
      }
      if (!getSlackProfileUserId(profile)) {
        return '/signin?error=SlackProfileIncomplete';
      }
      return true;
    },
    async jwt({ token, profile }) {
      if (profile) {
        const email = getSlackProfileEmail(profile);
        const slackUserId = getSlackProfileUserId(profile);
        const slackTeamIdClaim = getSlackProfileTeamId(profile);
        if (email) token.email = email;
        if (slackUserId) token.slackUserId = slackUserId;
        if (slackTeamIdClaim) token.slackTeamId = slackTeamIdClaim;
      }
      token.isAdmin = isAdminEmail(typeof token.email === 'string' ? token.email : null, adminEmails);
      return token;
    },
    async session({ session, token }) {
      if (!session.user) return session;
      if (typeof token.email === 'string') session.user.email = token.email;
      session.user.slackUserId = typeof token.slackUserId === 'string' ? token.slackUserId : null;
      session.user.slackTeamId = typeof token.slackTeamId === 'string' ? token.slackTeamId : null;
      session.user.isAdmin = token.isAdmin === true;
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(config);

/** Session with a fully identified Slack user, or null. */
export async function getAuthenticatedSession(): Promise<Session | null> {
  if (isAuthDevBypassEnabled()) {
    return { user: { ...DEV_BYPASS_USER }, expires: new Date(Date.now() + 60 * 60 * 1000).toISOString() };
  }
  if (!isSlackAuthConfigured) return null;
  const session = await auth();
  if (!session?.user?.slackUserId || !session.user.slackTeamId) return null;
  return session;
}
