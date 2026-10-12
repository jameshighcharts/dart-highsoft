-- The app caches leaderboards and statistics on the server for every viewer (src/lib/shared) and
-- recomputes them after a change:
-- - A write to a table written during play (turns, darts, legs) records a change. The app then
--   marks the cached copies stale: the next request still gets the previous copy while it
--   recomputes.
-- - A leg being won or the win undone, and any write to a table written rarely (players, matches,
--   Elo ratings, bull-offs, party games), records a result. The app then purges the copies, and
--   nobody gets one from before it.
--
-- Writers only append to shared_data_changes, so concurrent writers (two boards scoring) never
-- wait on each other here. The background job cron turns the committed changes into one
-- revalidate_shared_data job every five seconds. It only sees committed rows, so a change still
-- being written is picked up by a later run instead of being covered by a job that ran before it.

create table public.shared_data_changes (
  id bigint generated always as identity primary key,
  purge boolean not null,
  created_at timestamptz not null default now()
);

alter table public.shared_data_changes enable row level security;
revoke all on table public.shared_data_changes from anon, authenticated;

-- The trigger's argument is 'stale' or 'purge'.
create or replace function public.record_shared_data_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.shared_data_changes (purge) values (tg_argv[0] = 'purge');
  return null;
end;
$$;

revoke execute on function public.record_shared_data_change() from public, anon, authenticated;

do $$
declare
  watched text;
  kind text;
begin
  for watched, kind in
    select table_name, change_kind
    from (values
      ('match_players', 'stale'),
      ('legs', 'stale'),
      ('turns', 'stale'),
      ('throws', 'stale'),
      ('game_session_players', 'stale'),
      ('game_throws', 'stale'),
      ('players', 'purge'),
      ('matches', 'purge'),
      ('elo_ratings', 'purge'),
      ('elo_ratings_multi', 'purge'),
      ('bull_off_events', 'purge'),
      ('bull_off_throws', 'purge'),
      ('game_sessions', 'purge')
    ) as watched_tables (table_name, change_kind)
  loop
    execute format('drop trigger if exists record_shared_data_change on public.%I', watched);
    execute format(
      'create trigger record_shared_data_change
         after insert or update or delete on public.%I
         for each statement execute function public.record_shared_data_change(%L)',
      watched,
      kind
    );
  end loop;
end;
$$;

create trigger record_shared_data_result
after update of winner_player_id on public.legs
for each row
when (old.winner_player_id is distinct from new.winner_player_id)
execute function public.record_shared_data_change('purge');

-- Consumes the committed changes and queues the job for them. Returns how many it consumed.
create or replace function public.queue_shared_data_revalidation()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  change_count integer;
  any_result boolean;
begin
  with consumed as (
    delete from public.shared_data_changes
    returning purge
  )
  select count(*)::integer, coalesce(bool_or(purge), false)
  into change_count, any_result
  from consumed;

  if change_count = 0 then
    return 0;
  end if;

  -- A new job per batch rather than one reused row, so finishing one job can never mark a later
  -- dispatch of it completed.
  insert into public.background_jobs (job_type, payload, run_at)
  values ('revalidate_shared_data', jsonb_build_object('purge', any_result), now());

  -- A recompute that read the database before the result can finish after the purge and store
  -- that old copy. A second purge a little later replaces it.
  if any_result then
    insert into public.background_jobs (job_type, payload, run_at)
    values ('revalidate_shared_data', jsonb_build_object('purge', true), now() + interval '10 seconds');
  end if;

  -- Old jobs are spent (or, without the dispatcher's secrets, never sent; a newer one supersedes them).
  delete from public.background_jobs
  where job_type = 'revalidate_shared_data'
    and status <> 'dispatching'
    and created_at < now() - interval '1 hour';

  return change_count;
end;
$$;

revoke execute on function public.queue_shared_data_revalidation()
  from public, anon, authenticated, service_role;

-- Queue the job right before each dispatch, in the dispatcher's own cron run, so it is sent in the
-- same run. This replaces the command 0058_background_jobs scheduled; a failure here must not stop
-- the dispatch.
select cron.schedule(
  'dispatch-background-jobs',
  '5 seconds',
  $cron$
    do $do$
    begin
      begin
        perform public.queue_shared_data_revalidation();
      exception when others then
        raise warning 'Could not queue shared data revalidation: %', sqlerrm;
      end;
      perform public.dispatch_due_background_jobs();
    end;
    $do$;
  $cron$
);
