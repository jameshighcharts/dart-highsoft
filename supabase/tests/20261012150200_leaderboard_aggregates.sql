begin;

select plan(16);

-- Players: a, b, c play X01; t is a test player and i is inactive (both excluded from checkouts).
insert into public.players (id, display_name, is_test, is_active) values
  ('51000000-0000-0000-0000-00000000000a', 'Aggregate Alice', false, true),
  ('51000000-0000-0000-0000-00000000000b', 'Aggregate Bob', false, true),
  ('51000000-0000-0000-0000-00000000000c', 'Aggregate Cleo', false, true),
  ('51000000-0000-0000-0000-00000000000d', 'Aggregate Dora', false, true),
  ('51000000-0000-0000-0000-000000000011', 'Aggregate Test', true, true),
  ('51000000-0000-0000-0000-000000000012', 'Aggregate Inactive', false, false);

-- m1, m2: Alice beats Bob. m3: three players, Cleo wins. m4: ended early (excluded). m5: undecided
-- (excluded). m6: Dora's only match, ended early, so Dora has no record at all. m7: the test
-- player wins; m8: the inactive player wins (their checkouts must not be listed).
insert into public.matches (id, mode, start_score, finish, legs_to_win, created_at, winner_player_id, ended_early) values
  ('52000000-0000-0000-0000-000000000001', 'x01', '501', 'double_out', 1, '2096-10-24 21:59:59.999999+00', '51000000-0000-0000-0000-00000000000a', false),
  ('52000000-0000-0000-0000-000000000002', 'x01', '501', 'double_out', 1, '2096-10-24 22:00:00+00', '51000000-0000-0000-0000-00000000000a', false),
  ('52000000-0000-0000-0000-000000000003', 'x01', '301', 'single_out', 1, '2096-10-25 23:00:00+00', '51000000-0000-0000-0000-00000000000c', false),
  ('52000000-0000-0000-0000-000000000004', 'x01', '501', 'double_out', 1, '2096-10-25 12:00:00+00', null, true),
  ('52000000-0000-0000-0000-000000000005', 'x01', '501', 'double_out', 1, '2096-10-25 13:00:00+00', null, false),
  ('52000000-0000-0000-0000-000000000006', 'x01', '501', 'double_out', 1, '2096-10-25 14:00:00+00', null, true),
  ('52000000-0000-0000-0000-000000000007', 'x01', '501', 'double_out', 1, '2096-10-25 15:00:00+00', '51000000-0000-0000-0000-000000000011', false),
  ('52000000-0000-0000-0000-000000000008', 'x01', '501', 'double_out', 1, '2096-10-25 16:00:00+00', '51000000-0000-0000-0000-000000000012', false);

insert into public.match_players (match_id, player_id, play_order) values
  ('52000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-00000000000a', 1),
  ('52000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-00000000000b', 2),
  ('52000000-0000-0000-0000-000000000002', '51000000-0000-0000-0000-00000000000b', 1),
  ('52000000-0000-0000-0000-000000000002', '51000000-0000-0000-0000-00000000000a', 2),
  ('52000000-0000-0000-0000-000000000003', '51000000-0000-0000-0000-00000000000a', 1),
  ('52000000-0000-0000-0000-000000000003', '51000000-0000-0000-0000-00000000000b', 2),
  ('52000000-0000-0000-0000-000000000003', '51000000-0000-0000-0000-00000000000c', 3),
  ('52000000-0000-0000-0000-000000000004', '51000000-0000-0000-0000-00000000000a', 1),
  ('52000000-0000-0000-0000-000000000004', '51000000-0000-0000-0000-00000000000c', 2),
  ('52000000-0000-0000-0000-000000000005', '51000000-0000-0000-0000-00000000000b', 1),
  ('52000000-0000-0000-0000-000000000005', '51000000-0000-0000-0000-00000000000c', 2),
  ('52000000-0000-0000-0000-000000000006', '51000000-0000-0000-0000-00000000000d', 1),
  ('52000000-0000-0000-0000-000000000006', '51000000-0000-0000-0000-00000000000a', 2),
  ('52000000-0000-0000-0000-000000000007', '51000000-0000-0000-0000-000000000011', 1),
  ('52000000-0000-0000-0000-000000000007', '51000000-0000-0000-0000-00000000000a', 2),
  ('52000000-0000-0000-0000-000000000008', '51000000-0000-0000-0000-000000000012', 1),
  ('52000000-0000-0000-0000-000000000008', '51000000-0000-0000-0000-00000000000b', 2);

