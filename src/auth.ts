import NextAuth from 'next-auth';
import type { NextAuthConfig, Session } from 'next-auth';
import Google from 'next-auth/providers/google';
import Slack from 'next-auth/providers/slack';

import { DEV_BYPASS_USER, isAuthDevBypassEnabled } from '@/lib/auth/devBypass';
import {
  getSlackProfileEmail,
  getSlackProfileTeamId,
  getSlackProfileUserId,
  isAdminEmail,
  isAllowedEmailDomain,
  isAllowedSlackWorkspace,
  isProfileEmailVerified,
  normalizeSlackTeamId,
  parseCommaSeparatedList,
} from '@/lib/auth/slackWorkspace';
import { lookupSlackUserIdByEmail, SlackIdentityLookupError } from '@/lib/slack/members';

// Same env contract as the Compass app so one Slack app, one Google OAuth
// client and one .env block work for both.
//   Slack:  redirect URL https://YOUR_APP/api/auth/callback/slack
//   Google: redirect URL https://YOUR_APP/api/auth/callback/google
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

// Google reuses the shared allowed-domain list (mirrors Compass). Player
// linking still needs the Slack team id, so it is required here too.
export const isGoogleAuthConfigured = Boolean(
  process.env.AUTH_SECRET &&
    process.env.AUTH_GOOGLE_ID &&
    process.env.AUTH_GOOGLE_SECRET &&
    allowedSlackTeamId &&
    allowedEmailDomains.length > 0,
);

export const isAuthConfigured = isSlackAuthConfigured || isGoogleAuthConfigured;

export const slackTeamId = allowedSlackTeamId;

// Soft hint so Google's account picker opens the work domain first. Cosmetic;
// the signIn callback is the real gate.
const googleHostedDomainHint = allowedEmailDomains[0];

const providers: NextAuthConfig['providers'] = [];
if (isSlackAuthConfigured && allowedSlackTeamId) {
  providers.push(
    Slack({
      authorization: {
        params: {
          // Hint Slack to open the approved workspace first. Cosmetic.
          team: allowedSlackTeamId,
        },
      },
    }),
  );
}
if (isGoogleAuthConfigured) {
  providers.push(
    Google({
      authorization: {
        params: {
          scope: 'openid email profile',
          ...(googleHostedDomainHint ? { hd: googleHostedDomainHint } : {}),
        },
      },
    }),
  );
}

const config: NextAuthConfig = {
  providers,
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider === 'google') {
        if (!isProfileEmailVerified(profile)) return '/login?error=GoogleEmailNotVerified';
        if (!isAllowedEmailDomain(getSlackProfileEmail(profile), allowedEmailDomains)) {
          return '/login?error=GoogleEmailDomainRestricted';
        }
        return true;
      }
      if (account?.provider !== 'slack') return false;
      if (!isAllowedSlackWorkspace(profile, allowedSlackTeamId)) {
        return '/login?error=SlackWorkspaceRestricted';
      }
      if (!isProfileEmailVerified(profile)) {
        return '/login?error=SlackEmailNotVerified';
      }
      if (!isAllowedEmailDomain(getSlackProfileEmail(profile), allowedEmailDomains)) {
        return '/login?error=SlackEmailDomainRestricted';
      }
      if (!getSlackProfileUserId(profile)) {
        return '/login?error=SlackProfileIncomplete';
      }
      return true;
    },
    async jwt({ token, account, profile }) {
      if (profile) {
        const email = getSlackProfileEmail(profile);
        if (email) token.email = email;
        token.provider = account?.provider;
        delete token.slackUserId;
        delete token.slackTeamId;
        delete token.slackIdentityCheckedAt;
        if (account?.provider === 'slack') {
          const slackUserId = getSlackProfileUserId(profile);
          const slackTeamIdClaim = getSlackProfileTeamId(profile);
          if (slackUserId) token.slackUserId = slackUserId;
          if (slackTeamIdClaim) token.slackTeamId = slackTeamIdClaim;
        }
      }
      if (!token.slackTeamId && allowedSlackTeamId) token.slackTeamId = allowedSlackTeamId;
      if (token.provider === 'google') {
        const email = getSlackProfileEmail(token);
        if (!email || !isAllowedEmailDomain(email, allowedEmailDomains) || !allowedSlackTeamId) {
          delete token.slackUserId;
        } else {
          const refreshAfter = token.slackUserId ? 5 * 60_000 : 60_000;
          if (profile || token.slackTeamId !== allowedSlackTeamId || !token.slackIdentityCheckedAt
            || Date.now() - token.slackIdentityCheckedAt >= refreshAfter) {
            token.slackTeamId = allowedSlackTeamId;
            delete token.slackUserId;
            token.slackIdentityCheckedAt = Date.now();
            try {
              token.slackUserId = (await lookupSlackUserIdByEmail(email, allowedSlackTeamId)) ?? undefined;
            } catch (error) {
              console.warn('Google Slack identity lookup failed', {
                reason: error instanceof SlackIdentityLookupError ? error.reason : 'unavailable',
              });
            }
          }
        }
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
      session.user.provider = typeof token.provider === 'string' ? token.provider : null;
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(config);

/**
 * Session for a member who passed the provider gate (verified work email in
 * the workspace), or null. `slackUserId` may be null for Google sign-ins whose
 * Slack account could not be resolved by email.
 */
export async function getAuthenticatedSession(): Promise<Session | null> {
  if (isAuthDevBypassEnabled()) {
    return { user: { ...DEV_BYPASS_USER }, expires: new Date(Date.now() + 60 * 60 * 1000).toISOString() };
  }
  if (!isAuthConfigured) return null;
  const session = await auth();
  if (!session?.user?.email || !session.user.slackTeamId) return null;
  return session;
}
