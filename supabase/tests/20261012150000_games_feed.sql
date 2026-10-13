begin;

select plan(23);

-- Games are dated in 2099 so they are the newest rows whatever else the database holds.
insert into public.players (id, display_name, is_test) values
  ('61000000-0000-0000-0000-000000000001', 'Åse Lund', true),
  ('61000000-0000-0000-0000-000000000002', 'Bob Feed', true),
  ('61000000-0000-0000-0000-000000000003', 'Carl Feed', true);

-- m1 live, m2 won, m3 ended early just after local midnight in Oslo (still the previous UTC day),
-- m4 completed without a winner, m5 has no players and is never listed.
insert into public.matches (id, mode, start_score, finish, legs_to_win, created_at, winner_player_id, completed_at, ended_early) values
  ('62000000-0000-0000-0000-000000000001', 'x01', '501', 'double_out', 2, '2099-10-10 10:00+02', null, null, false),
  ('62000000-0000-0000-0000-000000000002', 'x01', '301', 'single_out', 2, '2099-10-10 09:00+02', '61000000-0000-0000-0000-000000000002', '2099-10-10 09:30+02', false),
  ('62000000-0000-0000-0000-000000000003', 'x01', '501', 'double_out', 1, '2099-10-10 00:30+02', null, '2099-10-10 00:40+02', true),
  ('62000000-0000-0000-0000-000000000004', 'x01', '501', 'double_out', 1, '2099-10-08 12:00+02', null, '2099-10-08 12:30+02', false),
  ('62000000-0000-0000-0000-000000000005', 'x01', '501', 'double_out', 1, '2099-10-10 08:00+02', null, null, false);

insert into public.match_players (match_id, player_id, play_order) values
  ('62000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000002', 0),
  ('62000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000001', 1),
  ('62000000-0000-0000-0000-000000000002', '61000000-0000-0000-0000-000000000003', 0),
  ('62000000-0000-0000-0000-000000000002', '61000000-0000-0000-0000-000000000002', 1),
  ('62000000-0000-0000-0000-000000000003', '61000000-0000-0000-0000-000000000003', 0),
  ('62000000-0000-0000-0000-000000000004', '61000000-0000-0000-0000-000000000002', 0);

insert into public.legs (match_id, leg_number, starting_player_id, winner_player_id) values
  ('62000000-0000-0000-0000-000000000002', 1, '61000000-0000-0000-0000-000000000003', '61000000-0000-0000-0000-000000000002'),
  ('62000000-0000-0000-0000-000000000002', 2, '61000000-0000-0000-0000-000000000002', '61000000-0000-0000-0000-000000000002'),
  ('62000000-0000-0000-0000-000000000002', 3, '61000000-0000-0000-0000-000000000003', null);

-- s1 live, s2 won and started at the same instant as m2 (the match sorts first), s3 ended early.
insert into public.game_sessions (id, mode, status, created_at, winner_player_id, completed_at) values
  ('63000000-0000-0000-0000-000000000001', 'cricket', 'active', '2099-10-10 11:00+02', null, null),
  ('63000000-0000-0000-0000-000000000002', 'killer', 'completed', '2099-10-10 09:00+02', '61000000-0000-0000-0000-000000000002', '2099-10-10 09:20+02'),
  ('63000000-0000-0000-0000-000000000003', 'shanghai', 'ended_early', '2099-10-07 18:00+02', null, '2099-10-07 18:10+02');

insert into public.game_session_players (session_id, player_id, play_order) values
  ('63000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000001', 0),
  ('63000000-0000-0000-0000-000000000002', '61000000-0000-0000-0000-000000000002', 0),
  ('63000000-0000-0000-0000-000000000002', '61000000-0000-0000-0000-000000000003', 1),
  ('63000000-0000-0000-0000-000000000003', '61000000-0000-0000-0000-000000000003', 0);

create temporary table feed_ids on commit drop as
select unnest(array[
  '62000000-0000-0000-0000-000000000001', '62000000-0000-0000-0000-000000000002',
  '62000000-0000-0000-0000-000000000003', '62000000-0000-0000-0000-000000000004',
  '62000000-0000-0000-0000-000000000005', '63000000-0000-0000-0000-000000000001',
  '63000000-0000-0000-0000-000000000002', '63000000-0000-0000-0000-000000000003'
]::uuid[]) as id;
grant select on feed_ids to authenticated;

