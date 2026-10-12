-- The app caches leaderboards and statistics on the server for every viewer (src/lib/shared) and
-- recomputes them after a change. Any write to a table they read queues one
-- revalidate_shared_data job; the background job dispatcher (every five seconds) sends it to the
-- app, which marks the cached copies stale.

create or replace function public.queue_shared_data_revalidation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- A turn and its darts, or a burst of them, need one job. Checking for a pending job first keeps
  -- concurrent writers from all queuing on the job row's lock.
  if exists (
    select 1
    from public.background_jobs
    where deduplication_key = 'revalidate_shared_data'
      and status = 'pending'
  ) then
    return null;
  end if;

  begin
    -- The job row is reused: a completed or failed one is queued again. One being dispatched is
    -- too, since its handler may already have run; marking it completed only applies while it is
    -- still 'dispatching', so the new request survives that.
    insert into public.background_jobs (job_type, payload, run_at, deduplication_key)
    values ('revalidate_shared_data', '{}'::jsonb, now(), 'revalidate_shared_data')
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
         for each statement execute function public.queue_shared_data_revalidation()',
      watched
    );
  end loop;
end;
$$;
