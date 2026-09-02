-- Corrections advance a listener's authoritative narrative generation. The
-- worker includes this epoch on future envelopes and invalidates cached replay.

alter table public.commentary_realtime_sessions
  add column epoch bigint not null default 0 check (epoch >= 0),
  add column last_correction_id text,
  add column last_correction_reason text
    check (last_correction_reason in ('throw_updated', 'throw_deleted'));

comment on column public.commentary_realtime_sessions.epoch is
  'Monotonic narrative generation; edit/undo snapshots invalidate all earlier commentary.';

comment on column public.commentary_realtime_sessions.last_correction_id is
  'Idempotency key for the most recently applied correction envelope.';
