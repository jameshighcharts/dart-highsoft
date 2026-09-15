import { calculate3DartAverage } from '@/utils/x01';
import type { ScoliaBoardOption } from '@/lib/scolia/types';
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
  counts_for_a?: boolean;
  counts_for_b?: boolean;
  next_fixture_id?: string | null;
  next_slot?: 'a' | 'b' | null;
  tie_context?: string | null;
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
export type Snapshot = { fixtures: FixtureResult[]; players: Player[]; boards?: ScoliaBoardOption[] };

export function fixtureAvailability(fixture: Fixture, snapshot: Snapshot) {
  const active = snapshot.fixtures.find((f) => f.id !== fixture.id && f.match_id && !f.match?.completed_at && !f.match?.ended_early && (
    (fixture.office !== null && f.office === fixture.office) ||
    [f.player_a_id, f.player_b_id].some((id) => id !== null && [fixture.player_a_id, fixture.player_b_id].includes(id))
  ));
  if (active) return { reason: 'A tournament match is already in progress.', href: `/match/${active.match_id}` };
  const boards = fixture.office ? (snapshot.boards ?? []).filter((b) => b.name.toLowerCase().includes(fixture.office ?? '')) : [];
  const busy = boards.find((b) => b.activeMatchId || b.activeGameSessionId);
  if (busy) return { reason: `${officeName(fixture.office)} board is in use.`, href: busy.activeMatchId ? `/match/${busy.activeMatchId}` : `/game/${busy.activeGameSessionId}` };
  if (boards.length && !boards.some((b) => b.selectable)) return { reason: `${officeName(fixture.office)} board is not ready.`, href: '/boards' };
  return null;
}

