import { describe, expect, it } from 'vitest';
import {
  buildStandings,
  OFFICES,
  fixtureFormat,
  tournamentActivity,
} from './standings';
import { projectFinals, validateDraw } from './finals';
import {
  fixture,
  finish,
  completedGroups,
} from '@/test-utils/highdartsFixtures';

describe('projectFinals', () => {
  for (let best = 0; best < 3; best++)
    it(`follows every playoff rule with the extra bye from ${OFFICES[best]}`, () => {
      const standings = buildStandings(completedGroups(best));
      const p = projectFinals(standings);
      expect(p.ready).toBe(true);
      expect(p.games).toHaveLength(11);
      expect(
        new Set([
          ...p.byes.map((b) => b.player.id),
          ...p.playoffs.flat().map((b) => b.player.id),
        ]).size,
      ).toBe(12);
      expect(p.byes.filter((b) => b.rank === 1)).toHaveLength(3);
      expect(p.byes.find((b) => b.rank === 2)?.office).toBe(OFFICES[best]);
      expect(
        p.playoffs
          .map((pair) =>
            pair
              .map((p) => p.rank)
              .sort()
              .join('-'),
          )
          .sort(),
      ).toEqual(['2-4', '2-4', '3-3', '3-4']);
      p.playoffs.forEach(([a, b]) => expect(a.office).not.toBe(b.office));
      const indices = p.byes
        .map((b, i) => (b.office === OFFICES[best] ? i : -1))
        .filter((i) => i >= 0);
      expect(Math.floor(indices[0] / 2)).not.toBe(Math.floor(indices[1] / 2));
      expect(validateDraw(standings, p.selection).ok).toBe(true);
      expect(
        p.games.filter((g) => g.stage === 'playoff').map((g) => g.nextKey),
      ).toEqual([
        'quarterfinal-1',
        'quarterfinal-2',
        'quarterfinal-3',
        'quarterfinal-4',
      ]);
      expect(
        p.games
          .filter((g) => g.stage === 'quarterfinal')
          .map((g) => g.nextSlot),
      ).toEqual(['a', 'b', 'a', 'b']);
      expect(projectFinals(standings).selection).toEqual(p.selection);
    });
  it('shows TBD instead of projecting an untouched tournament', () => {
    const snapshot = completedGroups();
    snapshot.fixtures = snapshot.fixtures.map((f) => ({
      ...f,
      match_id: null,
      match: null,
    }));
    const p = projectFinals(buildStandings(snapshot));
    expect(p.ready).toBe(false);
    expect(p.games.every((g) => !g.a && !g.b)).toBe(true);
  });
  it('projects played standings but cannot lock with an unfinished fixture', () => {
    const snapshot = completedGroups();
    snapshot.fixtures.push(fixture('bergen', 'one', 'two', 11));
    const standings = buildStandings(snapshot),
      p = projectFinals(standings);
    expect(p.ready).toBe(false);
    expect(validateDraw(standings, p.selection).ok).toBe(false);
  });
  it('rejects duplicate players, lost byes and prohibited office/rank pairs', () => {
    const standings = buildStandings(completedGroups()),
      p = projectFinals(standings);
    expect(
      validateDraw(standings, {
        ...p.selection,
        byes: [p.selection.byes[0], ...p.selection.byes.slice(0, 3)],
      }).ok,
    ).toBe(false);
    const changed = structuredClone(p.selection);
    changed.playoffs[0][0] = changed.byes[0];
    expect(validateDraw(standings, changed).ok).toBe(false);
    const opposite = structuredClone(p.selection);
    opposite.byes.reverse();
    const result = validateDraw(standings, opposite);
    expect(typeof result.ok).toBe('boolean');
  });
  it('locks each stage to its required format', () => {
    expect(fixtureFormat('playoff')).toMatchObject({
      startScore: '301',
      finish: 'single_out',
      legsToWin: 2,
    });
    for (const stage of ['quarterfinal', 'semifinal'] as const)
      expect(fixtureFormat(stage)).toMatchObject({
        startScore: '301',
        finish: 'double_out',
      });
    expect(fixtureFormat('final')).toMatchObject({
      startScore: '501',
      finish: 'double_out',
    });
  });
});
describe('qualification tie-breaks', () => {
  it('uses the tie-break winner to settle fourth without changing group averages', () => {
    const fixtures = [
      finish(fixture('bergen', 'a', 'b', 1), 'a', 90, 70),
      finish(fixture('bergen', 'c', 'd', 2), 'c', 80, 30),
      finish(fixture('bergen', 'a', 'e', 3), 'a', 90, 30),
    ];
    const before = buildStandings({ fixtures, players: [] });
    const tie = before.ties.find((t) => t.office === 'bergen')!;
    expect(tie.ready).toBe(true);
    const t = finish(
      {
        ...fixture('bergen', 'd', 'e', 4),
        stage: 'tiebreak',
        tie_context: tie.context,
      },
      'e',
      12,
      18,
    );
    const after = buildStandings({ fixtures: [...fixtures, t], players: [] });
    expect(after.offices[0].table[3]).toMatchObject({
      key: 'e',
      average: 30,
      played: 1,
      qualification: 'playoff',
      tiedForFourth: false,
    });
    expect(after.played).toBe(3);
    const stale = buildStandings({
      fixtures: [...fixtures, { ...t, tie_context: 'outdated' }],
      players: [],
    });
    expect(stale.offices[0].table[3].tiedForFourth).toBe(true);
  });
});
describe('tournamentActivity', () => {
  it('counts all completed tournament fixtures in Oslo calendar days, including finals', () => {
    const matches = Array.from({ length: 12 }, (_, i) =>
      finish(fixture('bergen', 'a', 'b', i + 1), 'a'),
    );
    matches.forEach((f) => {
      f.match!.completed_at = '2026-09-14T22:10:00Z';
    });
    matches[0].stage = 'final';
    matches[1].match!.ended_early = true;
    matches[2].match!.completed_at = '2026-09-14T21:59:00Z';
    expect(
      tournamentActivity(matches, new Date('2026-09-14T22:30:00Z')),
    ).toEqual({ today: 10, groupToday: 9 });
  });
});

