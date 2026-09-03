-- Generic scheduled jobs. Supabase Cron checks the table every five seconds and
-- queues one HTTP request only when at least one job is due.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
create schema if not exists vault;
create extension if not exists supabase_vault with schema vault;

create table public.background_jobs (
  id uuid primary key default uuid_generate_v4(),
  job_type text not null check (length(job_type) between 1 and 100),
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object'),
  run_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'dispatching', 'completed', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  locked_at timestamptz,
  dispatch_request_id bigint,
  completed_at timestamptz,
  last_error text,
  deduplication_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index background_jobs_pending_due_idx
  on public.background_jobs (run_at, created_at)
  where status = 'pending';

create index background_jobs_stale_dispatch_idx
  on public.background_jobs (locked_at)
  where status = 'dispatching';

alter table public.background_jobs enable row level security;
revoke all on table public.background_jobs from anon, authenticated;

alter table public.slack_dart_polls
  add column background_job_id uuid unique
    references public.background_jobs(id) on delete set null;

create function public.enqueue_slack_dart_poll_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  queued_job_id uuid;
begin
  if new.background_job_id is not null then
    return new;
  end if;

  insert into public.background_jobs (
    job_type,
    payload,
    run_at,
    deduplication_key
  )
  values (
    'slack_dart_poll',
    jsonb_build_object('pollId', new.id),
    new.scheduled_for,
    'slack_dart_poll:' || new.id::text
  )
  on conflict (deduplication_key) do update
  set run_at = excluded.run_at,
      updated_at = now()
  returning id into queued_job_id;

  new.background_job_id := queued_job_id;
  return new;
end;
$$;

revoke execute on function public.enqueue_slack_dart_poll_job() from public, anon, authenticated;

create trigger enqueue_slack_dart_poll_job
before insert on public.slack_dart_polls
for each row execute function public.enqueue_slack_dart_poll_job();

create function public.delete_slack_dart_poll_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.background_jobs
  where id = old.background_job_id
    and status in ('pending', 'dispatching');
  return old;
end;
$$;

revoke execute on function public.delete_slack_dart_poll_job() from public, anon, authenticated;

create trigger delete_slack_dart_poll_job
after delete on public.slack_dart_polls
for each row execute function public.delete_slack_dart_poll_job();

insert into public.background_jobs (
  job_type,
  payload,
  run_at,
  deduplication_key
)
select
  'slack_dart_poll',
  jsonb_build_object('pollId', poll.id),
  poll.scheduled_for,
  'slack_dart_poll:' || poll.id::text
from public.slack_dart_polls as poll
where poll.status in ('open', 'finalizing')
on conflict (deduplication_key) do nothing;

update public.slack_dart_polls as poll
set background_job_id = job.id
from public.background_jobs as job
where job.deduplication_key = 'slack_dart_poll:' || poll.id::text
  and poll.background_job_id is null;

create function public.dispatch_due_background_jobs(p_limit integer default 10)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  app_url text;
  dispatch_secret text;
  job_ids uuid[];
  request_id bigint;
begin
  select decrypted_secret
  into app_url
  from vault.decrypted_secrets
  where name = 'background_jobs_app_url'
  limit 1;

  select decrypted_secret
  into dispatch_secret
  from vault.decrypted_secrets
  where name = 'background_jobs_secret'
  limit 1;

  -- Deploying the migration before its secrets is safe: no jobs are claimed.
  if nullif(trim(app_url), '') is null or nullif(trim(dispatch_secret), '') is null then
    return 0;
  end if;

  update public.background_jobs
  set status = 'failed',
      last_error = 'No response received before the retry window expired',
      updated_at = now()
  where status = 'dispatching'
    and locked_at < now() - interval '5 minutes'
    and attempts >= max_attempts;

  with candidates as (
    select id
    from public.background_jobs
    where (
        status = 'pending'
        and run_at <= now()
      ) or (
        status = 'dispatching'
        and locked_at < now() - interval '5 minutes'
        and attempts < max_attempts
      )
    order by run_at, created_at
    limit greatest(1, least(p_limit, 50))
    for update skip locked
  ), claimed as (
    update public.background_jobs as job
    set status = 'dispatching',
        attempts = job.attempts + 1,
        locked_at = now(),
        dispatch_request_id = null,
        last_error = null,
        updated_at = now()
    from candidates
    where job.id = candidates.id
    returning job.id
  )
  select coalesce(array_agg(id), array[]::uuid[])
  into job_ids
  from claimed;

  if cardinality(job_ids) = 0 then
    return 0;
  end if;

  begin
    select net.http_post(
      url := rtrim(app_url, '/') || '/api/background-jobs',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || dispatch_secret
      ),
      body := jsonb_build_object('jobIds', to_jsonb(job_ids)),
      timeout_milliseconds := 30000
    ) into request_id;

    update public.background_jobs
    set dispatch_request_id = request_id,
        updated_at = now()
    where id = any(job_ids);
  exception when others then
    update public.background_jobs
    set status = case when attempts >= max_attempts then 'failed' else 'pending' end,
        run_at = case
          when attempts >= max_attempts then run_at
          else now() + interval '15 seconds'
        end,
        locked_at = null,
        last_error = left(sqlerrm, 1000),
        updated_at = now()
    where id = any(job_ids);
    raise warning 'Could not queue background job HTTP request: %', sqlerrm;
  end;

  return cardinality(job_ids);
end;
$$;

revoke execute on function public.dispatch_due_background_jobs(integer)
  from public, anon, authenticated, service_role;

select cron.unschedule('dispatch-background-jobs')
where exists (
  select 1 from cron.job where jobname = 'dispatch-background-jobs'
);

select cron.schedule(
  'dispatch-background-jobs',
  '5 seconds',
  'select public.dispatch_due_background_jobs();'
);
