import { describe, expect, it } from 'vitest';
import { completedGroupsWithAcceptedReport, fixture, finish } from '@/test-utils/highdartsFixtures';
import { buildStandings, isCompleted, resultStats, tournamentActivity } from './standings';
import { projectFinals, validateDraw } from './finals';
import { REPORTED_RESULTS, withReportedResults } from './reportedResults';
import { buildSheetExport } from './sheetExport';

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
  it('counts exactly two matches, preserves the second Johan meeting and includes estimated averages', () => {
    const original = reportedSnapshot();
    const snapshot = withReportedResults(original);
    expect(original.fixtures.every((f) => !isCompleted(f))).toBe(true);
    expect(snapshot.fixtures.filter(isCompleted)).toHaveLength(2);
    expect(snapshot.fixtures[2]).toBe(original.fixtures[2]);
    expect(snapshot.fixtures[3]).toBe(original.fixtures[3]);
    const data = buildStandings(snapshot);
    expect(data.played).toBe(2);
    const rows = data.offices.find((o) => o.office === 'sogndal')?.table;
    expect(rows?.find((r) => r.key === 'Jon Skjerdal')).toMatchObject({ played: 2, wins: 1, losses: 1, legsFor: 3, legsAgainst: 3, averageIncomplete: true, remaining: 1 });
    expect(rows?.find((r) => r.key === 'Johan Flo')).toMatchObject({ wins: 0, losses: 1, legsFor: 1, legsAgainst: 2 });
    expect(rows?.find((r) => r.key === 'Sindre Jensen')).toMatchObject({ wins: 1, losses: 0, legsFor: 2, legsAgainst: 1 });
    expect(data.byes).toEqual([]);
    expect(data.ties).toEqual([]);
    expect(resultStats(snapshot.fixtures[0], 'Jon Skjerdal').averageIncomplete).toBe(true);
    expect(tournamentActivity(snapshot.fixtures, new Date('2026-09-15T12:00:00Z')).today).toBe(2);
    expect(withReportedResults(snapshot)).toEqual(snapshot);
  });

  it('counts both reported games and two app results on September 15 only, using the Oslo day', () => {
    const original = reportedSnapshot();
    for (const f of [
      finish(fixture('vik', 'Linda', 'Aksel', 28), 'Linda'),
      finish(fixture('vik', 'Helga', 'Andreas', 17), 'Andreas'),
    ]) {
      if (f.match) f.match.completed_at = '2026-09-15T09:00:00Z';
      original.fixtures.push(f);
    }
    const snapshot = withReportedResults(original);
    expect(buildStandings(snapshot).played).toBe(4);
    expect(tournamentActivity(snapshot.fixtures, new Date('2026-09-15T12:00:00Z'))).toMatchObject({ today: 4, groupToday: 4 });
    expect(tournamentActivity(snapshot.fixtures, new Date('2026-09-14T21:59:59Z'))).toMatchObject({ today: 0, groupToday: 0 });
    expect(tournamentActivity(snapshot.fixtures, new Date('2026-09-15T21:59:59Z'))).toMatchObject({ today: 4, groupToday: 4 });
    expect(tournamentActivity(snapshot.fixtures, new Date('2026-09-15T22:00:00Z'))).toMatchObject({ today: 0, groupToday: 0 });
    expect(tournamentActivity(withReportedResults(snapshot).fixtures, new Date('2026-09-15T12:00:00Z')).today).toBe(4);
  });

  it('keeps the hardcoded display estimates tied to each player and the recorded visit totals', () => {
    const snapshot = withReportedResults(reportedSnapshot());
    expect(snapshot.fixtures[0].reportedResult?.estimatedAverages).toEqual([
      { player_id: 'Sindre Jensen', average: 38.57 },
      { player_id: 'Jon Skjerdal', average: 35.61 },
    ]);
    expect(snapshot.fixtures[1].reportedResult?.estimatedAverages).toEqual([
      { player_id: 'Johan Flo', average: 34.71 },
      { player_id: 'Jon Skjerdal', average: 33.32 },
    ]);
    for (const report of REPORTED_RESULTS) {
      const aVisits = report.legs.flatMap((leg) => leg.a);
      const bVisits = report.legs.flatMap((leg) => leg.b);
      expect(report.estimatedAverages.a).toBeCloseTo(aVisits.reduce((sum, score) => sum + score, 0) / aVisits.length, 2);
      expect(report.estimatedAverages.b).toBeCloseTo(bVisits.reduce((sum, score) => sum + score, 0) / bVisits.length, 2);
    }
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
  it('weights estimated visits with real darts and removes only an excluded player contribution', () => {
    const source = reportedSnapshot();
    source.fixtures[3] = finish(source.fixtures[3], 'Sindre Jensen', 60, 90);
    const snapshot = withReportedResults(source);
    const report = REPORTED_RESULTS.find((r) => r.fixtureNo === 1)!;
    const scores = report.legs.flatMap((leg) => leg.a);
    const points = scores.reduce((a, b) => a + b, 0);
    const row = buildStandings(snapshot).offices[2].table.find((r) => r.key === 'Sindre Jensen');
    expect(row?.average).toBeCloseTo((points + 90) / (scores.length + 1), 10);
    expect(resultStats(snapshot.fixtures[0], 'Sindre Jensen').average).toBeCloseTo(38.57, 2);
    expect(buildStandings(snapshot).offices[2].table.find((r) => r.key === 'Johan Flo')?.average).toBeGreaterThan(0);
    snapshot.fixtures[0].counts_for_a = false;
    const excluded = buildStandings(snapshot).offices[2].table;
    expect(excluded.find((r) => r.key === 'Sindre Jensen')?.average).toBe(90);
    expect(excluded.find((r) => r.key === 'Jon Skjerdal')?.average).toBeGreaterThan(0);
  });

});

