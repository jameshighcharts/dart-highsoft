import { calculate3DartAverage } from '@/utils/x01';
import type { Player } from '@/lib/match/types';

export const OFFICES = ['bergen', 'vik', 'sogndal'] as const;
export type Office = (typeof OFFICES)[number];
export type Stage =
  'group' | 'playoff' | 'quarterfinal' | 'semifinal' | 'final' | 'tiebreak';
export type Fixture = {
  id: string;
  event_id: string;
  stage: Stage;
  office: Office | null;
  fixture_no: number;
  player_a_name: string;
  player_b_name: string;
  player_a_id: string | null;
  player_b_id: string | null;
  match_id: string | null;
};
export type ResultTurn = {
  player_id: string;
  total_scored: number;
  busted: boolean;
  darts_thrown: number;
  tiebreak_round: number | null;
};
export type FixtureResult = Fixture & {
  match: {
    id: string;
    winner_player_id: string | null;
    completed_at: string | null;
    ended_early: boolean;
    legs: { winner_player_id: string | null; turns: ResultTurn[] }[];
  } | null;
};
export type Snapshot = { fixtures: FixtureResult[]; players: Player[] };
export type Standing = {
  key: string;
  player: Player;
  rank: number;
  played: number;
  wins: number;
  losses: number;
  legsFor: number;
  legsAgainst: number;
  legDiff: number;
  average: number;
  remaining: number;
  qualification: 'bye' | 'bye-candidate' | 'playoff' | null;
  tiedForFourth: boolean;
  tiedForBye: boolean;
};
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replaceAll('ø', 'o')
    .replaceAll('æ', 'ae')
    .replaceAll('œ', 'oe')
    .replaceAll('ß', 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}
