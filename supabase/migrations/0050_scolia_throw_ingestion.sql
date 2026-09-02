-- Link Scolia events to the app throws they create. The unique event link makes
-- replay after reconnect/crash safe; the existing throws(turn_id, dart_index)
-- unique index continues to protect each dart slot.

alter table public.scolia_events
  add column processing_status text not null default 'pending'
    check (processing_status in ('pending', 'processed', 'ignored', 'failed')),
  add column processed_at timestamptz,
  add column processing_error text;

-- Events captured before ingestion existed must never be replayed into a later
-- match when this migration is deployed.
update public.scolia_events
set processing_status = 'ignored',
    processed_at = now(),
    processing_error = 'Captured before throw ingestion was enabled';

alter table public.throws
  add column scolia_event_id bigint unique
    references public.scolia_events(id) on delete set null;

create index scolia_events_pending_throw_idx
  on public.scolia_events (board_id, received_at)
  where event_type = 'THROW_DETECTED'
    and processing_status in ('pending', 'failed');

comment on column public.throws.scolia_event_id is
  'Raw Scolia event that created this throw; unique for exactly-once ingestion.';
