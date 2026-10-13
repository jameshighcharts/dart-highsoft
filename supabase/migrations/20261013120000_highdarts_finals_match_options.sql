begin;

create or replace function public.link_highdarts_match_atomic(p_match_id uuid, p_fixture_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare m public.matches%rowtype; f public.highdarts_fixtures%rowtype; ids uuid[];
begin
  perform 1 from public.highdarts_events e join public.highdarts_fixtures fx on fx.event_id=e.id where fx.id=p_fixture_id for update of e;
  select * into m from public.matches where id = p_match_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Match not found'; end if;
  select * into f from public.highdarts_fixtures where id = p_fixture_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Fixture not found'; end if;
  if f.match_id is not null or m.highdarts_fixture_id is not null then
    raise exception using errcode = '23505', message = 'This fixture or match is already linked';
  end if;
  if f.player_a_id is null or f.player_b_id is null then
    raise exception using errcode = '22023', message = 'Fixture players must be linked before starting';
  end if;
  select array_agg(player_id order by player_id) into ids from public.match_players where match_id = m.id;
  if cardinality(ids) <> 2 or not (f.player_a_id = any(ids) and f.player_b_id = any(ids)) then
    raise exception using errcode = '22023', message = 'Match players do not match the fixture';
  end if;
  if m.mode <> 'x01' or m.tournament_match_id is not null or m.completed_at is not null
    or m.winner_player_id is not null or m.ended_early or exists (
      select 1 from public.throws d join public.turns t on t.id = d.turn_id
      join public.legs l on l.id = t.leg_id where l.match_id = m.id
    ) or exists (select 1 from public.legs where match_id = m.id and (leg_number > 1 or winner_player_id is not null)) then
    raise exception using errcode = '55000', message = 'Scoring has started. Start a new match from the Bengt page.';
  end if;
  update public.matches set highdarts_fixture_id = f.id, start_score = (case when f.stage='final' then '501' else '301' end)::public.x01_start, finish = case when f.stage in ('group','tiebreak') then 'single_out'::public.finish_rule else m.finish end,
    legs_to_win = case when f.stage in ('group','tiebreak') then 2 else m.legs_to_win end, fair_ending = false where id = m.id;
  update public.highdarts_fixtures set match_id = m.id where id = f.id;
end;
$$;
create or replace function public.create_highdarts_match_atomic(p_fixture_id uuid, p_player_ids uuid[],
  p_start_score public.x01_start, p_finish public.finish_rule, p_legs_to_win integer,
  p_fair_ending boolean, p_closest_to_bull boolean default false, p_scolia_board_id uuid default null)
returns setof public.matches language plpgsql security invoker set search_path = '' as $$
declare m public.matches%rowtype; f public.highdarts_fixtures%rowtype;
begin
  perform 1 from public.highdarts_events e join public.highdarts_fixtures fx on fx.event_id=e.id where fx.id=p_fixture_id for update of e;
  select * into f from public.highdarts_fixtures where id=p_fixture_id;
  if not found then raise exception using errcode='P0002',message='Fixture not found'; end if;
  if p_start_score is distinct from (case when f.stage='final' then '501' else '301' end)::public.x01_start or p_finish is null
    or p_legs_to_win is null or p_legs_to_win < 1
    or (f.stage in ('group','tiebreak') and (p_finish <> 'single_out'::public.finish_rule or p_legs_to_win <> 2))
    or p_fair_ending is distinct from false then
    raise exception using errcode = '22023', message = 'Settings do not match this Highdarts round. Use the fixture start link.';
  end if;
  if p_closest_to_bull then
    select * into strict m from public.create_bull_off_match_atomic(p_start_score,p_finish,p_legs_to_win,p_fair_ending,p_player_ids,p_scolia_board_id);
  else
    select * into strict m from public.create_x01_match_atomic(p_start_score,p_finish,p_legs_to_win,p_fair_ending,p_player_ids,p_scolia_board_id);
  end if;
  perform public.link_highdarts_match_atomic(m.id, p_fixture_id);
  return query select * from public.matches where id = m.id;
end;
$$;
create or replace function public.highdarts_guard_match() returns trigger
language plpgsql security invoker set search_path='' as $$
declare f public.highdarts_fixtures%rowtype;
begin
  if new.highdarts_fixture_id is null then return new; end if;
  select * into f from public.highdarts_fixtures where id=new.highdarts_fixture_id;
  perform 1 from public.highdarts_events where id=f.event_id for update;
  if new.start_score <> (case when f.stage='final' then '501' else '301' end)::public.x01_start
    or new.finish is null or new.legs_to_win is null or new.legs_to_win < 1
    or (f.stage in ('group','tiebreak') and (new.finish <> 'single_out'::public.finish_rule or new.legs_to_win <> 2))
    or new.fair_ending is distinct from false then
    raise exception using errcode='22023', message='Settings are locked by Highdarts 2026 rules';
  end if;
  if f.stage in ('group','tiebreak') and exists(select 1 from public.highdarts_fixtures where event_id=f.event_id and stage='final')
    and (new.winner_player_id is distinct from old.winner_player_id or new.completed_at is distinct from old.completed_at or new.ended_early is distinct from old.ended_early) then
    raise exception using errcode='55000',message='Unlock the finals draw before correcting group results';
  end if;
  return new;
end;
$$;

commit;
