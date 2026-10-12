import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Day buckets follow the browser's local midnights, so pin a zone with daylight saving time.
process.env.TZ = 'Europe/Oslo';

const { client } = vi.hoisted(() => ({ client: { current: null as unknown } }));
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: async () => client.current }));

import { leaderboardListsQuery, leaderboardQuery } from './useLeaderboardData';

type Row = Record<string, unknown>;
type Match = { id: string; created_at: string; ended_early: boolean; winner_player_id: string | null };
type MultiElo = { id: string; player_id: string; created_at: string; rating_before: number; rating_after: number; rating_change: number };
type Data = {
  players: Row[];
  summary: Row[];
  elo: Row[];
  eloMulti: Row[];
  recentForm: Row[];
  matches: Match[];
  matchPlayers: { match_id: string; player_id: string }[];
  multiElo: MultiElo[];
};

/** Minimal PostgREST stand-in: eq/gte/gt (dotted paths reach embedded rows), order and limit. */
function query(rows: Row[]) {
  const filters: ((row: Row) => boolean)[] = [];
  let sort: ((a: Row, b: Row) => number) | null = null;
  let limit = Infinity;
  const read = (row: Row, path: string) => path.split('.').reduce<unknown>((value, key) => (value as Row | null)?.[key], row);
  const builder = {
    select: () => builder,
    eq: (path: string, value: unknown) => { filters.push((row) => read(row, path) === value); return builder; },
    gte: (path: string, value: string) => { filters.push((row) => String(read(row, path)) >= value); return builder; },
    gt: (path: string, value: number) => { filters.push((row) => Number(read(row, path)) > value); return builder; },
    order: (path: string, { ascending }: { ascending: boolean }) => {
      const previous = sort;
      sort = (a, b) => previous?.(a, b) || (Number(read(a, path)) - Number(read(b, path))) * (ascending ? 1 : -1);
      return builder;
    },
    limit: (n: number) => { limit = n; return builder; },
    // Like a real query builder: a thenable that resolves to the result and supports chaining.
    then: <T>(resolve: (result: { data: Row[]; error: null }) => T, reject?: (error: unknown) => T) => {
      const result = rows.filter((row) => filters.every((filter) => filter(row)));
      if (sort) result.sort(sort);
      return Promise.resolve({ data: result.slice(0, limit), error: null }).then(resolve, reject);
    },
  };
  return builder;
}

const missing = (code: string) => ({ data: null, error: { code, message: 'not deployed yet' } });

/** The new SQL objects, reimplemented over the same raw rows (supabase/tests checks the SQL itself). */
function aggregates(data: Data) {
  const decided = new Map(data.matches.filter((m) => !m.ended_early && m.winner_player_id).map((m) => [m.id, m]));
  const records = new Map<string, { player_id: string; games_played: number; wins: number }>();
  for (const mp of data.matchPlayers) {
    const match = decided.get(mp.match_id);
    if (!match) continue;
    const record = records.get(mp.player_id) ?? { player_id: mp.player_id, games_played: 0, wins: 0 };
    record.games_played += 1;
    if (match.winner_player_id === mp.player_id) record.wins += 1;
    records.set(mp.player_id, record);
  }
  return {
    player_match_records: [...records.values()].reverse(),
    count_matches_in_windows: ({ p_starts, p_ends }: { p_starts: string[]; p_ends: string[] }) =>
      p_starts.map((start, i) => data.matches.filter((m) =>
        !m.ended_early && Date.parse(m.created_at) >= Date.parse(start) && Date.parse(m.created_at) < Date.parse(p_ends[i])).length),
    get_multi_elo_climbs: ({ p_since }: { p_since: string }) => {
      const byPlayer = new Map<string, MultiElo[]>();
      const inWindow = data.multiElo
        .filter((row) => Date.parse(row.created_at) >= Date.parse(p_since))
        .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
      for (const row of inWindow) byPlayer.set(row.player_id, [...(byPlayer.get(row.player_id) ?? []), row]);
      return [...byPlayer.values()].map((rows) => ({
        player_id: rows[0].player_id,
        rating_change: rows.reduce((sum, row) => sum + row.rating_change, 0),
        rating_history: [rows[0].rating_before, ...rows.map((row) => row.rating_after)],
      }));
    },
  };
}

