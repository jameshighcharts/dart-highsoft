-- The app caches leaderboards and statistics on the server for every viewer (src/lib/shared) and
-- recomputes them after a change. Any write to a table they read queues one
-- revalidate_shared_data job; the background job dispatcher (every five seconds) sends it to the
-- app, which marks the cached copies stale: the next request still gets the previous copy while
-- it recomputes. A leg or party game being won (or the win undone) queues a purge instead, after
-- which nobody gets the copy from before the result.

-- The trigger's argument is 'stale' or 'purge'.
create or replace function public.queue_shared_data_revalidation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  purge boolean := tg_argv[0] = 'purge';
  job_key text := case when purge then 'revalidate_shared_data:purge' else 'revalidate_shared_data' end;
begin
  -- A turn and its darts, or a burst of them, need one job. Checking for a pending job first keeps
  -- concurrent writers from all queuing on the job row's lock.
  if exists (
    select 1
    from public.background_jobs
    where deduplication_key = job_key
      and status = 'pending'
  ) then
    return null;
  end if;

  begin
    -- The job row is reused: a completed or failed one is queued again. One being dispatched is
    -- too, since its handler may already have run; marking it completed only applies while it is
    -- still 'dispatching', so the new request survives that.
    insert into public.background_jobs (job_type, payload, run_at, deduplication_key)
    values (
      'revalidate_shared_data',
      case when purge then '{"purge": true}'::jsonb else '{}'::jsonb end,
      now(),
      job_key
    )
    on conflict (deduplication_key) do update
    set status = 'pending',
        run_at = now(),
        attempts = 0,
        locked_at = null,
        dispatch_request_id = null,
        completed_at = null,
        last_error = null,
        updated_at = now();
  exception when others then
    -- A stale cache expires on its own within minutes; never fail the write over it.
    raise warning 'Could not queue shared data revalidation: %', sqlerrm;
  end;
  return null;
end;
$$;

revoke execute on function public.queue_shared_data_revalidation() from public, anon, authenticated;

do $$
declare
  watched text;
begin
  foreach watched in array array[
    'players',
    'matches',
    'match_players',
    'legs',
    'turns',
    'throws',
    'elo_ratings',
    'elo_ratings_multi',
    'bull_off_events',
    'bull_off_throws',
    'game_sessions',
    'game_session_players',
    'game_throws'
  ] loop
    execute format('drop trigger if exists queue_shared_data_revalidation on public.%I', watched);
    execute format(
      'create trigger queue_shared_data_revalidation
         after insert or update or delete on public.%I
         for each statement execute function public.queue_shared_data_revalidation(''stale'')',
      watched
    );
  end loop;
end;
$$;

drop trigger if exists purge_shared_data_on_leg_result on public.legs;
create trigger purge_shared_data_on_leg_result
after update of winner_player_id on public.legs
for each row
when (old.winner_player_id is distinct from new.winner_player_id)
execute function public.queue_shared_data_revalidation('purge');

drop trigger if exists purge_shared_data_on_game_result on public.game_sessions;
create trigger purge_shared_data_on_game_result
after update of status on public.game_sessions
for each row
when (old.status is distinct from new.status)
execute function public.queue_shared_data_revalidation('purge');