function displacedScreenshotSnapshot() {
  const source = reportedSnapshot();
  const matchId = 'cd0f9577-5ce2-44ba-9566-b9644d9b9b5d';
  const recorded = finish(source.fixtures[1], 'Jon Skjerdal', 81, 80);
  if (!recorded.match) throw new Error('Expected a completed app match');
  recorded.match_id = matchId;
  recorded.match.id = matchId;
  recorded.match.completed_at = '2026-09-21T12:00:00Z';
  recorded.match.legs[0].turns[1].darts_thrown = 2;
  source.fixtures[1] = recorded;
  return source;
}

describe('the screenshot game displaced by the later recorded Jon–Johan meeting', () => {
  it('restores the September 15 screenshot once to the reverse fixture without changing the recorded game', () => {
    const source = displacedScreenshotSnapshot();
    const snapshot = withReportedResults(source);
    expect(snapshot.fixtures[1]).toBe(source.fixtures[1]);
    expect(snapshot.fixtures[2].reportedResult).toMatchObject({
      winner_player_id: 'Jon Skjerdal',
      playedOn: '2026-09-15',
      estimatedAverages: [
        { player_id: 'Johan Flo', average: 34.71 },
        { player_id: 'Jon Skjerdal', average: 33.32 },
      ],
    });
    expect(resultStats(snapshot.fixtures[2], 'Jon Skjerdal')).toMatchObject({ legs: 2, averageIncomplete: true });
    expect(resultStats(snapshot.fixtures[2], 'Jon Skjerdal').average).toBeCloseTo(33.32, 2);
    expect(resultStats(snapshot.fixtures[2], 'Johan Flo').legs).toBe(1);
    expect(buildStandings(snapshot).played).toBe(3);
    expect(tournamentActivity(snapshot.fixtures, new Date('2026-09-15T12:00:00Z')).today).toBe(2);
    expect(tournamentActivity(snapshot.fixtures, new Date('2026-10-06T12:00:00Z')).today).toBe(0);
    expect(source.fixtures[2].reportedResult).toBeUndefined();
    expect(withReportedResults(snapshot)).toEqual(snapshot);
  });

  it('includes both games in weighted averages and the sheet, respecting each side’s exclusion', () => {
    const source = displacedScreenshotSnapshot();
    source.fixtures[0].counts_for_b = false;
    const snapshot = withReportedResults(source);
    const standings = buildStandings(snapshot);
    const jon = standings.offices[2].table.find((row) => row.key === 'Jon Skjerdal');
    const johan = standings.offices[2].table.find((row) => row.key === 'Johan Flo');
    // Jon: 833 points in 25 reported visits plus the two-dart recorded visit.
    expect(jon).toMatchObject({ played: 2, wins: 2, losses: 0, legsFor: 4, legsAgainst: 1, remaining: 0, averageIncomplete: true });
    expect(jon?.average).toBeCloseTo((833 + 80) * 3 / (75 + 2), 10);
    expect(johan?.average).toBeCloseTo((833 + 81) * 3 / (72 + 3), 10);
    const sheet = buildSheetExport(source);
    expect(sheet.fixtures[1].result).toEqual([0, 2, 81, 120]);
    expect(sheet.fixtures[2].result).toEqual([2, 1, 833 / 25, 833 / 24]);
    expect(sheet.standings[2].rows.find((row) => row[1] === 'Jon Skjerdal')?.[4]).toBe(jon?.average);
    expect(projectFinals(standings).ready).toBe(false);

    source.fixtures[2].counts_for_a = false;
    const excluded = buildStandings(withReportedResults(source));
    expect(excluded.played).toBe(3);
    expect(excluded.offices[2].table.find((row) => row.key === 'Jon Skjerdal')).toMatchObject({ played: 1, wins: 1, average: 120 });
    expect(excluded.offices[2].table.find((row) => row.key === 'Johan Flo')?.average).toBe(johan?.average);
    source.fixtures[2].counts_for_b = false;
    expect(buildStandings(withReportedResults(source)).offices[2].table.find((row) => row.key === 'Johan Flo')).toMatchObject({ played: 1, losses: 1, average: 81 });
  });

  it('does not relocate reports for an unrelated, active or early-ended app match', () => {
    for (const state of ['different-match', 'active', 'ended-early', 'no-winner']) {
      const source = displacedScreenshotSnapshot();
      const recorded = source.fixtures[1];
      if (!recorded.match) throw new Error('Expected an app match');
      if (state === 'different-match') recorded.match_id = recorded.match.id = 'unrelated';
      if (state === 'active') recorded.match.completed_at = null;
      if (state === 'ended-early') recorded.match.ended_early = true;
      if (state === 'no-winner') recorded.match.winner_player_id = null;
      expect(withReportedResults(source).fixtures[2]).toBe(source.fixtures[2]);
    }
  });

  it('requires the same event and linked pair and never overrides a claimed return fixture', () => {
    for (const state of ['other-event', 'wrong-pair', 'unlinked', 'active-return', 'completed-return']) {
      const source = displacedScreenshotSnapshot();
      const target = source.fixtures[2];
      if (state === 'other-event') target.event_id = 'another-event';
      if (state === 'wrong-pair') target.player_a_id = 'another-jon';
      if (state === 'unlinked') target.player_a_id = null;
      if (state === 'active-return') target.match_id = 'active-return';
      if (state === 'completed-return') source.fixtures[2] = finish(target, 'Johan Flo');
      expect(withReportedResults(source).fixtures[2]).toBe(source.fixtures[2]);
    }
  });
});


