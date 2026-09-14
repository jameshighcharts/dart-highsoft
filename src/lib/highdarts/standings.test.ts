import { fixture, finish } from '@/test-utils/highdartsFixtures';
import { describe, expect, it } from 'vitest';
import {
  buildStandings,
  fixtureAvailability,
  tournamentNames,
  fixturesForPair,
  normalizeName,
  resultStats,
  type FixtureResult,
} from './standings';
function table(fixtures: FixtureResult[]) {
  return buildStandings({ fixtures, players: [] });
}
describe('Highdarts standings', () => {
  it('preserves reversed repeat fixtures and finds either player order', () => {
    const fixtures = [
      fixture('sogndal', 'a', 'b', 1),
      fixture('sogndal', 'b', 'a', 9),
    ];
    expect(
      fixturesForPair(fixtures, ['b', 'a']).map((f) => f.fixture_no),
    ).toEqual([1, 9]);
    expect(fixturesForPair(fixtures, ['a', 'a'])).toEqual([]);
    expect(fixturesForPair(fixtures, ['a', 'b', 'c'])).toEqual([]);
    expect(table(fixtures).offices[2].table[0].remaining).toBe(2);
  });
  it('folds Norwegian names without guessing partial matches', () => {
    expect(normalizeName('  Ken-Håvard  Lieng ')).toBe('ken-havard lieng');
    expect(normalizeName('Jørgen Ægir Émil')).toBe('jorgen aegir emil');
    expect(normalizeName('Linda Sven')).not.toBe(
      normalizeName('Linda Svensen'),
    );
  });
  it('counts only completed, non-early tagged fixtures and weights average by darts', () => {
    const won = finish(fixture('bergen', 'a', 'b'), 'a');
    won.match!.legs[0].turns.push(
      {
        player_id: 'a',
        total_scored: 20,
        darts_thrown: 1,
        busted: false,
        tiebreak_round: null,
      },
      {
        player_id: 'a',
        total_scored: 100,
        darts_thrown: 3,
        busted: true,
        tiebreak_round: null,
      },
      {
        player_id: 'a',
        total_scored: 180,
        darts_thrown: 3,
        busted: false,
        tiebreak_round: 1,
      },
    );
    const early = finish(fixture('bergen', 'a', 'b', 2), 'b', 180, 180);
    early.match!.ended_early = true;
    const result = table([won, early, fixture('bergen', 'a', 'b', 3)]);
    expect(result.played).toBe(1);
    expect(result.total).toBe(3);
    expect(result.offices[0].table[0]).toMatchObject({
      wins: 1,
      losses: 0,
      played: 1,
      average: 60,
      legsFor: 2,
      legsAgainst: 0,
      remaining: 2,
    });
    expect(resultStats(won, 'a').average).toBe(60);
  });
  it('awards the fourth bye to the highest-average second across offices', () => {
    const fixtures = [
      finish(fixture('bergen', 'a', 'b'), 'a', 60, 45),
      finish(fixture('vik', 'c', 'd'), 'c', 60, 55),
      finish(fixture('sogndal', 'e', 'f'), 'e', 60, 35),
    ];
    const result = table(fixtures);
    expect(result.byes.map((r) => r.player.display_name)).toEqual([
      'a',
      'c',
      'd',
      'e',
    ]);
    expect(result.offices[0].table[1].qualification).toBe('bye-candidate');
  });
  it('does not break a best-second average tie using different office win totals', () => {
    const fixtures = [
      finish(fixture('bergen', 'a', 'b'), 'a', 60, 45),
      finish(fixture('vik', 'c', 'd'), 'c', 60, 45),
      finish(fixture('vik', 'd', 'z', 2), 'd', 45, 20),
    ];
    const result = table(fixtures);
    expect(result.offices[0].table[1].tiedForBye).toBe(true);
    expect(result.offices[1].table[1].tiedForBye).toBe(true);
    expect(result.byes).toHaveLength(2);
  });
  it('flags every row in a tie crossing fourth place regardless of leg difference', () => {
    const fixtures = [
      finish(fixture('bergen', 'a', 'b', 1), 'a', 90, 70),
      finish(fixture('bergen', 'c', 'd', 2), 'c', 80, 30),
      finish(fixture('bergen', 'a', 'e', 3), 'a', 90, 30),
    ];
    const result = table(fixtures).offices[0].table;
    expect(result.slice(3).map((r) => r.tiedForFourth)).toEqual([true, true]);
    expect(result.slice(3).map((r) => r.qualification)).toEqual([null, null]);
  });
  it('does not mistake rounded display averages for a true tie', () => {
    const fixtures = [
      finish(fixture('bergen', 'a', 'b'), 'a', 90, 30.001),
      finish(fixture('vik', 'c', 'd'), 'c', 90, 30.002),
    ];
    expect(table(fixtures).offices[1].table[1]).toMatchObject({
      qualification: 'bye',
      tiedForBye: false,
    });
  });
});

it('shortens unique names and disambiguates repeated first names across the full draw', () => {
  const snapshot = { players: [{ id: 'a', display_name: 'Ada Jones' }, { id: 'b', display_name: 'Ben' }], fixtures: [
    { ...fixture('bergen', 'a', 'b'), player_b_name: 'Ben Smith' },
    { ...fixture('vik', 'a', 'c'), player_b_name: 'Ben Taylor' },
    { ...fixture('bergen', 'a', 'b', 2), player_b_name: 'Ben Smith' },
  ] };
  const name = tournamentNames(snapshot);
  expect(name('a', 'Ada Jones')).toBe('Ada');
  expect(name('b', 'Ben Smith')).toBe('Ben S');
  expect(name('c', 'Ben Taylor')).toBe('Ben T');
});

it('blocks busy or offline office boards while allowing an independent office', () => {
  const upcoming = fixture('bergen', 'a', 'b');
  const board = { id: 'board', name: 'Bergen board', isHomeSbc: true, workerConnectionStatus: 'connected' as const, boardStatus: 'Ready', workerHeartbeatAt: new Date().toISOString(), activeMatchId: null, activeGameSessionId: null, selectable: true };
  expect(fixtureAvailability(upcoming, { players: [], fixtures: [upcoming], boards: [board] })).toBeNull();
  expect(fixtureAvailability(upcoming, { players: [], fixtures: [upcoming], boards: [{ ...board, activeGameSessionId: 'busy', selectable: false }] })?.href).toBe('/game/busy');
  expect(fixtureAvailability(upcoming, { players: [], fixtures: [upcoming], boards: [{ ...board, selectable: false }] })?.href).toBe('/boards');
  const elsewhere = { ...fixture('vik', 'c', 'd'), match_id: 'live' };
  expect(fixtureAvailability(upcoming, { players: [], fixtures: [upcoming, elsewhere] })).toBeNull();
  expect(fixtureAvailability(upcoming, { players: [], fixtures: [upcoming, { ...elsewhere, player_a_id: 'a' }] })?.href).toBe('/match/live');
});