export type Standing = {
  key: string;
  player: Player;
  rank: number;
  played: number;
  scheduled: number;
  excluded: number;
  needsDiscard: boolean;
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
export function tournamentNames(snapshot: Snapshot) {
  const entries = new Map<string, string>();
  for (const f of snapshot.fixtures) {
    for (const [id, name] of [[f.player_a_id, f.player_a_name], [f.player_b_id, f.player_b_name]]) {
      const displayName = snapshot.players.find((p) => p.id === id)?.display_name ?? name ?? '';
      const sheetParts = (name ?? '').trim().split(/\s+/);
      const parts = displayName.trim().split(/\s+/);
      const fullName = parts.length === 1 && sheetParts.length > 1 && normalizeName(parts[0]) === normalizeName(sheetParts[0]) ? `${parts[0]} ${sheetParts[sheetParts.length - 1]}` : displayName;
      entries.set(id ?? normalizeName(displayName), fullName.trim());
    }
  }
  const counts = new Map<string, number>();
  for (const name of entries.values()) {
    const first = normalizeName(name.split(/\s+/)[0]);
    counts.set(first, (counts.get(first) ?? 0) + 1);
  }
  return (id: string | null, fallback: string) => {
    const full = entries.get(id ?? normalizeName(fallback)) ?? fallback.trim();
    const parts = full.split(/\s+/);
    return (counts.get(normalizeName(parts[0])) ?? 0) > 1 && parts.length > 1
      ? `${parts[0]} ${parts[parts.length - 1][0]}`
      : parts[0];
  };
}

export function personalFixtures(snapshot: Snapshot, playerId: string) {
  return snapshot.fixtures
    .filter((f) => f.player_a_id === playerId || f.player_b_id === playerId)
    .sort((a, b) => {
      const status = (f: FixtureResult) => f.match?.completed_at || f.match?.ended_early ? 2 : f.match_id ? 0 : 1;
      return status(a) - status(b) || a.fixture_no - b.fixture_no || a.id.localeCompare(b.id);
    });
}

export function fixturesForPair(fixtures: Fixture[], ids: string[]): Fixture[] {
  if (ids.length !== 2 || ids[0] === ids[1]) return [];
  return fixtures
    .filter(
      (f) =>
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
  return `${f.stage === 'group' ? officeName(f.office) : stageName(f.stage)} #${f.fixture_no}`;
}
export function isCompleted(f: FixtureResult) {
  return Boolean(
    f.match?.completed_at && f.match.winner_player_id && !f.match.ended_early,
  );
}
export function countsForPlayer(fixture: Fixture, playerId: string | null) {
  if (!playerId) return true;
  return fixture.player_a_id === playerId
    ? fixture.counts_for_a !== false
    : fixture.player_b_id === playerId && fixture.counts_for_b !== false;
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
export type QualificationTie = {
  context: string;
  label: string;
  office: Office | null;
  players: Standing[];
  places: number;
  ready: boolean;
};
function resolveTie(
  fixtures: FixtureResult[],
  rows: Standing[],
  label: string,
  office: Office | null,
  places: number,
  ready: boolean,
): QualificationTie {
  const context = JSON.stringify([
    label,
    rows
      .map((r) => [r.key, r.wins, r.average, r.played, r.remaining])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  ]);
  const defeated = new Set(
    fixtures
      .filter(
        (f) =>
          f.stage === 'tiebreak' && f.tie_context === context && isCompleted(f),
      )
      .flatMap((f) =>
        [f.player_a_id, f.player_b_id].filter(
          (id) => id && id !== f.match?.winner_player_id,
        ),
      ),
  );
  return {
    context,
    label,
    office,
    places,
    ready,
    players: rows.filter((r) => !defeated.has(r.player.id)),
  };
}
export function buildStandings({ fixtures, players }: Snapshot) {
  const ties: QualificationTie[] = [];
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
          counts: fixture.counts_for_a !== false,
        },
        {
          id: fixture.player_b_id,
          name: fixture.player_b_name,
          opponent: fixture.player_a_id,
          counts: fixture.counts_for_b !== false,
        },
      ];
      for (const { id, name, opponent, counts } of sides) {
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
            scheduled: 0,
            excluded: 0,
            needsDiscard: false,
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
        row.scheduled++;
        if (!counts) row.excluded++;
        if (!isCompleted(fixture)) {
          row.remaining++;
          continue;
        }
        if (!counts) continue;
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
      row.needsDiscard = row.scheduled === 6 && row.excluded !== 1;
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
    const fourth = table[3],
      fifth = table[4];
    if (fourth && fifth && sameOfficeTie(fourth, fifth)) {
      const tied = table.filter((r) => sameOfficeTie(r, fourth));
      const first = table.indexOf(tied[0]);
      const tie = resolveTie(
        fixtures,
        tied,
        `${officeName(office)} fourth place`,
        office,
        4 - first,
        group.every(isCompleted),
      );
      if (tie.players.length > tie.places) {
        ties.push(tie);
        tied.forEach((r) => {
          r.tiedForFourth = true;
        });
      } else {
        const alive = new Set(tie.players.map((r) => r.key));
        table.splice(
          first,
          tied.length,
          ...tied.filter((r) => alive.has(r.key)),
          ...tied.filter((r) => !alive.has(r.key)),
        );
      }
    }
    table.forEach((r, i) => {
      r.rank = i + 1;
      r.qualification = r.tiedForFourth
        ? null
        : i === 0
          ? 'bye'
          : i === 1
            ? 'bye-candidate'
            : i < 4
              ? 'playoff'
              : null;
    });
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
  else if (best.length > 1) {
    const tie = resolveTie(
      fixtures,
      best,
      'Fourth bye',
      null,
      1,
      offices.every((o) => o.played === o.total),
    );
    if (tie.players.length === 1 && !tie.players[0].tiedForFourth)
      tie.players[0].qualification = 'bye';
    else {
      ties.push(tie);
      best.forEach((r) => {
        r.tiedForBye = true;
      });
    }
  }
  const pendingDiscards = offices.flatMap((o) => o.table.filter((r) => r.needsDiscard));
  if (pendingDiscards.length) ties.forEach((tie) => { tie.ready = false; });
  return {
    pendingDiscards,
    ties,
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
        .filter((f) => f.stage === 'group')
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

export function stageName(stage: Stage): string {
  return {
    group: 'Group stage',
    playoff: 'Play-off',
    quarterfinal: 'Quarterfinal',
    semifinal: 'Semifinal',
    final: 'Final',
    tiebreak: 'Tie-break',
  }[stage];
}
export function fixtureFormat(stage: Stage) {
  return {
    startScore: stage === 'final' ? '501' : '301',
    finish:
      stage === 'quarterfinal' || stage === 'semifinal' || stage === 'final'
        ? 'double_out'
        : 'single_out',
    legsToWin: 2,
  } satisfies {
    startScore: '301' | '501';
    finish: 'single_out' | 'double_out';
    legsToWin: number;
  };
}
export function tournamentActivity(
  fixtures: FixtureResult[],
  now = new Date(),
) {
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Oslo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const today = date.format(now);
  const completed = fixtures.filter(isCompleted);
  const playedToday = completed.filter(
    (f) => date.format(new Date(f.match!.completed_at!)) === today,
  );
  return {
    today: playedToday.length,
    groupToday: playedToday.filter((f) => f.stage === 'group').length,
  };
}
