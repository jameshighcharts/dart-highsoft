begin;

select plan(30);

select has_trigger('public', t, 'record_shared_data_change', format('a write to %s records a change', t))
from unnest(array[
  'players', 'matches', 'match_players', 'legs', 'turns', 'throws', 'elo_ratings', 'elo_ratings_multi',
  'bull_off_events', 'bull_off_throws', 'game_sessions', 'game_session_players', 'game_throws'
]) as t;
select has_trigger('public', 'legs', 'record_shared_data_result', 'a leg result is recorded');

select ok(
  not has_function_privilege('anon', 'public.record_shared_data_change()', 'execute')
    and not has_function_privilege('authenticated', 'public.record_shared_data_change()', 'execute')
    and not has_function_privilege('anon', 'public.queue_shared_data_revalidation()', 'execute')
    and not has_function_privilege('authenticated', 'public.queue_shared_data_revalidation()', 'execute'),
  'clients cannot call the functions'
);
select ok(
  not has_table_privilege('anon', 'public.shared_data_changes', 'select')
    and not has_table_privilege('authenticated', 'public.shared_data_changes', 'insert'),
  'clients cannot read or write the change log'
);
select ok(
  (select command like '%queue_shared_data_revalidation()%dispatch_due_background_jobs()%'
   from cron.job where jobname = 'dispatch-background-jobs'),
  'the dispatcher queues the revalidation right before dispatching'
);

delete from public.shared_data_changes;
delete from public.background_jobs where job_type = 'revalidate_shared_data';

select is(public.queue_shared_data_revalidation(), 0, 'nothing changed: nothing is queued');
select is((select count(*)::int from public.background_jobs where job_type = 'revalidate_shared_data'), 0, 'and no job exists');

insert into public.players (id, display_name, is_test) values
  ('64000000-0000-0000-0000-000000000001', 'Cache Buster', true),
  ('64000000-0000-0000-0000-000000000002', 'Second Buster', true);
update public.players set display_name = 'Cache Buster 2' where id = '64000000-0000-0000-0000-000000000001';

select results_eq(
  $$ select purge from public.shared_data_changes order by id $$,
  $$ values (true), (true) $$,
  'each statement writing players (a rarely written table) records a result'
);

insert into public.matches (id, mode, start_score, finish, legs_to_win) values
  ('65000000-0000-0000-0000-000000000001', 'x01', '501', 'double_out', 2);
delete from public.shared_data_changes;

insert into public.legs (id, match_id, leg_number, starting_player_id) values
  ('66000000-0000-0000-0000-000000000001', '65000000-0000-0000-0000-000000000001', 1, '64000000-0000-0000-0000-000000000001');
update public.legs set starting_player_id = '64000000-0000-0000-0000-000000000002'
where id = '66000000-0000-0000-0000-000000000001';

select results_eq(
  $$ select purge from public.shared_data_changes order by id $$,
  $$ values (false), (false) $$,
  'writing legs during play only records stale changes'
);

select is(public.queue_shared_data_revalidation(), 2, 'the queued run consumes the changes');
select results_eq(
  $$ select payload, status, run_at = now() from public.background_jobs where job_type = 'revalidate_shared_data' $$,
  $$ values ('{"purge": false}'::jsonb, 'pending', true) $$,
  'and queues one job that marks the data stale'
);
select is((select count(*)::int from public.shared_data_changes), 0, 'the change log is emptied');

delete from public.background_jobs where job_type = 'revalidate_shared_data';
insert into public.legs (id, match_id, leg_number, starting_player_id) values
  ('66000000-0000-0000-0000-000000000002', '65000000-0000-0000-0000-000000000001', 2, '64000000-0000-0000-0000-000000000001');

update public.legs set winner_player_id = '64000000-0000-0000-0000-000000000001'
where id = '66000000-0000-0000-0000-000000000001';

select is((select count(*)::int from public.shared_data_changes where purge), 1, 'winning a leg records a result');

select is(public.queue_shared_data_revalidation(), 3, 'the run consumes the stale changes and the result together');
select results_eq(
  $$ select payload, run_at - now() from public.background_jobs where job_type = 'revalidate_shared_data' order by run_at $$,
  $$ values ('{"purge": true}'::jsonb, interval '0'), ('{"purge": true}'::jsonb, interval '10 seconds') $$,
  'a result is purged now and again a little later'
);

delete from public.background_jobs where job_type = 'revalidate_shared_data';

update public.legs set winner_player_id = null where id = '66000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.shared_data_changes where purge), 1, 'undoing a leg win records a result');

insert into public.game_sessions (id, mode, status) values ('67000000-0000-0000-0000-000000000001', 'cricket', 'active');
update public.game_sessions set status = 'ended_early', completed_at = now() where id = '67000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.shared_data_changes where purge), 3, 'starting and finishing a party game record results');

-- Spent jobs are cleared after an hour; one being dispatched is left alone.
delete from public.shared_data_changes;
insert into public.background_jobs (job_type, payload, run_at, status, created_at) values
  ('revalidate_shared_data', '{}', now(), 'completed', now() - interval '2 hours'),
  ('revalidate_shared_data', '{}', now(), 'pending', now() - interval '2 hours'),
  ('revalidate_shared_data', '{}', now(), 'dispatching', now() - interval '2 hours');
insert into public.shared_data_changes (purge) values (false);
select public.queue_shared_data_revalidation();

select results_eq(
  $$ select status from public.background_jobs where job_type = 'revalidate_shared_data' order by created_at, status $$,
  $$ values ('dispatching'), ('pending') $$,
  'spent jobs are cleared, a dispatching one and the new one stay'
);

select * from finish();
rollback;
