-- Daily Highdarts wrap-up in Slack. One row per event per local day; the row is
-- the idempotency record, so a retried job can never post the same day twice.
create table public.highdarts_digests (
  event_id uuid not null references public.highdarts_events(id) on delete cascade,
  digest_date date not null,
  slack_message_ts text,
  covered_through timestamptz,
  created_at timestamptz not null default now(),
  primary key (event_id, digest_date)
);
alter table public.highdarts_digests enable row level security;
revoke all on public.highdarts_digests from anon, authenticated;
grant all on public.highdarts_digests to service_role;

-- Scheduled hourly and gated on Oslo wall-clock time, so the post lands at the
-- same local hour through both daylight-saving shifts.
create function public.enqueue_highdarts_digest() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  queued integer;
  local_now timestamp;
begin
  local_now := now() at time zone 'Europe/Oslo';
  if extract(hour from local_now)::int <> 16 then
    return 0;
  end if;
  insert into public.background_jobs(job_type, payload, run_at, deduplication_key)
  select 'highdarts_digest',
    jsonb_build_object(
      'eventId', e.id::text,
      'digestDate', to_char(local_now::date, 'YYYY-MM-DD')
    ),
    now(),
    'highdarts_digest:' || e.id::text || ':' || to_char(local_now::date, 'YYYY-MM-DD')
  from public.highdarts_events e
  where not exists (
    select 1 from public.highdarts_digests d
    where d.event_id = e.id and d.digest_date = local_now::date
  )
  on conflict (deduplication_key) do nothing;
  get diagnostics queued = row_count;
  return queued;
end;
$$;
revoke all on function public.enqueue_highdarts_digest() from public, anon, authenticated;
grant execute on function public.enqueue_highdarts_digest() to service_role;

select cron.schedule(
  'highdarts-digest-daily',
  '0 * * * *',
  'select public.enqueue_highdarts_digest();'
);
