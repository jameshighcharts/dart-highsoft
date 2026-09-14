begin;

create function public.guard_highdarts_board_availability()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  fixture public.highdarts_fixtures%rowtype;
  board public.scolia_boards%rowtype;
  has_office_board boolean := false;
begin
  if new.highdarts_fixture_id is null or new.highdarts_fixture_id is not distinct from old.highdarts_fixture_id then return new; end if;
  select * into strict fixture from public.highdarts_fixtures where id = new.highdarts_fixture_id;
  perform 1 from public.highdarts_events where id = fixture.event_id for update;

  if exists (
    select 1 from public.highdarts_fixtures f join public.matches m on m.id = f.match_id
    where f.event_id = fixture.event_id and m.id <> new.id
      and m.completed_at is null and m.winner_player_id is null and not m.ended_early
      and (f.office = fixture.office or f.player_a_id in (fixture.player_a_id, fixture.player_b_id)
        or f.player_b_id in (fixture.player_a_id, fixture.player_b_id))
  ) then
    raise exception using errcode = '55000', message = 'A tournament match is already in progress for this office or player. Open Bengt to view it.';
  end if;

  if fixture.office is not null then
    for board in select * from public.scolia_boards b where b.enabled and lower(b.name) like '%' || fixture.office || '%' order by b.id loop
      has_office_board := true;
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('scolia_board:' || board.id::text));
      if exists (select 1 from public.matches m where m.scolia_board_id = board.id and m.id <> new.id
        and m.completed_at is null and m.winner_player_id is null and not m.ended_early)
        or exists (select 1 from public.game_sessions g where g.scolia_board_id = board.id and g.status = 'active') then
        raise exception using errcode = '55000', message = 'The office board is already in use. Open Bengt to view the current game.';
      end if;
    end loop;
    if (has_office_board and new.scolia_board_id is null) or (new.scolia_board_id is not null and not exists (
      select 1 from public.scolia_boards b where b.id = new.scolia_board_id and b.enabled and lower(b.name) like '%' || fixture.office || '%'
    )) then
      raise exception using errcode = '22023', message = 'Select the tournament office board. Manual scoring cannot bypass its reservation.';
    end if;
  end if;
  return new;
end;
$$;

create trigger highdarts_board_availability
  before update of highdarts_fixture_id on public.matches
  for each row execute function public.guard_highdarts_board_availability();
revoke all on function public.guard_highdarts_board_availability() from public, anon, authenticated;

commit;
