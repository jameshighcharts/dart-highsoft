import {
  OFFICES,
  type FixtureResult,
  type Office,
  type ResultTurn,
  type Snapshot,
} from '@/lib/highdarts/standings';
export function fixture(
  office: Office,
  a: string,
  b: string,
  no = 1,
): FixtureResult {
  return {
    id: `${office}-${no}`,
    event_id: 'event',
    stage: 'group',
    office,
    fixture_no: no,
    player_a_id: a,
    player_b_id: b,
    player_a_name: a,
    player_b_name: b,
    match_id: null,
    match: null,
  };
}
export function finish(
  f: FixtureResult,
  winner: string,
  aScore = 60,
  bScore = 30,
): FixtureResult {
  const turn = (player_id: string, total_scored: number): ResultTurn => ({
    player_id,
    total_scored,
    darts_thrown: 3,
    busted: false,
    tiebreak_round: null,
  });
  return {
    ...f,
    match_id: `match-${f.id}`,
    match: {
      id: `match-${f.id}`,
      winner_player_id: winner,
      completed_at: '2026-09-14T12:00:00Z',
      ended_early: false,
      legs: [
        {
          winner_player_id: winner,
          turns: [
            turn(f.player_a_id ?? '', aScore),
            turn(f.player_b_id ?? '', bScore),
          ],
        },
        { winner_player_id: winner, turns: [] },
      ],
    },
  };
}
export function completedGroups(bestOffice = 0): Snapshot {
  const fixtures = [];
  for (const [officeIndex, office] of OFFICES.entries()) {
    let no = 1;
    for (let a = 0; a < 5; a++)
      for (let b = a + 1; b < 5; b++) {
        const id = (n: number) =>
          `00000000-0000-4000-8000-${String(officeIndex * 10 + n + 1).padStart(12, '0')}`;
        const score = (n: number) =>
          90 - n * 12 + (officeIndex === bestOffice ? 5 : officeIndex);
        fixtures.push(
          finish(
            fixture(office, id(a), id(b), no++),
            id(a),
            score(a),
            score(b),
          ),
        );
      }
  }
  return { fixtures, players: [] };
}

export function completedGroupsWithAcceptedReport(): Snapshot {
  const snapshot = completedGroups();
  const original = snapshot.fixtures[0];
  const a = original.player_a_id;
  const b = original.player_b_id;
  if (!a || !b) throw new Error('Expected linked test players');
  snapshot.fixtures[0] = {
    ...original,
    match_id: null,
    match: null,
    reportedResult: {
      accepted: true,
      winner_player_id: a,
      playedOn: '2026-09-15',
      estimatedAverages: [{ player_id: a, average: 38.57 }, { player_id: b, average: 35.61 }],
      legs: [
        { winner_player_id: a, visits: [{ player_id: a, scores: [48, 48, 7, 78, 50, 39, 31] }, { player_id: b, scores: [28, 19, 68, 46, 25, 47, 36] }] },
        { winner_player_id: b, visits: [{ player_id: a, scores: [44, 38, 23, 79, 57, 44, 0, 0] }, { player_id: b, scores: [31, 24, 23, 54, 31, 66, 54, 18] }] },
        { winner_player_id: a, visits: [{ player_id: a, scores: [10, 81, 39, 63, 52, 0, 29, 27] }, { player_id: b, scores: [18, 80, 28, 21, 45, 24, 26, 7] }] },
      ],
    },
  };
  return snapshot;
}
