-- Alert when a Scolia board stays unhealthy. This runs in the database, so it
-- still fires when the worker itself is dead: a stale heartbeat is one of the
-- conditions it watches for. Each incident is announced once, and its recovery
-- once, through the existing background job dispatcher (pg_net -> app -> Slack).

create extension if not exists pg_cron;

alter table public.scolia_boards
  add column worker_connection_changed_at timestamptz,
  add column health_incident_reason text
    check (health_incident_reason in ('worker_stale', 'connection_down')),
  add column health_incident_started_at timestamptz,
  add column health_alerted_at timestamptz;

update public.scolia_boards
set worker_connection_changed_at = coalesce(updated_at, now());

-- Only the age of the current connection status tells a brief reconnect from an outage.
create function public.stamp_scolia_board_connection_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.worker_connection_status is distinct from old.worker_connection_status then
    new.worker_connection_changed_at := now();
  end if;
  return new;
end;
$$;

create trigger stamp_scolia_board_connection_change_trigger
before insert or update of worker_connection_status on public.scolia_boards
for each row execute function public.stamp_scolia_board_connection_change();

-- Browsers show how long a board has been reconnecting, so they need the stamp too.
alter table public.scolia_board_public_status add column worker_connection_changed_at timestamptz;

update public.scolia_board_public_status as status
set worker_connection_changed_at = board.worker_connection_changed_at
from public.scolia_boards as board
where board.id = status.board_id;

create or replace function public.sync_scolia_board_public_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.scolia_board_public_status
    where board_id = old.id;
    return old;
  end if;

  if not new.enabled then
    delete from public.scolia_board_public_status
    where board_id = new.id;
    return new;
  end if;

  insert into public.scolia_board_public_status (
    board_id,
    name,
    is_home_sbc,
    worker_connection_status,
    worker_connection_changed_at,
    board_status,
    board_phase,
    board_phase_changed_at,
    error_type,
    last_event_at,
    worker_heartbeat_at,
    updated_at
  ) values (
    new.id,
    new.name,
    new.is_home_sbc,
    new.worker_connection_status,
    new.worker_connection_changed_at,
    new.board_status,
    new.board_phase,
    new.board_phase_changed_at,
    new.error_type,
    new.last_event_at,
    new.worker_heartbeat_at,
    new.updated_at
  )
  on conflict (board_id) do update set
    name = excluded.name,
    is_home_sbc = excluded.is_home_sbc,
    worker_connection_status = excluded.worker_connection_status,
    worker_connection_changed_at = excluded.worker_connection_changed_at,
    board_status = excluded.board_status,
    board_phase = excluded.board_phase,
    board_phase_changed_at = excluded.board_phase_changed_at,
    error_type = excluded.error_type,
    last_event_at = excluded.last_event_at,
    worker_heartbeat_at = excluded.worker_heartbeat_at,
    updated_at = excluded.updated_at;

  return new;
end;
$$;

create function public.check_scolia_board_health()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  board record;
  problem text;
  since timestamptz;
  incidents jsonb := '[]'::jsonb;
  recoveries jsonb := '[]'::jsonb;
  changed integer;
begin
  -- A board removed from the account needs no recovery notice.
  update public.scolia_boards
  set health_incident_reason = null,
      health_incident_started_at = null,
      health_alerted_at = null
  where not enabled
    and health_alerted_at is not null;

  for board in
    select id, name, worker_connection_status, worker_connection_changed_at, board_status,
      worker_heartbeat_at, created_at, health_incident_reason, health_incident_started_at,
      health_alerted_at
    from public.scolia_boards
    where enabled
    order by name
  loop
    problem := null;
    since := null;
    if coalesce(board.worker_heartbeat_at, board.created_at) < now() - interval '2 minutes' then
      problem := 'worker_stale';
      since := coalesce(board.worker_heartbeat_at, board.created_at);
    elsif board.worker_connection_status <> 'connected'
      and coalesce(board.worker_connection_changed_at, board.created_at) < now() - interval '2 minutes' then
      problem := 'connection_down';
      since := coalesce(board.worker_connection_changed_at, board.created_at);
    end if;

    if problem is not null and board.health_alerted_at is null then
      update public.scolia_boards
      set health_incident_reason = problem,
          health_incident_started_at = since,
          health_alerted_at = now()
      where id = board.id
        and health_alerted_at is null;
      get diagnostics changed = row_count;
      if changed > 0 then
        incidents := incidents || jsonb_build_object(
          'boardId', board.id,
          'name', board.name,
          'problem', problem,
          'since', since,
          'connectionStatus', board.worker_connection_status,
          'boardStatus', board.board_status,
          'heartbeatAt', board.worker_heartbeat_at
        );
      end if;
    elsif problem is null
      and board.health_alerted_at is not null
      -- Wait for a minute of stable health so a flapping board does not announce
      -- a recovery and a fresh outage in alternating minutes.
      and board.worker_heartbeat_at >= now() - interval '1 minute'
      and board.worker_connection_status = 'connected'
      and coalesce(board.worker_connection_changed_at, board.created_at) <= now() - interval '1 minute' then
      update public.scolia_boards
      set health_incident_reason = null,
          health_incident_started_at = null,
          health_alerted_at = null
      where id = board.id
        and health_alerted_at is not null;
      get diagnostics changed = row_count;
      if changed > 0 then
        recoveries := recoveries || jsonb_build_object(
          'boardId', board.id,
          'name', board.name,
          'problem', board.health_incident_reason,
          'since', board.health_incident_started_at,
          'recoveredAt', now()
        );
      end if;
    end if;
  end loop;

  -- One message per check keeps a dead worker (every board stale at once) to a single alert.
  if jsonb_array_length(incidents) > 0 or jsonb_array_length(recoveries) > 0 then
    insert into public.background_jobs (job_type, payload, run_at)
    values (
      'scolia_health_alert',
      jsonb_build_object('incidents', incidents, 'recoveries', recoveries, 'checkedAt', now()),
      now()
    );
  end if;

  return jsonb_array_length(incidents) + jsonb_array_length(recoveries);
end;
$$;

revoke execute on function public.check_scolia_board_health()
  from public, anon, authenticated, service_role;

select cron.unschedule('check-scolia-board-health')
where exists (
  select 1 from cron.job where jobname = 'check-scolia-board-health'
);

select cron.schedule(
  'check-scolia-board-health',
  '* * * * *',
  'select public.check_scolia_board_health();'
);
