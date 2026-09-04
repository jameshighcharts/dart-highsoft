-- Allow an active match to be paused and resumed without ending it.
alter table public.matches
  add column if not exists paused_at timestamptz;

comment on column public.matches.paused_at is
  'When set, scoring is paused. Null means the match is running.';
