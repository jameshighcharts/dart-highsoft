-- Expose only non-sensitive Scolia runtime state to browser Realtime clients.
-- The worker remains authoritative because browser roles receive SELECT only.
create table public.scolia_board_public_status (
  board_id uuid primary key references public.scolia_boards(id) on delete cascade,
  name text not null,
  is_home_sbc boolean not null,
  worker_connection_status text not null,
  board_status text,
  board_phase text,
  error_type text,
  last_event_at timestamptz,
  worker_heartbeat_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.scolia_board_public_status enable row level security;

create policy "public read scolia board status"
  on public.scolia_board_public_status
  for select
  to anon, authenticated
  using (true);

revoke all on public.scolia_board_public_status from anon, authenticated;
grant select on public.scolia_board_public_status to anon, authenticated;

create function public.sync_scolia_board_public_status()
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
    error_type = excluded.error_type,
    last_event_at = excluded.last_event_at,
    worker_heartbeat_at = excluded.worker_heartbeat_at,
    updated_at = excluded.updated_at;

  return new;
end;
$$;

create trigger sync_scolia_board_public_status_trigger
after insert or update or delete on public.scolia_boards
for each row execute function public.sync_scolia_board_public_status();

insert into public.scolia_board_public_status (
  board_id,
  name,
  is_home_sbc,
  worker_connection_status,
  board_status,
  board_phase,
  error_type,
  last_event_at,
  worker_heartbeat_at,
  updated_at
)
select
  id,
  name,
  is_home_sbc,
  worker_connection_status,
  board_status,
  board_phase,
  error_type,
  last_event_at,
  worker_heartbeat_at,
  updated_at
from public.scolia_boards
where enabled = true;

alter publication supabase_realtime add table public.scolia_board_public_status;