-- The computation the client did on raw match_players rows, restricted to this test's matches.
create temporary table expected_records on commit drop as
select mp.player_id,
  count(*)::integer as games_played,
  (count(*) filter (where m.winner_player_id = mp.player_id))::integer as wins
from public.match_players mp
join public.matches m on m.id = mp.match_id
where m.ended_early = false and m.winner_player_id is not null
group by mp.player_id;

select set_eq(
  $$select player_id, games_played, wins from public.player_match_records$$,
  $$select player_id, games_played, wins from expected_records$$,
  'player_match_records equals the per-player count of decided, not-ended-early matches'
);

select results_eq(
  $$select games_played, wins from public.player_match_records
    where player_id in ('51000000-0000-0000-0000-00000000000a', '51000000-0000-0000-0000-00000000000b', '51000000-0000-0000-0000-00000000000c')
    order by player_id$$,
  $$values (4, 2), (4, 0), (1, 1)$$,
  'Alice 2 of 4, Bob 0 of 4, Cleo 1 of 1: ended-early and undecided matches are not counted'
);

select is_empty(
  $$select 1 from public.player_match_records where player_id = '51000000-0000-0000-0000-00000000000d'$$,
  'a player whose only match ended early has no record'
);

-- Windows: half-open [start, end), with microsecond-precise edges and one 25-hour "day" (as the
-- client sends when daylight saving time ends).
select is(
  public.count_matches_in_windows(
    array['2096-10-24 22:00:00+00', '2096-10-23 22:00:00+00', '2096-10-24 22:00:00+00', '2096-10-25 23:00:00+00', '2096-10-25 22:00:00+00']::timestamptz[],
    array['2096-10-25 23:00:00+00', '2096-10-24 22:00:00+00', '2096-10-24 22:00:00.000001+00', '2096-10-26 23:00:00+00', '2096-10-25 23:00:00+00']::timestamptz[]
  ),
  array[4, 1, 1, 1, 0],
  'count_matches_in_windows counts not-ended-early matches in each half-open window, in order'
);

select is(
  public.count_matches_in_windows('{}'::timestamptz[], '{}'::timestamptz[]),
  '{}'::integer[],
  'count_matches_in_windows returns an empty array for no windows'
);

select throws_ok(
  $$select public.count_matches_in_windows(array[now()], '{}'::timestamptz[])$$,
  '22023', null,
  'count_matches_in_windows rejects start and end arrays of different lengths'
);

select throws_ok(
  $$select public.count_matches_in_windows(array_fill(now(), array[401]), array_fill(now(), array[401]))$$,
  '22023', null,
  'count_matches_in_windows rejects more than 400 windows'
);

-- Weekly climber: Alice and Bob tie on +20; Alice climbed first. Rows before p_since are ignored.
insert into public.elo_ratings_multi (id, player_id, match_id, rating_before, rating_after, rating_change, field_size, rank, expected_score, observed_score, created_at) values
  ('53000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-00000000000a', '52000000-0000-0000-0000-000000000001', 1000, 1300, 300, 2, 1, 0.5, 1, '2096-10-01 10:00:00+00'),
  ('53000000-0000-0000-0000-000000000002', '51000000-0000-0000-0000-00000000000a', '52000000-0000-0000-0000-000000000002', 1200, 1230, 30, 2, 1, 0.5, 1, '2096-10-20 10:00:00+00'),
  ('53000000-0000-0000-0000-000000000003', '51000000-0000-0000-0000-00000000000b', '52000000-0000-0000-0000-000000000002', 1250, 1270, 20, 2, 2, 0.5, 0, '2096-10-21 10:00:00+00'),
  ('53000000-0000-0000-0000-000000000004', '51000000-0000-0000-0000-00000000000a', '52000000-0000-0000-0000-000000000003', 1230, 1220, -10, 3, 2, 0.5, 0.5, '2096-10-22 10:00:00+00'),
  ('53000000-0000-0000-0000-000000000005', '51000000-0000-0000-0000-00000000000c', '52000000-0000-0000-0000-000000000003', 1100, 1090, -10, 3, 3, 0.5, 0, '2096-10-22 10:00:00+00');

