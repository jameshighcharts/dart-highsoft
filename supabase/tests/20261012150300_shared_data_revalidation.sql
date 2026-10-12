begin;

select plan(26);

select has_trigger('public', t, 'queue_shared_data_revalidation', format('%s queues a revalidation', t))
from unnest(array[
  'players', 'matches', 'match_players', 'legs', 'turns', 'throws', 'elo_ratings', 'elo_ratings_multi',
  'bull_off_events', 'bull_off_throws', 'game_sessions', 'game_session_players', 'game_throws'
]) as t;

select ok(
  not has_function_privilege('anon', 'public.queue_shared_data_revalidation()', 'execute')
    and not has_function_privilege('authenticated', 'public.queue_shared_data_revalidation()', 'execute'),
  'clients cannot call the trigger function'
);

delete from public.background_jobs where deduplication_key = 'revalidate_shared_data';

insert into public.players (id, display_name, is_test) values
  ('64000000-0000-0000-0000-000000000001', 'Cache Buster', true);

select results_eq(
  $$ select job_type, status, attempts from public.background_jobs where deduplication_key = 'revalidate_shared_data' $$,
  $$ values ('revalidate_shared_data', 'pending', 0) $$,
  'a write queues one pending job'
);

update public.players set display_name = 'Cache Buster 2' where id = '64000000-0000-0000-0000-000000000001';
insert into public.players (id, display_name, is_test) values
  ('64000000-0000-0000-0000-000000000002', 'Second Buster', true);

select is(
  (select count(*)::int from public.background_jobs where job_type = 'revalidate_shared_data'),
  1,
  'later writes reuse the pending job'
);

update public.background_jobs
set status = 'completed', attempts = 1, completed_at = now(), run_at = now() - interval '1 hour'
where deduplication_key = 'revalidate_shared_data';

update public.players set display_name = 'Cache Buster 3' where id = '64000000-0000-0000-0000-000000000001';

select results_eq(
  $$ select status, attempts, completed_at is null, run_at = now() from public.background_jobs where deduplication_key = 'revalidate_shared_data' $$,
  $$ values ('pending', 0, true, true) $$,
  'a write after the job completed queues it again'
);

update public.background_jobs
set status = 'dispatching', attempts = 1, locked_at = now()
where deduplication_key = 'revalidate_shared_data';

delete from public.players where id = '64000000-0000-0000-0000-000000000002';

select results_eq(
  $$ select status, locked_at is null from public.background_jobs where deduplication_key = 'revalidate_shared_data' $$,
  $$ values ('pending', true) $$,
  'a write while the job is being dispatched queues it again'
);

-- What the app does when the handler finishes: only a job still being dispatched is completed.
update public.background_jobs
set status = 'completed'
where deduplication_key = 'revalidate_shared_data' and status = 'dispatching';

select is(
  (select status from public.background_jobs where deduplication_key = 'revalidate_shared_data'),
  'pending',
  'the dispatched handler finishing does not swallow the newer request'
);

update public.background_jobs set status = 'failed', attempts = 5 where deduplication_key = 'revalidate_shared_data';
update public.players set is_active = false where id = '64000000-0000-0000-0000-000000000001';

select results_eq(
  $$ select status, attempts from public.background_jobs where deduplication_key = 'revalidate_shared_data' $$,
  $$ values ('pending', 0) $$,
  'a write after the job failed queues it again'
);

select has_trigger('public', 'legs', 'purge_shared_data_on_leg_result', 'a leg result purges');
select has_trigger('public', 'game_sessions', 'purge_shared_data_on_game_result', 'a party game result purges');

delete from public.background_jobs where job_type = 'revalidate_shared_data';

insert into public.matches (id, mode, start_score, finish, legs_to_win) values
  ('65000000-0000-0000-0000-000000000001', 'x01', '501', 'double_out', 2);
insert into public.match_players (match_id, player_id, play_order) values
  ('65000000-0000-0000-0000-000000000001', '64000000-0000-0000-0000-000000000001', 0);
insert into public.legs (id, match_id, leg_number, starting_player_id) values
  ('66000000-0000-0000-0000-000000000001', '65000000-0000-0000-0000-000000000001', 1, '64000000-0000-0000-0000-000000000001');

select is(
  (select count(*)::int from public.background_jobs where deduplication_key = 'revalidate_shared_data:purge'),
  0,
  'starting a match and a leg only marks the data stale'
);

update public.legs set winner_player_id = '64000000-0000-0000-0000-000000000001'
where id = '66000000-0000-0000-0000-000000000001';

select results_eq(
  $$ select status, payload from public.background_jobs where deduplication_key = 'revalidate_shared_data:purge' $$,
  $$ values ('pending', '{"purge": true}'::jsonb) $$,
  'winning a leg queues a purge'
);

update public.background_jobs set status = 'completed' where deduplication_key = 'revalidate_shared_data:purge';
update public.legs set winner_player_id = null where id = '66000000-0000-0000-0000-000000000001';

select is(
  (select status from public.background_jobs where deduplication_key = 'revalidate_shared_data:purge'),
  'pending',
  'undoing a leg win queues a purge again'
);

update public.background_jobs set status = 'completed' where deduplication_key = 'revalidate_shared_data:purge';
insert into public.game_sessions (id, mode, status) values ('67000000-0000-0000-0000-000000000001', 'cricket', 'active');
update public.game_sessions set status = 'ended_early', completed_at = now() where id = '67000000-0000-0000-0000-000000000001';

select results_eq(
  $$ select deduplication_key, status from public.background_jobs where job_type = 'revalidate_shared_data' order by 1 $$,
  $$ values ('revalidate_shared_data', 'pending'), ('revalidate_shared_data:purge', 'pending') $$,
  'finishing a party game queues a purge, alongside the stale marking every write queues'
);

select * from finish();
rollback;
