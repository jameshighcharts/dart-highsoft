import { buildStandings, isCompleted, normalizeName, resultStats, type Snapshot } from './standings';

export function buildSheetExport(snapshot: Snapshot) {
  const standings = buildStandings(snapshot);
  const group = snapshot.fixtures.filter((f) => f.stage === 'group');
  const names = new Map<string, string>();
  for (const f of group) {
    names.set(f.player_a_id ?? `unlinked:${normalizeName(f.player_a_name)}`, f.player_a_name);
    names.set(f.player_b_id ?? `unlinked:${normalizeName(f.player_b_name)}`, f.player_b_name);
  }
  const name = (id: string | null, fallback = '') => id ? names.get(id) ?? fallback : fallback;
  const finals = snapshot.fixtures.filter((f) => ['playoff', 'quarterfinal', 'semifinal', 'final'].includes(f.stage));
  const locked = finals.some((f) => f.stage === 'final');
  const byes = locked ? finals.filter((f) => f.stage === 'quarterfinal').map((f) => f.player_a_id) : [];
  const byeForOffice = (office: string) => {
    const row = standings.offices.find((o) => o.office === office)?.table.find((r) => r.rank === 1 && byes.includes(r.player.id));
    return row ? name(row.player.id, row.player.display_name) : '';
  };
  const second = standings.offices.flatMap((o) => o.table).find((r) => r.rank === 2 && byes.includes(r.player.id));

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    fixtures: group.map((f) => {
      const completed = isCompleted(f);
      const a = resultStats(f, f.player_a_id);
      const b = resultStats(f, f.player_b_id);
      return {
        office: f.office,
        number: f.fixture_no,
        players: [f.player_a_name, f.player_b_name],
        result: completed ? [a.legs, b.legs, a.average, b.average] : ['', '', '', ''],
        counts: ['counts_for_a' in f && f.counts_for_a === false ? 0 : 1, 'counts_for_b' in f && f.counts_for_b === false ? 0 : 1],
      };
    }),
    standings: standings.offices.map((o) => ({
      office: o.office,
      rows: o.table.map((r) => [r.rank, names.get(r.key) ?? r.player.display_name, r.wins, r.played, r.average]),
    })),
    byes: [byeForOffice('vik'), byeForOffice('bergen'), byeForOffice('sogndal'), second ? name(second.player.id, second.player.display_name) : ''],
    finals: locked ? finals.map((f) => ({
      stage: f.stage,
      number: f.fixture_no,
      values: [name(f.player_a_id, f.player_a_name), name(f.player_b_id, f.player_b_name), isCompleted(f) ? name(f.match?.winner_player_id ?? null) : ''],
    })) : [],
  };
}