select results_eq(
  $$select player_id::text, rating_change, rating_history from public.get_multi_elo_climbs('2096-10-20 10:00:00+00')$$,
  $$values
    ('51000000-0000-0000-0000-00000000000a', 20, array[1200, 1230, 1220]),
    ('51000000-0000-0000-0000-00000000000b', 20, array[1250, 1270]),
    ('51000000-0000-0000-0000-00000000000c', -10, array[1100, 1090])$$,
  'get_multi_elo_climbs sums each player''s change since p_since (inclusive), oldest history first, first climber first'
);

-- Checkouts: one leg per match. Alice's last turn in m1 checks out 40 in two darts; in m2 her
-- last turn scored 0 (no checkout, and no fallback to an earlier turn); in m3 Cleo's last regular
-- turn is 60 and a later tiebreak turn is ignored; m4 ended early; m7 and m8 are won by the test
-- and inactive players.
insert into public.legs (id, match_id, leg_number, starting_player_id, winner_player_id, created_at) values
  ('54000000-0000-0000-0000-000000000001', '52000000-0000-0000-0000-000000000001', 1, '51000000-0000-0000-0000-00000000000a', '51000000-0000-0000-0000-00000000000a', '2096-10-24 21:59:59.999999+00'),
  ('54000000-0000-0000-0000-000000000002', '52000000-0000-0000-0000-000000000002', 1, '51000000-0000-0000-0000-00000000000b', '51000000-0000-0000-0000-00000000000a', '2096-10-24 22:00:00+00'),
  ('54000000-0000-0000-0000-000000000003', '52000000-0000-0000-0000-000000000003', 1, '51000000-0000-0000-0000-00000000000a', '51000000-0000-0000-0000-00000000000c', '2096-10-25 23:00:00+00'),
  ('54000000-0000-0000-0000-000000000004', '52000000-0000-0000-0000-000000000004', 1, '51000000-0000-0000-0000-00000000000a', '51000000-0000-0000-0000-00000000000a', '2096-10-25 12:00:00+00'),
  ('54000000-0000-0000-0000-000000000007', '52000000-0000-0000-0000-000000000007', 1, '51000000-0000-0000-0000-000000000011', '51000000-0000-0000-0000-000000000011', '2096-10-25 15:00:00+00'),
  ('54000000-0000-0000-0000-000000000008', '52000000-0000-0000-0000-000000000008', 1, '51000000-0000-0000-0000-000000000012', '51000000-0000-0000-0000-000000000012', '2096-10-25 16:00:00+00');

insert into public.turns (id, leg_id, player_id, turn_number, total_scored, busted, tiebreak_round) values
  ('55000000-0000-0000-0000-000000000011', '54000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-00000000000a', 1, 100, false, null),
  ('55000000-0000-0000-0000-000000000012', '54000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-00000000000b', 2, 60, false, null),
  ('55000000-0000-0000-0000-000000000013', '54000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-00000000000a', 3, 40, false, null),
  ('55000000-0000-0000-0000-000000000021', '54000000-0000-0000-0000-000000000002', '51000000-0000-0000-0000-00000000000a', 1, 140, false, null),
  ('55000000-0000-0000-0000-000000000022', '54000000-0000-0000-0000-000000000002', '51000000-0000-0000-0000-00000000000a', 3, 0, true, null),
  ('55000000-0000-0000-0000-000000000031', '54000000-0000-0000-0000-000000000003', '51000000-0000-0000-0000-00000000000c', 3, 60, false, null),
  ('55000000-0000-0000-0000-000000000032', '54000000-0000-0000-0000-000000000003', '51000000-0000-0000-0000-00000000000c', 6, 25, false, 1),
  ('55000000-0000-0000-0000-000000000041', '54000000-0000-0000-0000-000000000004', '51000000-0000-0000-0000-00000000000a', 1, 81, false, null),
  ('55000000-0000-0000-0000-000000000071', '54000000-0000-0000-0000-000000000007', '51000000-0000-0000-0000-000000000011', 1, 99, false, null),
  ('55000000-0000-0000-0000-000000000081', '54000000-0000-0000-0000-000000000008', '51000000-0000-0000-0000-000000000012', 1, 98, false, null);

