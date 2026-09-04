import { describe, expect, it } from 'vitest';

import type { SlackMember } from './members';
import { planSlackPlayerImport, preferredPlayerNames } from './playerImport';

function member(id: string, realName: string, extra: Partial<SlackMember> = {}): SlackMember {
  return { id, realName, firstName: null, lastName: null, displayName: null, email: null, ...extra };
}

describe('preferredPlayerNames', () => {
  it('uses the first name when it is unique', () => {
    const names = preferredPlayerNames([member('U1', 'James Haugen'), member('U2', 'Ada Lovelace')]);
    expect(names.get('U1')).toBe('James');
    expect(names.get('U2')).toBe('Ada');
  });

  it('adds the last-name initial for duplicate first names', () => {
    const names = preferredPlayerNames([
      member('U1', 'James Haugen'),
      member('U2', 'James Bond'),
      member('U3', 'Torstein Hønsi'),
    ]);
    expect(names.get('U1')).toBe('James H');
    expect(names.get('U2')).toBe('James B');
    expect(names.get('U3')).toBe('Torstein');
  });

  it('prefers the profile first/last name fields and matches case-insensitively', () => {
    const names = preferredPlayerNames([
      member('U1', 'Ola Nordmann', { firstName: 'Ola', lastName: 'Nordmann' }),
      member('U2', 'ola hansen'),
    ]);
    expect(names.get('U1')).toBe('Ola N');
    expect(names.get('U2')).toBe('ola H');
  });

  it('falls back to the full name when initials also collide', () => {
    const names = preferredPlayerNames([member('U1', 'Anna Berg'), member('U2', 'Anna Bakke'), member('U3', 'Anna Lund')]);
    expect(names.get('U1')).toBe('Anna Berg');
    expect(names.get('U2')).toBe('Anna Bakke');
    expect(names.get('U3')).toBe('Anna L');
  });

  it('uses the whole name when there is no last name', () => {
    const names = preferredPlayerNames([member('U1', 'Cher'), member('U2', 'Cher Bono')]);
    expect(names.get('U1')).toBe('Cher');
    expect(names.get('U2')).toBe('Cher B');
  });
});

describe('planSlackPlayerImport', () => {
  const members = [member('U1', 'James Haugen'), member('U2', 'Ada Lovelace'), member('U3', 'Bob Ross')];

  it('links existing unlinked players with the same name and creates the rest', () => {
    const plan = planSlackPlayerImport(
      members,
      [{ id: 'p-james', display_name: 'james' }],
      [],
    );
    expect(plan.link).toEqual([{ slackUserId: 'U1', playerId: 'p-james', displayName: 'james' }]);
    expect(plan.create).toEqual([
      { slackUserId: 'U2', displayName: 'Ada' },
      { slackUserId: 'U3', displayName: 'Bob' },
    ]);
    expect(plan.alreadyLinked).toEqual([]);
  });

  it('skips members that already have a link', () => {
    const plan = planSlackPlayerImport(members, [{ id: 'p1', display_name: 'James' }], [
      { slack_user_id: 'U1', player_id: 'p1' },
    ]);
    expect(plan.alreadyLinked).toEqual(['U1']);
    expect(plan.link).toEqual([]);
    expect(plan.create.map((entry) => entry.slackUserId)).toEqual(['U2', 'U3']);
  });

  it('never reuses a player that is linked to someone else', () => {
    const plan = planSlackPlayerImport(
      [member('U9', 'James Haugen')],
      [{ id: 'p1', display_name: 'James' }, { id: 'p2', display_name: 'James Haugen' }],
      [{ slack_user_id: 'U1', player_id: 'p1' }, { slack_user_id: 'U2', player_id: 'p2' }],
    );
    expect(plan.link).toEqual([]);
    expect(plan.create).toEqual([{ slackUserId: 'U9', displayName: 'James Haugen (U9)' }]);
  });

  it('avoids creating duplicate display names within one run', () => {
    const plan = planSlackPlayerImport(
      [member('U1', 'Kim'), member('U2', 'Kim Lee')],
      [],
      [],
    );
    expect(plan.create.map((entry) => entry.displayName)).toEqual(['Kim', 'Kim L']);
  });
});
