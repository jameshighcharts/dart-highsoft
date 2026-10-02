-- Disposable regression for the daily Highdarts digest. Everything is rolled back.
begin;
do $$
declare eid uuid; today date := (now() at time zone 'Europe/Oslo')::date; queued integer;
begin
  select id into eid from public.highdarts_events where slug = 'highdarts-2026';
  if eid is null then raise exception 'Highdarts event is missing'; end if;

  -- The digest table holds no client-readable tournament data.
  if has_table_privilege('anon', 'public.highdarts_digests', 'select')
    or has_table_privilege('authenticated', 'public.highdarts_digests', 'select') then
    raise exception 'Client can read highdarts_digests';
  end if;
  if has_function_privilege('anon', 'public.enqueue_highdarts_digest()', 'execute')
    or has_function_privilege('authenticated', 'public.enqueue_highdarts_digest()', 'execute') then
    raise exception 'Client can enqueue a digest';
  end if;

  -- One digest per event per local day.
  insert into public.highdarts_digests(event_id, digest_date, slack_message_ts)
    values (eid, today, 'sending');
  begin
    insert into public.highdarts_digests(event_id, digest_date) values (eid, today);
    raise exception 'Accepted a duplicate digest for one day';
  exception when unique_violation then null; end;

  -- A claimed day is never re-enqueued, whatever the hour.
  select public.enqueue_highdarts_digest() into queued;
  if queued <> 0 then raise exception 'Enqueued a digest for an already claimed day'; end if;
  if exists (select 1 from public.background_jobs
    where deduplication_key = 'highdarts_digest:' || eid::text || ':' || to_char(today, 'YYYY-MM-DD')) then
    raise exception 'Queued a duplicate digest job';
  end if;

  -- Deleting the event cleans its digests up.
  delete from public.highdarts_digests where event_id = eid and digest_date = today;
  if exists (select 1 from public.highdarts_digests where event_id = eid and digest_date = today) then
    raise exception 'Digest row survived deletion';
  end if;
end $$;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'highdarts-digest-daily') then
    raise exception 'Digest cron job is not scheduled';
  end if;
end $$;
rollback;