insert into public.throws (turn_id, dart_index, segment, scored) values
  ('55000000-0000-0000-0000-000000000013', 1, 'S20', 20),
  ('55000000-0000-0000-0000-000000000013', 2, 'D10', 20),
  ('55000000-0000-0000-0000-000000000031', 1, 'T20', 60),
  ('55000000-0000-0000-0000-000000000031', 2, 'Miss', 0),
  ('55000000-0000-0000-0000-000000000031', 3, 'MISS', 0);

-- The definition this migration replaced, as the oracle.
select set_eq(
  $$select turn_id, player_id, display_name, score, darts_used, date, finish from public.checkout_leaderboard
    where turn_id::text like '55000000-%'$$,
  $$select t.id, t.player_id, p.display_name, t.total_scored,
      greatest(1::bigint, (select count(*) from public.throws th where th.turn_id = t.id and th.segment is not null
        and th.segment <> '' and th.segment !~~* 'miss%')),
      l.created_at, m.finish
    from public.turns t
    join public.legs l on t.leg_id = l.id
    join public.matches m on l.match_id = m.id
    join public.players p on t.player_id = p.id
    where l.winner_player_id = t.player_id and (m.ended_early = false or m.ended_early is null)
      and p.is_active = true and p.is_test = false and t.total_scored > 0 and t.tiebreak_round is null
      and t.turn_number = (select max(t2.turn_number) from public.turns t2
        where t2.leg_id = t.leg_id and t2.player_id = t.player_id and t2.tiebreak_round is null)
      and t.id::text like '55000000-%'$$,
  'checkout_leaderboard returns the same rows as the definition it replaced'
);

select results_eq(
  $$select turn_id::text, score, darts_used from public.checkout_leaderboard where turn_id::text like '55000000-%' order by score desc$$,
  $$values ('55000000-0000-0000-0000-000000000031', 60, 1::bigint), ('55000000-0000-0000-0000-000000000013', 40, 2::bigint)$$,
  'checkouts are the winner''s final regular turn, darts exclude misses, at least one dart'
);

select is(
  (select reloptions from pg_class where oid = 'public.checkout_leaderboard'::regclass),
  array['security_invoker=true'],
  'checkout_leaderboard keeps security_invoker after being replaced'
);

select is(
  (select reloptions from pg_class where oid = 'public.player_match_records'::regclass),
  array['security_invoker=true'],
  'player_match_records runs with the caller''s permissions'
);

select ok(
  has_function_privilege('anon', 'public.count_matches_in_windows(timestamptz[], timestamptz[])', 'execute')
    and has_function_privilege('anon', 'public.get_multi_elo_climbs(timestamptz)', 'execute')
    and has_table_privilege('anon', 'public.player_match_records', 'select'),
  'the browser (anon) can read the aggregates'
);

select ok(
  exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'idx_turns_top_scores')
    and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'idx_turns_leg_player_turn')
    and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'idx_matches_created_at_not_ended'),
  'the leaderboard indexes exist'
);

-- As the browser: the security-invoker objects still read through RLS.
set local role anon;

select results_eq(
  $$select games_played, wins from public.player_match_records where player_id = '51000000-0000-0000-0000-00000000000a'$$,
  $$values (4, 2)$$,
  'anon reads player_match_records'
);

select is(
  public.count_matches_in_windows(array['2096-10-24 22:00:00+00']::timestamptz[], array['2096-10-25 23:00:00+00']::timestamptz[]),
  array[4],
  'anon counts matches in windows'
);

reset role;

select * from finish();

rollback;
