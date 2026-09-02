-- Make outbound WebSocket commands recoverable when a worker exits after
-- claiming a command but before receiving/persisting Scolia's response.

alter table public.scolia_commands
  drop constraint scolia_commands_status_check;

alter table public.scolia_commands
  add constraint scolia_commands_status_check
    check (status in ('pending', 'sent', 'acknowledged', 'refused', 'failed')),
  add column last_error text;

create index scolia_commands_stale_sent_board_idx
  on public.scolia_commands (board_id, sent_at)
  where status = 'sent';