describe('accepted database screenshot results', () => {
  it('uses accepted estimates for qualification while retaining their estimate label', () => {
    const snapshot = completedGroupsWithAcceptedReport();
    const standings = buildStandings(snapshot);
    expect(standings.played).toBe(standings.total);
    expect(standings.averagesIncomplete).toBe(false);
    expect(standings.offices[0].table.filter((row) => row.averageEstimated)).toHaveLength(2);
    const projection = projectFinals(standings);
    expect(projection.ready).toBe(true);
    expect(validateDraw(standings, projection.selection).ok).toBe(true);
    expect(resultStats(snapshot.fixtures[0], snapshot.fixtures[0].player_a_id)).toMatchObject({ averageEstimated: true, averageIncomplete: false });
    expect(withReportedResults(snapshot).fixtures[0]).toBe(snapshot.fixtures[0]);

    const report = snapshot.fixtures[0].reportedResult;
    if (!report) throw new Error('Expected report');
    report.accepted = false;
    expect(projectFinals(buildStandings(snapshot)).ready).toBe(false);
  });

  it('does not let an accepted estimate bypass an unfinished group game', () => {
    const snapshot = completedGroupsWithAcceptedReport();
    snapshot.fixtures[1] = { ...snapshot.fixtures[1], match_id: null, match: null };
    expect(buildStandings(snapshot).averagesIncomplete).toBe(false);
    expect(projectFinals(buildStandings(snapshot)).ready).toBe(false);
  });

  it('preserves a persisted accepted report instead of reapplying the legacy fallback', () => {
    const source = withReportedResults(reportedSnapshot());
    const report = source.fixtures[0].reportedResult;
    if (!report) throw new Error('Expected report');
    report.accepted = true;
    expect(withReportedResults(source).fixtures[0]).toBe(source.fixtures[0]);
    expect(withReportedResults(source).fixtures[0].reportedResult?.accepted).toBe(true);
  });
});
