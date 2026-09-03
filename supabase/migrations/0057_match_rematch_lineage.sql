-- Preserve explicit match lineage so commentary can state revenge/rematch facts
-- without guessing from coincidentally identical player lists.

alter table public.matches
  add column rematch_of_match_id uuid references public.matches(id) on delete set null;

create index matches_rematch_of_match_id_idx
  on public.matches (rematch_of_match_id)
  where rematch_of_match_id is not null;

comment on column public.matches.rematch_of_match_id is
  'Immediate previous match in a rematch chain; used for navigation and narrative context.';
