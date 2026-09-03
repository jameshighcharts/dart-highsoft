-- Server-only registry for browser WebRTC commentary calls. The Scolia worker
-- uses the OpenAI call id to attach a sideband WebSocket to the same session.

create table public.commentary_realtime_sessions (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  client_instance_id uuid not null,
  openai_call_id text not null unique,
  persona_id text not null,
  voice text not null,
  epoch bigint not null default 0 check (epoch >= 0),
  last_correction_id text,
  last_correction_reason text
    check (last_correction_reason in ('throw_updated', 'throw_deleted')),
  status text not null default 'active'
    check (status in ('active', 'closed')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  closed_at timestamptz
);

create index commentary_realtime_sessions_active_match_idx
  on public.commentary_realtime_sessions (match_id, last_seen_at desc)
  where status = 'active';

create index commentary_realtime_sessions_client_idx
  on public.commentary_realtime_sessions (match_id, client_instance_id, created_at desc);

alter table public.commentary_realtime_sessions enable row level security;
revoke all on public.commentary_realtime_sessions from anon, authenticated;
grant all on public.commentary_realtime_sessions to service_role;

comment on table public.commentary_realtime_sessions is
  'Server-only map from match listeners to OpenAI Realtime WebRTC calls for Scolia sideband control.';

comment on column public.commentary_realtime_sessions.epoch is
  'Monotonic narrative generation; edit/undo snapshots invalidate all earlier commentary.';

comment on column public.commentary_realtime_sessions.last_correction_id is
  'Idempotency key for the most recently applied correction envelope.';

create table public.commentary_realtime_deliveries (
  session_id uuid not null references public.commentary_realtime_sessions(id) on delete cascade,
  throw_id uuid not null references public.throws(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error text,
  primary key (session_id, throw_id)
);

create index commentary_realtime_deliveries_pending_idx
  on public.commentary_realtime_deliveries (created_at)
  where status = 'pending';

alter table public.commentary_realtime_deliveries enable row level security;
revoke all on public.commentary_realtime_deliveries from anon, authenticated;
grant all on public.commentary_realtime_deliveries to service_role;

comment on table public.commentary_realtime_deliveries is
  'Idempotent per-listener delivery ledger for accepted Scolia throws sent over OpenAI sideband.';
