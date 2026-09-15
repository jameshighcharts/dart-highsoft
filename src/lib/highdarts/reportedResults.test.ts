import { describe, expect, it } from 'vitest';
import { fixture, finish } from '@/test-utils/highdartsFixtures';
import { buildStandings, isCompleted, resultStats, tournamentActivity } from './standings';
import { projectFinals, validateDraw } from './finals';
import { REPORTED_RESULTS, withReportedResults } from './reportedResults';

function reportedSnapshot() {
  return {
    players: [],
    fixtures: [
      fixture('sogndal', 'Sindre Jensen', 'Jon Skjerdal', 1),
      fixture('sogndal', 'Johan Flo', 'Jon Skjerdal', 12),
      fixture('sogndal', 'Jon Skjerdal', 'Johan Flo', 13),
      fixture('sogndal', 'Johan Flo', 'Sindre Jensen', 6),
    ],
  };
}

describe('Bengt screenshot results', () => {
  it('counts exactly two matches, preserves the second Johan meeting and never invents dates or averages', () => {
    const original = reportedSnapshot();
    const snapshot = withReportedResults(original);
    expect(original.fixtures.every((f) => !isCompleted(f))).toBe(true);
    expect(snapshot.fixtures.filter(isCompleted)).toHaveLength(2);
    expect(snapshot.fixtures[2]).toBe(original.fixtures[2]);
    expect(snapshot.fixtures[3]).toBe(original.fixtures[3]);
    const data = buildStandings(snapshot);
    const rows = data.offices.find((o) => o.office === 'sogndal')?.table;
    expect(rows?.find((r) => r.key === 'Jon Skjerdal')).toMatchObject({ played: 2, wins: 1, losses: 1, legsFor: 3, legsAgainst: 3, averageIncomplete: true, remaining: 1 });
    expect(rows?.find((r) => r.key === 'Johan Flo')).toMatchObject({ wins: 0, losses: 1, legsFor: 1, legsAgainst: 2 });
    expect(rows?.find((r) => r.key === 'Sindre Jensen')).toMatchObject({ wins: 1, losses: 0, legsFor: 2, legsAgainst: 1 });
    expect(data.byes).toEqual([]);
    expect(data.ties).toEqual([]);
    expect(resultStats(snapshot.fixtures[0], 'Jon Skjerdal').averageIncomplete).toBe(true);
    expect(tournamentActivity(snapshot.fixtures).today).toBe(0);
    expect(withReportedResults(snapshot)).toEqual(snapshot);
  });

  it('retains canonical results and active matches, and requires the exact scheduled pair with linked identities', () => {
    const snapshot = reportedSnapshot();
    snapshot.fixtures[0] = finish(snapshot.fixtures[0], 'Jon Skjerdal');
    snapshot.fixtures[1].match_id = 'active-match';
    expect(withReportedResults(snapshot)).toEqual(snapshot);
    const unlinked = reportedSnapshot();
    unlinked.fixtures[0].player_a_id = null;
    unlinked.fixtures[1].player_a_name = 'Someone else';
    expect(withReportedResults(unlinked)).toEqual(unlinked);
  });

  it('applies an exclusion only to that player while preserving physical progress and the opponent result', () => {
    const original = reportedSnapshot();
    original.fixtures[0].counts_for_a = false;
    const data = buildStandings(withReportedResults(original));
    const rows = data.offices.find((o) => o.office === 'sogndal')?.table;
    expect(data.played).toBe(2);
    expect(rows?.find((r) => r.key === 'Sindre Jensen')).toMatchObject({ played: 0, wins: 0, losses: 0, legsFor: 0, excluded: 1 });
    expect(rows?.find((r) => r.key === 'Sindre Jensen')?.averageIncomplete).not.toBe(true);
    expect(rows?.find((r) => r.key === 'Jon Skjerdal')).toMatchObject({ played: 2, wins: 1, losses: 1, averageIncomplete: true });
    const projection = projectFinals(data);
    expect(projection.ready).toBe(false);
    expect(validateDraw(data, projection.selection).ok).toBe(false);
  });

  it('restores normal averages and qualification logic after canonical results replace both reports', () => {
    const original = reportedSnapshot();
    original.fixtures[0] = finish(original.fixtures[0], 'Sindre Jensen');
    original.fixtures[1] = finish(original.fixtures[1], 'Jon Skjerdal');
    expect(buildStandings(withReportedResults(original))).toEqual(buildStandings(original));
    expect(buildStandings(withReportedResults(original)).averagesIncomplete).toBe(false);
  });

  it('reconciles all six unique leg totals against the screenshot remaining scores', () => {
    const remaining = [[[22, 0], [0, 70], [48, 0]], [[0, 32], [16, 0], [0, 52]]];
    for (const [matchIndex, report] of REPORTED_RESULTS.entries()) {
      expect(report.legs.filter((leg) => leg.winner === report.winner)).toHaveLength(2);
      for (const [legIndex, leg] of report.legs.entries()) {
        expect([301 - leg.a.reduce((a, b) => a + b, 0), 301 - leg.b.reduce((a, b) => a + b, 0)]).toEqual(remaining[matchIndex][legIndex]);
      }
    }
  });
});
