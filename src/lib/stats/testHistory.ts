import type { RawPlayerDetail } from './remote';
import type { LegRow, MatchRow, PlayerSegmentRow, ThrowRow, TurnRow } from './types';

/** A deterministic history with the edge cases the database regression also seeds, for the stats tests. */

export const NOW = new Date('2026-10-12T12:00:00.000Z');
export const PLAYERS = ['p-ada', 'p-ben', 'p-cyd', 'p-dan'];
export const SEGMENTS: Array<[string, number]> = [
  ['T20', 60], ['20', 20], ['S20', 20], ['D20', 40], ['1', 1], ['S1', 1], ['5', 5], ['S5', 5],
  ['T19', 57], ['19', 19], ['S19', 19], ['D19', 38], ['3', 3], ['S3', 3], ['7', 7], ['S7', 7],
  ['T5', 15], ['D12', 24], ['S12', 12], ['OuterBull', 25], ['InnerBull', 50], ['Miss', 0], ['MISS', 0],
];

export function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type History = { matches: (MatchRow & { ended_early: boolean })[]; legs: LegRow[]; turns: TurnRow[]; throws: ThrowRow[] };

/** `matches` matches spread over the `days` before NOW (70 over 91 days by default). */
export function buildHistory(seed: number, { matches = 70, days = 91 }: { matches?: number; days?: number } = {}): History {
  const rnd = random(seed);
  const pick = <T,>(items: T[]) => items[Math.floor(rnd() * items.length)];
  const history: History = { matches: [], legs: [], turns: [], throws: [] };
  for (let m = 0; m < matches; m++) {
    const start = new Date(NOW.getTime() - (95 - m * (days / matches)) * 86_400_000 - Math.floor(rnd() * 5) * 3_600_000);
    const players = PLAYERS.filter(() => rnd() < 0.6);
    if (players.length < 2) players.splice(0, players.length, PLAYERS[m % 4], PLAYERS[(m + 1) % 4]);
    const match = {
      id: `m-${String(m).padStart(3, '0')}`,
      created_at: start.toISOString(),
      // Some matches are won by someone who never threw in them.
      winner_player_id: rnd() < 0.15 ? null : rnd() < 0.05 ? pick(PLAYERS) : pick(players),
      start_score: pick(['201', '301', '501']),
      finish: pick(['single_out', 'double_out'] as const),
      ended_early: rnd() < 0.1,
    };
    history.matches.push(match);
    const legCount = 1 + Math.floor(rnd() * 3);
    for (let l = 0; l < legCount; l++) {
      const legAt = start.getTime() + l * 900_000;
      const leg = {
        id: `l-${match.id}-${l}`,
        match_id: match.id,
        leg_number: l + 1,
        created_at: new Date(legAt).toISOString(),
        winner_player_id: rnd() < 0.1 ? null : rnd() < 0.05 ? pick(PLAYERS) : pick(players),
      };
      history.legs.push(leg);
      const turnCount = Math.floor(rnd() * 14);
      for (let t = 0; t < turnCount; t++) {
        // Every fifth turn shares its timestamp with the previous one: the id breaks the tie.
        const at = new Date(legAt + (t - (t % 5 === 4 ? 1 : 0)) * 40_000).toISOString();
        const busted = rnd() < 0.08;
        const dartCount = rnd() < 0.05 ? 0 : rnd() < 0.15 ? 1 + Math.floor(rnd() * 2) : 3;
        const turnId = `t-${leg.id}-${String(t).padStart(2, '0')}`;
        let total = 0;
        for (let d = 1; d <= dartCount; d++) {
          const [segment, scored] = pick(SEGMENTS);
          total += scored;
          history.throws.push({ id: `th-${turnId}-${d}`, turn_id: turnId, dart_index: d, segment, scored });
        }
        history.turns.push({
          id: turnId, leg_id: leg.id, player_id: players[t % players.length], total_scored: busted ? 0 : total,
          busted, turn_number: t + 1, created_at: at,
        });
      }
    }
  }
  return history;
}

export const byTimeThenId = <T extends { created_at: string; id: string }>(a: T, b: T) =>
  a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);

/** What the page downloaded before: every leg and match, and the player's turns and throws. */
export function legacyView(history: History, playerId: string) {
  const live = new Set(history.matches.filter((m) => !m.ended_early).map((m) => m.id));
  const legs = history.legs.filter((l) => live.has(l.match_id)).sort(byTimeThenId);
  const liveLegs = new Set(legs.map((l) => l.id));
  const matches = history.matches.filter((m) => !m.ended_early).sort(byTimeThenId)
    .map(({ id, created_at, winner_player_id, start_score, finish }) => ({ id, created_at, winner_player_id, start_score, finish }));
  const turns = history.turns.filter((t) => t.player_id === playerId && liveLegs.has(t.leg_id)).sort(byTimeThenId);
  const turnIds = new Set(turns.map((t) => t.id));
  // The batched throw requests came back in no particular order.
  const rnd = random(7);
  const throws = history.throws.filter((th) => turnIds.has(th.turn_id))
    .map((th) => ({ th, key: rnd() })).sort((a, b) => a.key - b.key).map(({ th }) => th);
  return { legs, matches, turns, throws };
}

/** What `stats_player_detail()` returns for the same history (mirrors the SQL). */
export function playerDetailPayload(history: History, playerId: string, segments: PlayerSegmentRow[]): RawPlayerDetail {
  const { legs, matches, turns } = legacyView(history, playerId);
  const playedLegs = new Set(turns.map((t) => t.leg_id));
  const playerLegs = legs.filter((l) => playedLegs.has(l.id) || l.winner_player_id === playerId);
  const legMatches = new Set(playerLegs.map((l) => l.match_id));
  const playerMatches = matches.filter((m) => legMatches.has(m.id) || m.winner_player_id === playerId);
  const throwsByTurn = new Map<string, ThrowRow[]>();
  for (const th of history.throws) throwsByTurn.set(th.turn_id, [...(throwsByTurn.get(th.turn_id) ?? []), th]);
  return {
    turns: turns.map((t) => [t.id, t.leg_id, t.total_scored, t.busted, t.turn_number, t.created_at,
      (throwsByTurn.get(t.id) ?? []).sort((a, b) => a.dart_index - b.dart_index)
        .map((th) => [th.dart_index, th.segment, th.scored] as [number, string, number])]),
    legs: playerLegs.map((l) => [l.id, l.match_id, l.leg_number, l.created_at, l.winner_player_id]),
    matches: playerMatches.map((m) => [m.id, m.created_at, m.winner_player_id, m.start_score, m.finish]),
    segments: segments.filter((s) => s.player_id === playerId),
    adjacency: [],
  };
}

/** player_segment_summary for every player, computed from the history like the view does. */
export function segmentSummary(history: History): PlayerSegmentRow[] {
  const rows = new Map<string, PlayerSegmentRow>();
  for (const player of PLAYERS) {
    const { throws } = legacyView(history, player);
    for (const th of throws) {
      const key = `${player}|${th.segment}`;
      const row = rows.get(key) ?? {
        player_id: player, display_name: player, segment: th.segment, total_hits: 0, total_score: 0, avg_score: 0, segment_number: null,
      };
      row.total_hits += 1;
      row.total_score += th.scored;
      row.avg_score = row.total_score / row.total_hits;
      rows.set(key, row);
    }
  }
  return [...rows.values()];
}
