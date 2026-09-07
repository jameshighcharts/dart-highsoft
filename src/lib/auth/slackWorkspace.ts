// Pure helpers for the Slack sign-in gate. Mirrors the Compass app: a user may
// sign in only when their Slack profile belongs to the configured workspace and
// carries a verified email on an allowed domain.

export const SLACK_TEAM_ID_CLAIM = 'https://slack.com/team_id';
export const SLACK_USER_ID_CLAIM = 'https://slack.com/user_id';

export type SlackClaims = Partial<Record<string, unknown>> | null | undefined;

export function normalizeSlackTeamId(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function normalizeEmailAddress(value?: string | null): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

export function parseCommaSeparatedList(value?: string | null): string[] {
  if (!value) return [];
  return Array.from(
    new Set(
      value
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

export function getSlackProfileTeamId(profile: SlackClaims): string | null {
  const teamId = profile?.[SLACK_TEAM_ID_CLAIM];
  return typeof teamId === 'string' ? normalizeSlackTeamId(teamId) : null;
}

export function getSlackProfileUserId(profile: SlackClaims): string | null {
  const userId = profile?.[SLACK_USER_ID_CLAIM];
  const normalized = typeof userId === 'string' ? userId.trim() : '';
  return normalized ? normalized : null;
}

export function getSlackProfileEmail(profile: SlackClaims): string | null {
  const email = profile?.email;
  return typeof email === 'string' ? normalizeEmailAddress(email) : null;
}

export function isSlackEmailVerified(profile: SlackClaims): boolean {
  const verified: unknown = profile?.email_verified;
  return verified === true || verified === 'true';
}

export function isAllowedSlackWorkspace(profile: SlackClaims, allowedTeamId: string | null): boolean {
  const normalizedAllowedTeamId = normalizeSlackTeamId(allowedTeamId);
  if (!normalizedAllowedTeamId) return false;
  return getSlackProfileTeamId(profile) === normalizedAllowedTeamId;
}

export function isAllowedEmailDomain(email: string | null, allowedDomains: string[]): boolean {
  if (!email || allowedDomains.length === 0) return false;
  return allowedDomains.some((domain) => email.endsWith(`@${domain}`));
}

export function isAdminEmail(email: string | null, adminEmails: string[]): boolean {
  if (!email || adminEmails.length === 0) return false;
  return adminEmails.includes(email.toLowerCase());
}
