-- Record when a board entered its current phase. A board stuck in Takeout cannot
-- detect throws, and only the phase's age tells a stuck board from a normal dart removal.
alter table public.scolia_boards add column board_phase_changed_at timestamptz;
alter table public.scolia_board_public_status add column board_phase_changed_at timestamptz;

create function public.stamp_scolia_board_phase_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.board_phase is distinct from old.board_phase then
    new.board_phase_changed_at := now();
  end if;
  return new;
end;
$$;

create trigger stamp_scolia_board_phase_change_trigger
before insert or update of board_phase on public.scolia_boards
for each row execute function public.stamp_scolia_board_phase_change();

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
