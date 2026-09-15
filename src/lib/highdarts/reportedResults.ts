import { normalizeName, type Snapshot } from './standings';

// Transcribed from six unique screenshots supplied on 2026-09-15.
// The user confirmed both matches were played on 2026-09-15 in Norway.
// Checkout dart counts were not shown.
// Display-only averages assume three darts per recorded visit, including checkouts.
export const REPORTED_RESULTS = [
  {
    fixtureNo: 12, a: 'Johan Flo', b: 'Jon Skjerdal', winner: 'b', playedOn: '2026-09-15',
    estimatedAverages: { a: 34.71, b: 33.32 },
    legs: [
      { winner: 'b', a: [14, 33, 23, 17, 14, 62, 13, 23, 80], b: [28, 49, 16, 30, 74, 31, 9, 11, 20, 33] },
      { winner: 'a', a: [103, 37, 31, 44, 43, 19, 19, 5], b: [36, 26, 35, 34, 26, 45, 29] },
      { winner: 'b', a: [39, 39, 40, 58, 37, 33, 7], b: [94, 52, 28, 55, 34, 0, 24, 14] },
    ],
  },
  {
    fixtureNo: 1, a: 'Sindre Jensen', b: 'Jon Skjerdal', winner: 'a', playedOn: '2026-09-15',
    estimatedAverages: { a: 38.57, b: 35.61 },
    legs: [
      { winner: 'a', a: [48, 48, 7, 78, 50, 39, 31], b: [28, 19, 68, 46, 25, 47, 36] },
      { winner: 'b', a: [44, 38, 23, 79, 57, 44, 0, 0], b: [31, 24, 23, 54, 31, 66, 54, 18] },
      { winner: 'a', a: [10, 81, 39, 63, 52, 0, 29, 27], b: [18, 80, 28, 21, 45, 24, 26, 7] },
    ],
  },
] satisfies { fixtureNo: number; a: string; b: string; winner: 'a' | 'b'; playedOn: string; estimatedAverages: { a: number; b: number }; legs: { winner: 'a' | 'b'; a: number[]; b: number[] }[] }[];

export function withReportedResults(snapshot: Snapshot): Snapshot {
  return {
    ...snapshot,
    fixtures: snapshot.fixtures.map((fixture) => {
      const report = REPORTED_RESULTS.find((r) =>
        fixture.stage === 'group' && fixture.office === 'sogndal' &&
        fixture.fixture_no === r.fixtureNo &&
        normalizeName(fixture.player_a_name) === normalizeName(r.a) &&
        normalizeName(fixture.player_b_name) === normalizeName(r.b));
      if (!report || fixture.match_id || fixture.match ||
          !fixture.player_a_id || !fixture.player_b_id) return fixture;
      const ids = { a: fixture.player_a_id, b: fixture.player_b_id };
      return {
        ...fixture,
        reportedResult: {
          winner_player_id: ids[report.winner],
          playedOn: report.playedOn,
          estimatedAverages: [
            { player_id: ids.a, average: report.estimatedAverages.a },
            { player_id: ids.b, average: report.estimatedAverages.b },
          ],
          legs: report.legs.map((leg) => ({
            winner_player_id: ids[leg.winner],
            visits: [{ player_id: ids.a, scores: leg.a }, { player_id: ids.b, scores: leg.b }],
          })),
        },
      };
    }),
  };
}