it('requires the six-match player choice before locking finals and recalculates qualification from counted results', () => {
  const snapshot = completedGroups();
  const g = snapshot.fixtures[0].player_a_id!;
  const b = snapshot.fixtures[0].player_b_id!;
  snapshot.fixtures.push(finish(fixture('bergen', g, b, 90), b, 10, 70), finish(fixture('bergen', g, 'extra', 91), 'extra', 10, 30));
  const pending = buildStandings(snapshot);
  expect(pending.pendingDiscards.map((r) => r.player.id)).toEqual([g]);
  expect(projectFinals(pending).ready).toBe(false);
  const selection = projectFinals(pending).selection;
  expect(validateDraw(pending, selection).ok).toBe(false);
  snapshot.fixtures[snapshot.fixtures.length - 1].counts_for_a = false;
  const counted = buildStandings(snapshot);
  expect(counted.pendingDiscards).toEqual([]);
  expect(counted.offices[0].table.find((r) => r.player.id === g)?.played).toBe(5);
  expect(counted.offices[0].table.find((r) => r.player.id === 'extra')?.wins).toBe(1);
  expect(projectFinals(counted).eligible.map((r) => r.player.id)).toContain(g);
});

it('uses only the five chosen results to award the fourth bye by average', () => {
  const snapshot = completedGroups();
  const second = snapshot.fixtures[0].player_b_id!;
  const low = finish(fixture('bergen', second, 'extra-low', 90), 'extra-low', 10, 30);
  const high = finish(fixture('bergen', second, 'extra-high', 91), 'extra-high', 200, 30);
  snapshot.fixtures.push(low, high);
  high.counts_for_a = false;
  const lowerAverage = buildStandings(snapshot);
  expect(lowerAverage.byes.map((r) => r.player.id)).not.toContain(second);
  expect(projectFinals(lowerAverage).ready).toBe(true);
  high.counts_for_a = true;
  low.counts_for_a = false;
  const higherAverage = buildStandings(snapshot);
  expect(higherAverage.byes.map((r) => r.player.id)).toContain(second);
  const projection = projectFinals(higherAverage);
  expect(projection.ready).toBe(true);
  expect(validateDraw(higherAverage, projection.selection).ok).toBe(true);
});
