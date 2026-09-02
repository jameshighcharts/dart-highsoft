-- Persist Scolia board connectivity and the raw event stream consumed by the
-- long-running worker. Only server-side service-role clients may write/read
-- these tables; the application exposes a narrow board-status API instead.

create table public.scolia_boards (
  id uuid primary key default uuid_generate_v4(),
  serial_number text not null unique,
  name text not null,
  is_home_sbc boolean not null default false,
  enabled boolean not null default true,
  worker_connection_status text not null default 'disconnected'
    check (worker_connection_status in ('disconnected', 'connecting', 'connected', 'reconnecting')),
  board_status text,
  board_phase text,
  error_type text,
  last_event_at timestamptz,
  worker_heartbeat_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.scolia_events (
  id bigint generated always as identity primary key,
  board_id uuid not null references public.scolia_boards(id) on delete cascade,
  message_id text not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz,
  received_at timestamptz not null default now(),
  unique (board_id, message_id)
);

create index idx_scolia_events_board_received
  on public.scolia_events (board_id, received_at desc);

create index idx_scolia_events_type_received
  on public.scolia_events (event_type, received_at desc);

alter table public.scolia_boards enable row level security;
alter table public.scolia_events enable row level security;

revoke all on public.scolia_boards from anon, authenticated;
revoke all on public.scolia_events from anon, authenticated;
revoke all on sequence public.scolia_events_id_seq from anon, authenticated;