export function fixturesForPair(fixtures: Fixture[], ids: string[]): Fixture[] {
  if (ids.length !== 2 || ids[0] === ids[1]) return [];
  return fixtures
    .filter(
      (f) =>
        f.stage === 'group' &&
        f.player_a_id !== null &&
        f.player_b_id !== null &&
        ids.includes(f.player_a_id) &&
        ids.includes(f.player_b_id),
    )
    .sort((a, b) => a.fixture_no - b.fixture_no);
}
export function officeName(office: Office | null) {
  return office ? office[0].toUpperCase() + office.slice(1) : 'Finals';
}
export function fixtureLabel(f: Fixture) {
  return `${officeName(f.office)} #${f.fixture_no}`;
}
export function isCompleted(f: FixtureResult) {
  return Boolean(
    f.match?.completed_at && f.match.winner_player_id && !f.match.ended_early,
  );
}
export function resultStats(f: FixtureResult, playerId: string | null) {
  const turns =
    f.match?.legs
      .flatMap((l) => l.turns)
      .filter((t) => t.player_id === playerId && t.tiebreak_round === null) ??
    [];
  return {
    average: calculate3DartAverage(turns),
    legs:
      f.match?.legs.filter(
        (l) => l.winner_player_id === playerId && playerId !== null,
      ).length ?? 0,
  };
}
export function buildStandings({ fixtures, players }: Snapshot) {
  const playerById = new Map(players.map((p) => [p.id, p]));
  const offices = OFFICES.map((office) => {
    const group = fixtures.filter(
      (f) => f.stage === 'group' && f.office === office,
    );
    const rows = new Map<string, Standing>();
    const playerTurns = new Map<string, ResultTurn[]>();
    for (const fixture of group) {
      const sides = [
        {
          id: fixture.player_a_id,
          name: fixture.player_a_name,
          opponent: fixture.player_b_id,
        },
        {
          id: fixture.player_b_id,
          name: fixture.player_b_name,
          opponent: fixture.player_a_id,
        },
      ];
      for (const { id, name, opponent } of sides) {
        const key = id ?? `unlinked:${normalizeName(name)}`;
        let row = rows.get(key);
        if (!row) {
          row = {
            key,
            player: id
              ? (playerById.get(id) ?? { id, display_name: name })
              : { id: '', display_name: name },
            rank: 0,
            played: 0,
            wins: 0,
            losses: 0,
            legsFor: 0,
            legsAgainst: 0,
            legDiff: 0,
            average: 0,
            remaining: 0,
            qualification: null,
            tiedForFourth: false,
            tiedForBye: false,
          };
          rows.set(key, row);
        }
        if (!isCompleted(fixture)) {
          row.remaining++;
          continue;
        }
        row.played++;
        if (fixture.match?.winner_player_id === id) row.wins++;
        else row.losses++;
        row.legsFor += resultStats(fixture, id).legs;
        row.legsAgainst += resultStats(fixture, opponent).legs;
        playerTurns.set(key, [
          ...(playerTurns.get(key) ?? []),
          ...(fixture.match?.legs
            .flatMap((l) => l.turns)
            .filter((t) => t.player_id === id && t.tiebreak_round === null) ??
            []),
        ]);
      }
    }
    for (const row of rows.values()) {
      row.average = calculate3DartAverage(playerTurns.get(row.key) ?? []);
      row.legDiff = row.legsFor - row.legsAgainst;
    }
    const table = [...rows.values()].sort(
      (a, b) =>
        b.wins - a.wins ||
        b.average - a.average ||
        b.legDiff - a.legDiff ||
        a.player.display_name.localeCompare(b.player.display_name),
    );
    table.forEach((r, i) => {
      r.rank = i + 1;
      r.qualification =
        i === 0 ? 'bye' : i === 1 ? 'bye-candidate' : i < 4 ? 'playoff' : null;
    });
    // Only wins and unrounded average decide a cutoff tie. Leg difference and
    // name provide a stable display order, never resolve qualification.
    const fourth = table[3],
      fifth = table[4];
    if (fourth && fifth && sameOfficeTie(fourth, fifth)) {
      table
        .filter((r) => sameOfficeTie(r, fourth))
        .forEach((r) => {
          r.tiedForFourth = true;
          r.qualification = null;
        });
    }
    return {
      office,
      table,
      total: group.length,
      played: group.filter(isCompleted).length,
      upcoming: group.filter((f) => !isCompleted(f)),
    };
  });
  const seconds = offices.flatMap((o) => (o.table[1] ? [o.table[1]] : []));
  const bestAverage = Math.max(...seconds.map((r) => r.average));
  // Across offices the fourth bye is decided by average alone, irrespective of
  // office win totals. Equal best averages require a playoff.
  const best = seconds.filter((r) => r.average === bestAverage);
  if (best.length === 1)
    best[0].qualification = best[0].tiedForFourth ? null : 'bye';
  else
    best.forEach((r) => {
      r.tiedForBye = true;
    });
  return {
    offices,
    total: offices.reduce((n, o) => n + o.total, 0),
    played: offices.reduce((n, o) => n + o.played, 0),
    recent: fixtures
      .filter((f) => isCompleted(f) || f.match?.ended_early)
      .sort((a, b) =>
        (b.match?.completed_at ?? '').localeCompare(
          a.match?.completed_at ?? '',
        ),
      )
      .slice(0, 10),
    byes: offices.flatMap((o) =>
      o.table.filter((r) => r.qualification === 'bye'),
    ),
    playoff: offices.flatMap((o) =>
      o.table.filter(
        (r) =>
          r.qualification === 'playoff' || r.qualification === 'bye-candidate',
      ),
    ),
    unresolved: new Set(
      fixtures
        .flatMap((f) => [
          !f.player_a_id
            ? `${f.office}:${normalizeName(f.player_a_name)}`
            : null,
          !f.player_b_id
            ? `${f.office}:${normalizeName(f.player_b_name)}`
            : null,
        ])
        .filter(Boolean),
    ).size,
  };
}
function sameOfficeTie(a: Standing, b: Standing) {
  return a.wins === b.wins && a.average === b.average;
}