function fakeSupabase(data: Data, { deployed }: { deployed: boolean }) {
  const agg = aggregates(data);
  const matchesById = new Map(data.matches.map((m) => [m.id, m]));
  const tables: Record<string, () => Row[]> = {
    player_summary: () => data.summary,
    player_elo_stats: () => data.elo,
    player_elo_stats_multi: () => data.eloMulti,
    players: () => data.players,
    player_recent_form: () => data.recentForm,
    // The old raw reads, in the database's (insertion) order.
    match_players: () => data.matchPlayers.map((mp) => ({ player_id: mp.player_id, matches: matchesById.get(mp.match_id) })),
    matches: () => data.matches,
    elo_ratings_multi: () => data.multiElo,
  };
  const calls: string[] = [];
  return {
    calls,
    from(table: string) {
      calls.push(table);
      if (table === 'player_match_records') {
        return deployed ? query(agg.player_match_records) : { select: () => Promise.resolve(missing('PGRST205')) };
      }
      return query(tables[table]());
    },
    rpc(name: 'count_matches_in_windows' | 'get_multi_elo_climbs', params: never) {
      calls.push(name);
      if (!deployed) return Promise.resolve(missing('PGRST202'));
      return Promise.resolve({ data: agg[name](params), error: null });
    },
  };
}

/** Deterministic pseudo-random history with the edge cases the counts must agree on. */
function history(now: Date): Data {
  let seed = 7;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const ids = Array.from({ length: 12 }, (_, i) => `p${String(i).padStart(2, '0')}`);
  const players = ids.map((id, i) => ({
    id, location: ['bergen', 'vik', null][i % 3], avatar_url: i % 2 ? `/a/${id}.png` : null,
    created_at: new Date(now.getTime() - i * 2 * 86_400_000).toISOString(), is_active: i !== 5,
  }));
  // p11 never appears in the name lists, so the climber must skip it.
  const named = ids.slice(0, 11);
  const summary = named.map((id, i) => ({ player_id: id, display_name: `Player ${id}`, wins: 30 - i, avg_per_turn: 40 + ((i * 7) % 11) }));
  const elo = named.slice(0, 8).map((id, i) => ({ player_id: id, display_name: `Player ${id}`, current_rating: 1400 - i * 10, total_rated_matches: 5 + i }));
  const eloMulti = named.slice(3).map((id, i) => ({ player_id: id, display_name: `Player ${id}`, current_rating: 1300 - i * 5, total_rated_matches: 4 + i }));
  const recentForm = named.map((id, i) => ({ player_id: id, last_10_results: i % 4 === 0 ? null : [1, 0, 1].slice(0, 1 + (i % 3)) }));

  const matches: Match[] = [];
  const matchPlayers: { match_id: string; player_id: string }[] = [];
  for (let i = 0; i < 420; i++) {
    // Spread over 75 days with a quarter of the matches within an hour of a local midnight, where
    // 24-hour bucketing and daylight-saving changes interact.
    const day = Math.floor(random() * 75);
    const local = new Date(now);
    local.setDate(local.getDate() - day);
    local.setHours(0, 0, 0, 0);
    const minutes = random() < 0.25 ? Math.floor(random() * 120) - 60 : Math.floor(random() * 1440);
    const created = new Date(local.getTime() + minutes * 60_000 + Math.floor(random() * 60_000));
    const lineup = ids.filter(() => random() < 0.3).slice(0, 4);
    if (lineup.length < 2) lineup.splice(0, lineup.length, ids[i % 12], ids[(i + 1) % 12]);
    const endedEarly = random() < 0.08;
    const undecided = !endedEarly && random() < 0.05;
    const id = `m${i}`;
    matches.push({
      id, created_at: created.toISOString(), ended_early: endedEarly,
      winner_player_id: endedEarly || undecided ? null : lineup[Math.floor(random() * lineup.length)],
    });
    for (const player of lineup) matchPlayers.push({ match_id: id, player_id: player });
  }

  const multiElo: MultiElo[] = [];
  const decidedRecent = matches.filter((m) => m.winner_player_id && Date.parse(m.created_at) > now.getTime() - 10 * 86_400_000)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const match of decidedRecent) {
    for (const mp of matchPlayers.filter((row) => row.match_id === match.id)) {
      const change = mp.player_id === match.winner_player_id ? 9 + Math.floor(random() * 10) : -Math.floor(random() * 9);
      const before = 1200 + Math.floor(random() * 200);
      multiElo.push({ id: `e${multiElo.length}`, player_id: mp.player_id, created_at: match.created_at, rating_before: before, rating_after: before + change, rating_change: change });
    }
  }
  return { players, summary, elo, eloMulti, recentForm, matches, matchPlayers, multiElo };
}

