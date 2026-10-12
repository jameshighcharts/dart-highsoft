begin;

select plan(20);

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

select * from finish();
rollback;
