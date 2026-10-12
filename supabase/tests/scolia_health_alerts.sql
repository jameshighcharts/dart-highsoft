-- Run only in a disposable database. All writes roll back.
begin;
do $$
declare
  healthy uuid := gen_random_uuid();
  down uuid := gen_random_uuid();
  dead uuid := gen_random_uuid();
  brief uuid := gen_random_uuid();
  job jsonb;
  jobs integer;
begin
  delete from public.background_jobs where job_type = 'scolia_health_alert';
  update public.scolia_boards set enabled = false where enabled;

  insert into public.scolia_boards (id, serial_number, name, worker_connection_status, worker_heartbeat_at)
  values
    (healthy, 'health-' || healthy, 'Healthy', 'connected', now()),
    (down, 'health-' || down, 'Down', 'reconnecting', now()),
    (dead, 'health-' || dead, 'Dead', 'connected', now() - interval '5 minutes'),
    (brief, 'health-' || brief, 'Brief', 'reconnecting', now());

  -- The connection change stamp only moves when the status actually changes.
  update public.scolia_boards set worker_connection_changed_at = now() - interval '10 minutes' where id in (healthy, down, dead);
  update public.scolia_boards set worker_connection_status = 'reconnecting' where id = down;
  if (select worker_connection_changed_at from public.scolia_boards where id = down) > now() - interval '5 minutes' then
    raise exception 'An unchanged connection status moved its change stamp';
  end if;
  update public.scolia_boards set worker_connection_status = 'connected' where id = brief;
  update public.scolia_boards set worker_connection_status = 'reconnecting' where id = brief;
  if (select worker_connection_changed_at from public.scolia_boards where id = brief) < now() - interval '1 second' then
    raise exception 'A connection status change did not stamp its time';
  end if;

  if public.check_scolia_board_health() <> 2 then raise exception 'Expected exactly the down and dead boards to alert'; end if;
  select payload into job from public.background_jobs where job_type = 'scolia_health_alert';
  if jsonb_array_length(job->'incidents') <> 2 or jsonb_array_length(job->'recoveries') <> 0 then
    raise exception 'Unexpected first alert payload: %', job;
  end if;
  if not exists (select 1 from jsonb_array_elements(job->'incidents') i where i->>'name' = 'Down' and i->>'problem' = 'connection_down')
    or not exists (select 1 from jsonb_array_elements(job->'incidents') i where i->>'name' = 'Dead' and i->>'problem' = 'worker_stale') then
    raise exception 'Alerts named the wrong problems: %', job;
  end if;

  -- An ongoing incident is announced only once.
  if public.check_scolia_board_health() <> 0 then raise exception 'Repeated an ongoing incident'; end if;
  select count(*) into jobs from public.background_jobs where job_type = 'scolia_health_alert';
  if jobs <> 1 then raise exception 'Expected one alert job, got %', jobs; end if;

  -- A fresh reconnect is not yet a recovery.
  update public.scolia_boards set worker_connection_status = 'connected' where id = down;
  if public.check_scolia_board_health() <> 0 then raise exception 'Announced recovery before the connection was stable'; end if;

  -- Stable for a minute: recovery is announced once.
  update public.scolia_boards
  set worker_connection_changed_at = now() - interval '2 minutes', worker_heartbeat_at = now()
  where id = down;
  if public.check_scolia_board_health() <> 1 then raise exception 'Expected one recovery'; end if;
  select payload into job from public.background_jobs
  where job_type = 'scolia_health_alert' and jsonb_array_length(payload->'recoveries') > 0;
  if job->'recoveries'->0->>'name' <> 'Down' or job->'recoveries'->0->>'problem' <> 'connection_down' then
    raise exception 'Unexpected recovery payload: %', job;
  end if;
  if public.check_scolia_board_health() <> 0 then raise exception 'Repeated a recovery'; end if;

  -- A removed board is forgotten quietly.
  update public.scolia_boards set enabled = false where id = dead;
  perform public.check_scolia_board_health();
  if (select health_alerted_at from public.scolia_boards where id = dead) is not null then
    raise exception 'A disabled board kept its open incident';
  end if;
  select count(*) into jobs from public.background_jobs where job_type = 'scolia_health_alert';
  if jobs <> 2 then raise exception 'Disabling a board sent a notice; jobs=%', jobs; end if;
end;
$$;
rollback;
