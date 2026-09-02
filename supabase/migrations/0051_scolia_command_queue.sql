-- Outbound messages must use the worker-owned WebSocket. API routes enqueue
-- current-round corrections here and the worker records Scolia's response.

create table public.scolia_commands (
  id uuid primary key default uuid_generate_v4(),
  board_id uuid not null references public.scolia_boards(id) on delete cascade,
  match_id uuid references public.matches(id) on delete set null,
  command_type text not null check (command_type in ('DELETE_THROW', 'THROW_CORRECTED', 'RESET_PHASE')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'acknowledged', 'refused')),
  attempts integer not null default 0,
  response_payload jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  completed_at timestamptz
);

create index scolia_commands_pending_board_idx
  on public.scolia_commands (board_id, created_at)
  where status = 'pending';

create index scolia_commands_match_created_idx
  on public.scolia_commands (match_id, created_at desc);

alter table public.scolia_commands enable row level security;
revoke all on public.scolia_commands from anon, authenticated;
