begin;

alter table public.tournaments
  add column scolia_board_id uuid references public.scolia_boards(id) on delete set null,
  add column commentary_enabled boolean not null default false;

create index tournaments_scolia_board_id_idx on public.tournaments(scolia_board_id)
  where scolia_board_id is not null;

comment on column public.tournaments.scolia_board_id is
  'Preferred board; claimed by one match at a time when opened from the bracket.';

commit;