-- This test's games, in the order the function returned them (other live games may exist).
create function pg_temp.feed_order(ids uuid[]) returns uuid[] language sql as $$
  select array(select u.id from unnest(ids) with ordinality u(id, n) where u.id in (select id from feed_ids) order by u.n)
$$;
grant execute on function pg_temp.feed_order(uuid[]) to authenticated;

set local role authenticated;

select is(
  pg_temp.feed_order(array(select f.id from public.games_live() f)),
  array['63000000-0000-0000-0000-000000000001', '62000000-0000-0000-0000-000000000001']::uuid[],
  'live games are unfinished matches and active party games, newest first; games without players are left out'
);

select is(
  array(select f.id from public.games_feed(null, null, 'Europe/Oslo', 5) f),
  array['62000000-0000-0000-0000-000000000002', '63000000-0000-0000-0000-000000000002',
        '62000000-0000-0000-0000-000000000003', '62000000-0000-0000-0000-000000000004',
        '63000000-0000-0000-0000-000000000003']::uuid[],
  'finished games are won, completed or ended early; a match sorts before a party game started at the same instant'
);

select is(
  array(select f.id from public.games_feed(null, null, 'Europe/Oslo', 2) f),
  array['62000000-0000-0000-0000-000000000002', '63000000-0000-0000-0000-000000000002']::uuid[],
  'a page holds at most p_limit games'
);

select is(
  pg_temp.feed_order(array(select f.id from public.games_feed('bob', null, 'Europe/Oslo', 50) f)),
  array['62000000-0000-0000-0000-000000000002', '63000000-0000-0000-0000-000000000002',
        '62000000-0000-0000-0000-000000000004']::uuid[],
  'search matches any player''s name'
);

select is(
  pg_temp.feed_order(array(select f.id from public.games_feed('  BOB F ', null, 'Europe/Oslo', 50) f)),
  pg_temp.feed_order(array(select f.id from public.games_feed('bob', null, 'Europe/Oslo', 50) f)),
  'search ignores case and surrounding whitespace'
);

-- Keyset pages: the last row of a page is the cursor for the next. m2 and s2 start at the same
-- instant (the match sorts first), so cursors on either side of that tie are covered.
select is(
  array(select f.id from public.games_feed(null, null, 'Europe/Oslo', 2,
    '2099-10-10 09:00+02', 'match', '62000000-0000-0000-0000-000000000002') f),
  array['63000000-0000-0000-0000-000000000002', '62000000-0000-0000-0000-000000000003']::uuid[],
  'after a match cursor come party games of the same instant, then older games'
);

select is(
  pg_temp.feed_order(array(select f.id from public.games_feed(null, null, 'Europe/Oslo', 5,
    '2099-10-10 09:00+02', 'game', '63000000-0000-0000-0000-000000000002') f)),
  array['62000000-0000-0000-0000-000000000003', '62000000-0000-0000-0000-000000000004',
        '63000000-0000-0000-0000-000000000003']::uuid[],
  'after a party game cursor come strictly older games'
);

select is(
  (with first_page as (select * from public.games_feed(null, null, 'Europe/Oslo', 3)),
        cursor as (select * from first_page order by created_at, (kind = 'match'), id limit 1)
   select pg_temp.feed_order(array(select id from first_page)
     || array(select f.id from cursor, public.games_feed(null, null, 'Europe/Oslo', 3, cursor.created_at, cursor.kind, cursor.id) f))),
  array['62000000-0000-0000-0000-000000000002', '63000000-0000-0000-0000-000000000002',
        '62000000-0000-0000-0000-000000000003', '62000000-0000-0000-0000-000000000004',
        '63000000-0000-0000-0000-000000000003']::uuid[],
  'walking the pages returns every finished game once, in order'
);

select is(
  array(select f.id from public.games_feed(null, '2099-10-10', 'Europe/Oslo', 5,
    '2099-10-10 09:00+02', 'game', '63000000-0000-0000-0000-000000000002') f),
  array['62000000-0000-0000-0000-000000000003']::uuid[],
  'cursors combine with the day filter'
);

