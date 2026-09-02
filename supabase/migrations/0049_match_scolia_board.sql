-- Associate an X01 match with the physical Scolia board that supplies its
-- throws. Manual matches keep this column null.

alter table public.matches
  add column scolia_board_id uuid references public.scolia_boards(id) on delete set null;

-- A physical board can feed only one unfinished match at a time. Keeping this
-- in Postgres closes the race between two simultaneous match-creation calls.
create unique index matches_one_active_scolia_board_idx
  on public.matches (scolia_board_id)
  where scolia_board_id is not null
    and completed_at is null
    and winner_player_id is null
    and ended_early = false;

comment on column public.matches.scolia_board_id is
  'Physical Scolia board supplying throws for this match; null means manual scoring.';
