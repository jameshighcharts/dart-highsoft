import type { Player } from '@/lib/match/types';
import { buildStandings, type Office, type Stage } from './standings';

export const FINAL_STAGES = [
  'playoff',
  'quarterfinal',
  'semifinal',
  'final',
] as const;
export type FinalsStage = (typeof FINAL_STAGES)[number];
export type Finalist = { player: Player; office: Office; rank: number };
export type Pair = [Finalist, Finalist];
export type DrawSelection = { byes: string[]; playoffs: [string, string][] };
export type BracketGame = {
  key: string;
  stage: FinalsStage;
  position: number;
  a: Finalist | null;
  b: Finalist | null;
  nextKey: string | null;
  nextSlot: 'a' | 'b' | null;
};
type Standings = ReturnType<typeof buildStandings>;

export function isFinalsStage(stage: Stage): stage is FinalsStage {
  return (
    stage === 'playoff' ||
    stage === 'quarterfinal' ||
    stage === 'semifinal' ||
    stage === 'final'
  );
}
function permutations<T>(items: T[]): T[][] {
  if (!items.length) return [[]];
  return items.flatMap((item, i) =>
    permutations(items.filter((_, j) => j !== i)).map((rest) => [
      item,
      ...rest,
    ]),
  );
}
function validPlayoff(a: Finalist, b: Finalist) {
  return (
    a.office !== b.office &&
    ((a.rank === 2 && b.rank === 4) ||
      (a.rank === 4 && b.rank === 2) ||
      (a.rank === 3 && b.rank === 4) ||
      (a.rank === 4 && b.rank === 3) ||
      (a.rank === 3 && b.rank === 3))
  );
}
function pairings(players: Finalist[]): Pair[][] {
  const [first, ...rest] = players;
  if (!first) return [[]];
  return rest.flatMap((other, i) =>
    validPlayoff(first, other)
      ? pairings(rest.filter((_, j) => j !== i)).map((pairs) => [
          [first, other] satisfies Pair,
          ...pairs,
        ])
      : [],
  );
}
function separationCost(byes: Finalist[], playoffs: Pair[]) {
  if (byes.length !== 4 || playoffs.length !== 4) return Infinity;
  if (byes[0].office === byes[1].office || byes[2].office === byes[3].office)
    return Infinity;
  const qf = playoffs.reduce(
    (n, pair, i) => n + pair.filter((p) => p.office === byes[i].office).length,
    0,
  );
  const fields = playoffs.map((pair, i) => [byes[i], ...pair]);
  const semi = [0, 2].reduce(
    (n, i) =>
      n +
      fields[i].reduce(
        (sum, a) =>
          sum + fields[i + 1].filter((b) => a.office === b.office).length,
        0,
      ),
    0,
  );
  return qf * 100 + semi;
}
export function bracketGames(
  byes: (Finalist | null)[],
  playoffs: [Finalist | null, Finalist | null][],
): BracketGame[] {
  const games: BracketGame[] = [];
  for (let i = 0; i < 4; i++)
    games.push({
      key: `playoff-${i + 1}`,
      stage: 'playoff',
      position: i + 1,
      a: playoffs[i]?.[0] ?? null,
      b: playoffs[i]?.[1] ?? null,
      nextKey: `quarterfinal-${i + 1}`,
      nextSlot: 'b',
    });
  for (let i = 0; i < 4; i++)
    games.push({
      key: `quarterfinal-${i + 1}`,
      stage: 'quarterfinal',
      position: i + 1,
      a: byes[i] ?? null,
      b: null,
      nextKey: `semifinal-${Math.floor(i / 2) + 1}`,
      nextSlot: i % 2 === 0 ? 'a' : 'b',
    });
  for (let i = 0; i < 2; i++)
    games.push({
      key: `semifinal-${i + 1}`,
      stage: 'semifinal',
      position: i + 1,
      a: null,
      b: null,
      nextKey: 'final-1',
      nextSlot: i === 0 ? 'a' : 'b',
    });
  games.push({
    key: 'final-1',
    stage: 'final',
    position: 1,
    a: null,
    b: null,
    nextKey: null,
    nextSlot: null,
  });
  return games;
}
export function projectFinals(standings: Standings) {
  const eligible = standings.offices.flatMap((o) =>
    o.table
      .filter(
        (r) =>
          r.rank <= 4 &&
          r.played > 0 &&
          r.player.id &&
          !r.tiedForFourth &&
          !r.tiedForBye,
      )
      .map((r) => ({ player: r.player, office: o.office, rank: r.rank })),
  );
  const byeIds = new Set(
    standings.byes
      .filter((r) => r.played > 0 && !r.tiedForFourth && !r.tiedForBye)
      .map((r) => r.player.id),
  );
  const byes = eligible.filter((p) => byeIds.has(p.player.id));
  const playoff = eligible.filter((p) => !byeIds.has(p.player.id));
  let draw: { byes: Finalist[]; playoffs: Pair[] } = { byes, playoffs: [] };
  let cost = Infinity;
  if (
    byes.length === 4 &&
    playoff.length === 8 &&
    new Set(eligible.map((p) => p.player.id)).size === 12
  ) {
    for (const pairs of pairings(playoff)) {
      for (const ordered of permutations(pairs)) {
        // The first bye can be fixed: reversing/rotating halves covers its equivalent positions.
        for (const rest of permutations(byes.slice(1))) {
          const arranged = [byes[0], ...rest];
          const score = separationCost(arranged, ordered);
          if (score < cost) {
            cost = score;
            draw = { byes: arranged, playoffs: ordered };
          }
        }
      }
    }
  }
  const resolved = Number.isFinite(cost);
  const ready =
    resolved &&
    standings.total > 0 &&
    standings.played === standings.total &&
    standings.ties.length === 0 &&
    standings.pendingDiscards.length === 0;
  return {
    ...draw,
    eligible,
    cost,
    resolved,
    ready,
    games: bracketGames(draw.byes, draw.playoffs),
    selection: {
      byes: draw.byes.map((p) => p.player.id),
      playoffs: draw.playoffs.map(
        ([a, b]) => [a.player.id, b.player.id] satisfies [string, string],
      ),
    },
  };
}
export function validateDraw(
  standings: Standings,
  selection: DrawSelection,
): { ok: true; games: BracketGame[] } | { ok: false; error: string } {
  const projected = projectFinals(standings);
  if (!projected.ready)
    return {
      ok: false,
      error:
        'Complete every group fixture, choose the required excluded results, and resolve qualification ties before locking the draw.',
    };
  if (selection.byes.length !== 4 || selection.playoffs.length !== 4)
    return {
      ok: false,
      error: 'The draw needs four byes and four play-off pairs.',
    };
  const lookup = new Map(projected.eligible.map((p) => [p.player.id, p]));
  const byes = selection.byes.flatMap((id) => lookup.get(id) ?? []);
  const pairs: Pair[] = [];
  for (const [aId, bId] of selection.playoffs) {
    const a = lookup.get(aId),
      b = lookup.get(bId);
    if (!a || !b || !validPlayoff(a, b))
      return {
        ok: false,
        error: 'Play-off pairs must follow the office and rank rules.',
      };
    pairs.push([a, b]);
  }
  const ids = [...selection.byes, ...selection.playoffs.flat()];
  if (
    ids.length !== 12 ||
    new Set(ids).size !== 12 ||
    byes.length !== 4 ||
    byes.some((p) => !projected.byes.some((b) => b.player.id === p.player.id))
  )
    return {
      ok: false,
      error: 'Use every qualified player once and keep the four earned byes.',
    };
  if (separationCost(byes, pairs) > projected.cost)
    return {
      ok: false,
      error:
        'Keep same-office players apart as late as possible, with two office byes in opposite halves.',
    };
  return { ok: true, games: bracketGames(byes, pairs) };
}