select is(
  (select count(*)::int from public.games_feed('åse', null, 'Europe/Oslo', 50) f where f.id in (select id from feed_ids)),
  0,
  'search leaves out games without a matching player'
);

select is(
  pg_temp.feed_order(array(select f.id from public.games_feed('carl f', null, 'Europe/Oslo', 50) f)),
  array['62000000-0000-0000-0000-000000000002', '63000000-0000-0000-0000-000000000002',
        '62000000-0000-0000-0000-000000000003', '63000000-0000-0000-0000-000000000003']::uuid[],
  'search is a substring match across the whole name'
);

select is(
  array(select f.id from public.games_feed('   ', null, 'Europe/Oslo', 5) f),
  array(select f.id from public.games_feed(null, null, 'Europe/Oslo', 5) f),
  'a blank search matches every game'
);

select is(
  array(select f.id from public.games_feed(null, '2099-10-10', 'Europe/Oslo', 50) f),
  array['62000000-0000-0000-0000-000000000002', '63000000-0000-0000-0000-000000000002',
        '62000000-0000-0000-0000-000000000003']::uuid[],
  'the day filter uses the viewer''s calendar day'
);

select is(
  array(select f.id from public.games_feed(null, '2099-10-10', 'UTC', 50) f),
  array['62000000-0000-0000-0000-000000000002', '63000000-0000-0000-0000-000000000002']::uuid[],
  'a game just after midnight in Oslo belongs to the previous day in UTC'
);

select is(
  (select f.legs_won from public.games_feed(null, null, 'Europe/Oslo', 1) f),
  2,
  'legs won counts legs with a winner'
);

select is(
  (select f.players from public.games_feed(null, null, 'Europe/Oslo', 1) f),
  '[{"id": "61000000-0000-0000-0000-000000000003", "avatar_url": null, "play_order": 0, "display_name": "Carl Feed"},
    {"id": "61000000-0000-0000-0000-000000000002", "avatar_url": null, "play_order": 1, "display_name": "Bob Feed"}]'::jsonb,
  'players come in play order'
);

select is(
  (select row(f.kind, f.mode, f.start_score, f.finish, f.legs_to_win, f.winner_player_id, f.ended_early, f.status)::text
   from public.games_feed(null, null, 'Europe/Oslo', 2) f where f.kind = 'game'),
  row('game', 'killer', null::text, null::text, null::int, '61000000-0000-0000-0000-000000000002'::uuid, false, 'completed')::text,
  'party games carry their mode and status'
);

select is(
  array(select row(a.day, a.games)::text from public.games_activity('2099-01-01', null, 'Europe/Oslo') a),
  array[row('2099-10-07'::date, 1)::text, row('2099-10-08'::date, 1)::text, row('2099-10-10'::date, 5)::text],
  'activity counts live and finished games per local day'
);

select is(
  array(select row(a.day, a.games)::text from public.games_activity('2099-10-08', 'carl', 'Europe/Oslo') a),
  array[row('2099-10-10'::date, 3)::text],
  'activity follows the search and starts at p_from'
);

select is(
  array(select row(a.day, a.games)::text from public.games_activity('2099-01-01', null, 'UTC') a),
  array[row('2099-10-07'::date, 1)::text, row('2099-10-08'::date, 1)::text, row('2099-10-09'::date, 1)::text, row('2099-10-10'::date, 4)::text],
  'activity uses the viewer''s time zone'
);

reset role;

select is(
  (select count(*)::int from pg_proc
   where proname in ('games_feed', 'games_live', 'games_activity', 'games_feed_match_rows', 'games_feed_session_rows',
                     'games_feed_needle', 'games_feed_players', 'games_feed_legs_won')
     and pronamespace = 'public'::regnamespace and prosecdef),
  0,
  'feed functions run as the caller, so row level security applies'
);

select ok(
  exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'matches_live_created_at_id_idx'),
  'live matches have their own partial index'
);

select ok(
  has_function_privilege('authenticated', 'public.games_feed(text, date, text, int, timestamptz, text, uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.games_live()', 'execute')
  and has_function_privilege('authenticated', 'public.games_activity(date, text, text)', 'execute'),
  'the browser (authenticated) can call the feed'
);

select * from finish();

rollback;