async function load(data: Data, deployed: boolean) {
  const supabase = fakeSupabase(data, { deployed });
  client.current = supabase;
  const result = await leaderboardQuery().queryFn!({} as never);
  return { result, calls: supabase.calls };
}

describe('leaderboard data from database aggregates', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }));
  afterEach(() => vi.useRealTimers());

  it.each([
    ['the night after daylight saving time ends', '2026-10-26T00:20:00+01:00'],
    ['the morning after daylight saving time starts', '2026-03-30T07:45:00+02:00'],
    ['an ordinary afternoon', '2026-08-12T15:10:00+02:00'],
  ])('matches the raw-row computation on %s', async (_label, at) => {
    vi.setSystemTime(new Date(at));
    const data = history(new Date(at));
    const oracle = await load(data, false);
    const fromAggregates = await load(data, true);

    expect(fromAggregates.result).toEqual(oracle.result);
    expect(oracle.result.matchActivity.thirtyDayTotal).toBeGreaterThan(0);
    expect(oracle.result.weeklyEloClimber).not.toBeNull();
    expect(oracle.result.playerGameStats.size).toBeGreaterThan(5);
    // The aggregates replace the three raw history reads.
    expect(fromAggregates.calls).not.toContain('match_players');
    expect(fromAggregates.calls).not.toContain('matches');
    expect(fromAggregates.calls).not.toContain('elo_ratings_multi');
    expect(oracle.calls).toEqual(expect.arrayContaining(['match_players', 'matches', 'elo_ratings_multi']));
  });

  it('breaks a weekly-climber tie by who climbed first, like the raw rows did', async () => {
    const at = '2026-08-12T15:10:00+02:00';
    vi.setSystemTime(new Date(at));
    const data = history(new Date(at));
    data.multiElo = [
      { id: 'e2', player_id: 'p02', created_at: '2026-08-11T09:00:00.000Z', rating_before: 1250, rating_after: 1270, rating_change: 20 },
      { id: 'e1', player_id: 'p01', created_at: '2026-08-10T09:00:00.000Z', rating_before: 1200, rating_after: 1220, rating_change: 20 },
      { id: 'e3', player_id: 'p11', created_at: '2026-08-10T08:00:00.000Z', rating_before: 1100, rating_after: 1190, rating_change: 90 },
    ].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const oracle = await load(data, false);
    const fromAggregates = await load(data, true);
    expect(fromAggregates.result.weeklyEloClimber).toEqual(oracle.result.weeklyEloClimber);
    expect(oracle.result.weeklyEloClimber).toMatchObject({ player_id: 'p01', rating_change: 20, rating_history: [1200, 1220] });
  });

  it('loads only the ranked lists for the leaderboards page', async () => {
    vi.setSystemTime(new Date('2026-08-12T15:10:00+02:00'));
    const supabase = fakeSupabase(history(new Date()), { deployed: true });
    client.current = supabase;
    const lists = await leaderboardListsQuery(10).queryFn!({} as never);
    const full = await leaderboardQuery(10).queryFn!({} as never);
    expect(lists).toEqual({
      leaders: full.leaders, avgLeaders: full.avgLeaders, eloLeaders: full.eloLeaders, eloMultiLeaders: full.eloMultiLeaders,
    });
    expect(lists.leaders).toHaveLength(10);
    expect(supabase.calls.slice(0, 3).sort()).toEqual(['player_elo_stats', 'player_elo_stats_multi', 'player_summary']);
  });

  it('fails instead of caching zeros when an aggregate times out', async () => {
    vi.setSystemTime(new Date('2026-08-12T15:10:00+02:00'));
    const supabase = fakeSupabase(history(new Date()), { deployed: true });
    const timeout = { code: '57014', message: 'canceling statement due to statement timeout' };
    client.current = { ...supabase, rpc: () => Promise.resolve({ data: null, error: timeout }) };
    await expect(leaderboardQuery().queryFn!({} as never)).rejects.toBe(timeout);
  });
});
