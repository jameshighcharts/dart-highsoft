begin;

create or replace function public.guard_highdarts_board_availability()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  fixture public.highdarts_fixtures%rowtype;
  board public.scolia_boards%rowtype;
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
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('scolia_board:' || board.id::text));
      if exists (select 1 from public.matches m where m.scolia_board_id = board.id and m.id <> new.id
        and m.completed_at is null and m.winner_player_id is null and not m.ended_early)
        or exists (select 1 from public.game_sessions g where g.scolia_board_id = board.id and g.status = 'active') then
        raise exception using errcode = '55000', message = 'The office board is already in use. Open Bengt to view the current game.';
      end if;
    end loop;
    if new.scolia_board_id is not null and not exists (
      select 1 from public.scolia_boards b where b.id = new.scolia_board_id and b.enabled and lower(b.name) like '%' || fixture.office || '%'
    ) then
      raise exception using errcode = '22023', message = 'Select the tournament office board or use manual scoring.';
    end if;
  end if;
  return new;
end;
$$;


create or replace function public.assert_scolia_board_unclaimed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_board_id uuid;
  v_active boolean;
begin
  if tg_table_name = 'matches' then
    v_board_id := new.scolia_board_id;
    v_active := new.completed_at is null
      and new.winner_player_id is null
      and new.ended_early = false;
  elsif tg_table_name = 'game_sessions' then
    v_board_id := new.scolia_board_id;
    v_active := new.status = 'active';
  else
    raise exception using
      errcode = '55000',
      message = 'unsupported_scolia_target_table';
  end if;

  if v_board_id is null or not v_active then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext('scolia_board:' || v_board_id::text));

  if exists (
    select 1
    from public.matches m
    where (m.scolia_board_id = v_board_id or (
      m.scolia_board_id is null and exists (
        select 1 from public.highdarts_fixtures f join public.scolia_boards b
          on b.id = v_board_id and lower(b.name) like '%' || f.office || '%'
        where f.id = m.highdarts_fixture_id and f.office is not null
      )
    ))
      and m.completed_at is null
      and m.winner_player_id is null
      and m.ended_early = false
      and (tg_table_name <> 'matches' or m.id <> new.id)
  ) or exists (
    select 1
    from public.game_sessions g
    where g.scolia_board_id = v_board_id
      and g.status = 'active'
      and (tg_table_name <> 'game_sessions' or g.id <> new.id)
  ) then
    raise unique_violation using
      message = 'Scolia board already has an active match or game session',
      constraint = 'scolia_board_single_active_target';
  end if;

  return new;
end;
$$;

create or replace function public.highdarts_snapshot() returns jsonb
language sql stable security invoker set search_path = '' as $$
select jsonb_build_object(
  'fixtures', coalesce((select jsonb_agg(to_jsonb(f) - 'slack_message_ts' || jsonb_build_object('match',
    (select jsonb_build_object('id',m.id,'winner_player_id',m.winner_player_id,'completed_at',m.completed_at,
      'ended_early',m.ended_early,'paused_at',m.paused_at,'legs',coalesce((select jsonb_agg(jsonb_build_object(
        'winner_player_id',l.winner_player_id,'turns',coalesce((select jsonb_agg(jsonb_build_object(
          'player_id',t.player_id,'total_scored',t.total_scored,'busted',t.busted,'tiebreak_round',t.tiebreak_round,
          'darts_thrown',(select count(*) from public.throws d where d.turn_id = t.id)) order by t.turn_number)
          from public.turns t where t.leg_id = l.id), '[]'::jsonb)))
        from public.legs l where l.match_id = m.id),'[]'::jsonb))
      from public.matches m where m.id = f.match_id)) order by f.office, f.fixture_no)
    from public.highdarts_fixtures f join public.highdarts_events e on e.id=f.event_id where e.slug='highdarts-2026'), '[]'::jsonb),
  'players',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'display_name',p.display_name,'avatar_url',p.avatar_url))
    from public.players p where exists (select 1 from public.highdarts_fixtures f where p.id in (f.player_a_id,f.player_b_id))), '[]'::jsonb)
);
$$;

commit;
