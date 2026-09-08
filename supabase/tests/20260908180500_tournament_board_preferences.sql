begin;

insert into public.scolia_boards (id, serial_number, name)
values ('b0000000-0000-4000-8000-000000000091', 'TOURNAMENT-PREFERENCE-TEST', 'Tournament test board');

insert into public.tournaments (id, name, mode, start_score, finish, legs_to_win, scolia_board_id, commentary_enabled)
values ('a0000000-0000-4000-8000-000000000091', 'Board preference test', 'x01', '301', 'single_out', 1,
  'b0000000-0000-4000-8000-000000000091', true);

insert into public.matches (id, mode, start_score, finish, legs_to_win)
values
  ('c0000000-0000-4000-8000-000000000091', 'x01', '301', 'single_out', 1),
  ('c0000000-0000-4000-8000-000000000092', 'x01', '301', 'single_out', 1);

do $$
begin
  if not (select commentary_enabled from public.tournaments where id = 'a0000000-0000-4000-8000-000000000091') then
    raise exception 'Tournament commentary preference was not stored';
  end if;
  update public.matches set scolia_board_id = 'b0000000-0000-4000-8000-000000000091'
    where id = 'c0000000-0000-4000-8000-000000000091';
  begin
    update public.matches set scolia_board_id = 'b0000000-0000-4000-8000-000000000091'
      where id = 'c0000000-0000-4000-8000-000000000092';
    raise exception 'Concurrent active board assignment should have failed';
  exception when unique_violation then null;
  end;
  update public.matches set completed_at = now() where id = 'c0000000-0000-4000-8000-000000000091';
  update public.matches set scolia_board_id = 'b0000000-0000-4000-8000-000000000091'
    where id = 'c0000000-0000-4000-8000-000000000092';
  if not exists (select 1 from public.matches where id = 'c0000000-0000-4000-8000-000000000092' and scolia_board_id is not null) then
    raise exception 'Board did not move to next match after completion';
  end if;
end;
$$;

rollback;
