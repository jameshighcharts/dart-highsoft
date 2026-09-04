import { describe, expect, it } from 'vitest';

import {
  getSlackProfileEmail,
  getSlackProfileTeamId,
  getSlackProfileUserId,
  isAdminEmail,
  isAllowedEmailDomain,
  isAllowedSlackWorkspace,
  isSlackEmailVerified,
  parseCommaSeparatedList,
} from './slackWorkspace';

const profile = {
  'https://slack.com/team_id': 'T123',
  'https://slack.com/user_id': 'U456',
  email: ' Ada@Highsoft.com ',
  email_verified: true,
};

describe('slackWorkspace helpers', () => {
  it('parses comma separated env lists', () => {
    expect(parseCommaSeparatedList(' highsoft.com, Highsoft.COM ,,other.no ')).toEqual(['highsoft.com', 'other.no']);
    expect(parseCommaSeparatedList(undefined)).toEqual([]);
  });

  it('reads and normalizes Slack claims', () => {
    expect(getSlackProfileTeamId(profile)).toBe('T123');
    expect(getSlackProfileUserId(profile)).toBe('U456');
    expect(getSlackProfileEmail(profile)).toBe('ada@highsoft.com');
    expect(getSlackProfileTeamId({})).toBeNull();
    expect(getSlackProfileUserId({ 'https://slack.com/user_id': '  ' })).toBeNull();
  });

  it('treats email_verified as verified only when true', () => {
    expect(isSlackEmailVerified(profile)).toBe(true);
    expect(isSlackEmailVerified({ email_verified: 'true' })).toBe(true);
    expect(isSlackEmailVerified({ email_verified: false })).toBe(false);
    expect(isSlackEmailVerified({})).toBe(false);
  });

  it('gates on the configured workspace', () => {
    expect(isAllowedSlackWorkspace(profile, 'T123')).toBe(true);
    expect(isAllowedSlackWorkspace(profile, 'T999')).toBe(false);
    expect(isAllowedSlackWorkspace(profile, null)).toBe(false);
    expect(isAllowedSlackWorkspace(profile, '   ')).toBe(false);
  });

  it('gates on allowed email domains', () => {
    expect(isAllowedEmailDomain('ada@highsoft.com', ['highsoft.com'])).toBe(true);
    expect(isAllowedEmailDomain('ada@nothighsoft.com', ['highsoft.com'])).toBe(false);
    expect(isAllowedEmailDomain('ada@highsoft.com', [])).toBe(false);
    expect(isAllowedEmailDomain(null, ['highsoft.com'])).toBe(false);
  });

  it('fails closed when no admin list is configured', () => {
    expect(isAdminEmail('ada@highsoft.com', [])).toBe(false);
    expect(isAdminEmail('ada@highsoft.com', ['bob@highsoft.com'])).toBe(false);
    expect(isAdminEmail('bob@highsoft.com', ['bob@highsoft.com'])).toBe(true);
    expect(isAdminEmail('BOB@HIGHSOFT.COM', ['bob@highsoft.com'])).toBe(true);
    expect(isAdminEmail(null, ['bob@highsoft.com'])).toBe(false);
  });
});
