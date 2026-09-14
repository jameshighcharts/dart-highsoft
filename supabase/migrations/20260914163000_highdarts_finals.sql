begin;
alter table public.highdarts_fixtures
  add column next_fixture_id uuid references public.highdarts_fixtures(id) on delete set null,
  add column next_slot text check (next_slot in ('a','b')),
  add column tie_context text,
  add constraint highdarts_next_slot_pair check ((next_fixture_id is null) = (next_slot is null));
create unique index highdarts_next_slot_idx on public.highdarts_fixtures(next_fixture_id,next_slot) where next_fixture_id is not null;

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
  update public.matches set highdarts_fixture_id = f.id, start_score = (case when f.stage='final' then '501' else '301' end)::public.x01_start, finish = (case when f.stage in ('quarterfinal','semifinal','final') then 'double_out' else 'single_out' end)::public.finish_rule,
    legs_to_win = 2, fair_ending = false where id = m.id;
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
  if p_start_score is distinct from (case when f.stage='final' then '501' else '301' end)::public.x01_start or p_finish is distinct from (case when f.stage in ('quarterfinal','semifinal','final') then 'double_out' else 'single_out' end)::public.finish_rule
    or p_legs_to_win is distinct from 2 or p_fair_ending is distinct from false then
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
    or new.finish <> (case when f.stage in ('quarterfinal','semifinal','final') then 'double_out' else 'single_out' end)::public.finish_rule
    or new.legs_to_win <> 2 or new.fair_ending then
    raise exception using errcode='22023', message='Settings are locked by Highdarts 2026 rules';
  end if;
  if f.stage in ('group','tiebreak') and exists(select 1 from public.highdarts_fixtures where event_id=f.event_id and stage='final')
    and (new.winner_player_id is distinct from old.winner_player_id or new.completed_at is distinct from old.completed_at or new.ended_early is distinct from old.ended_early) then
    raise exception using errcode='55000',message='Unlock the finals draw before correcting group results';
  end if;
  return new;
end;
$$;

create function public.lock_highdarts_draw_atomic(p_expected jsonb,p_games jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare eid uuid; game jsonb;
begin
  select id into strict eid from public.highdarts_events where slug='highdarts-2026' for update;
  if exists(select 1 from public.highdarts_fixtures where event_id=eid and stage='final') then
    raise exception using errcode='55000',message='The draw is already locked'; end if;
  if public.highdarts_snapshot() is distinct from p_expected then
    raise exception using errcode='55000',message='Results changed. Refresh and review the draw again'; end if;
  if exists(select 1 from public.highdarts_fixtures f left join public.matches m on m.id=f.match_id
    where f.event_id=eid and f.stage='group' and (m.completed_at is null or m.winner_player_id is null or m.ended_early)) then
    raise exception using errcode='55000',message='Complete the group games and tie-breaks first'; end if;
  if jsonb_array_length(p_games)<>11 then raise exception using errcode='22023',message='Expected eleven finals fixtures'; end if;
  for game in select value from jsonb_array_elements(p_games) loop
    if game->>'stage' not in ('playoff','quarterfinal','semifinal','final') then raise exception using errcode='22023',message='Invalid finals stage'; end if;
    insert into public.highdarts_fixtures(event_id,stage,fixture_no,player_a_name,player_b_name,player_a_id,player_b_id)
      values(eid,game->>'stage',(game->>'position')::integer,game->>'player_a_name',game->>'player_b_name',(game->>'player_a_id')::uuid,(game->>'player_b_id')::uuid);
  end loop;
  if (select count(*) from public.highdarts_fixtures where event_id=eid and stage='playoff')<>4
    or (select count(*) from public.highdarts_fixtures where event_id=eid and stage='quarterfinal')<>4
    or (select count(*) from public.highdarts_fixtures where event_id=eid and stage='semifinal')<>2
    or (select count(*) from public.highdarts_fixtures where event_id=eid and stage='final')<>1 then
    raise exception using errcode='22023',message='Invalid round sizes'; end if;
  update public.highdarts_fixtures f set next_fixture_id=n.id,next_slot=case when f.stage='playoff' then 'b' when f.fixture_no%2=1 then 'a' else 'b' end
    from public.highdarts_fixtures n where f.event_id=eid and n.event_id=eid and
      n.stage=case f.stage when 'playoff' then 'quarterfinal' when 'quarterfinal' then 'semifinal' when 'semifinal' then 'final' end
      and n.fixture_no=case when f.stage='playoff' then f.fixture_no else (f.fixture_no+1)/2 end;
end;
$$;

create function public.unlock_highdarts_draw_atomic() returns void
language plpgsql security invoker set search_path='' as $$
declare eid uuid; mids uuid[];
begin
  select id into strict eid from public.highdarts_events where slug='highdarts-2026' for update;
  select array_agg(match_id) into mids from public.highdarts_fixtures where event_id=eid and stage in ('playoff','quarterfinal','semifinal','final');
  if exists(select 1 from public.matches where id=any(mids) and (completed_at is not null or winner_player_id is not null or ended_early))
    or exists(select 1 from public.legs l join public.turns t on t.leg_id=l.id join public.throws d on d.turn_id=t.id where l.match_id=any(mids))
    or exists(select 1 from public.legs where match_id=any(mids) and (leg_number>1 or winner_player_id is not null)) then
    raise exception using errcode='55000',message='The draw cannot be unlocked after finals scoring has started'; end if;
  update public.matches set highdarts_fixture_id=null where id=any(mids);
  update public.highdarts_fixtures set match_id=null,next_fixture_id=null,next_slot=null where event_id=eid and stage in ('playoff','quarterfinal','semifinal','final');
  delete from public.highdarts_fixtures where event_id=eid and stage in ('playoff','quarterfinal','semifinal','final');
  delete from public.matches where id=any(mids);
end;
$$;

create function public.create_highdarts_tiebreak_atomic(p_expected jsonb,p_context text,p_office text,p_player_ids uuid[]) returns uuid
language plpgsql security invoker set search_path='' as $$
declare eid uuid; fid uuid;
begin
  select id into strict eid from public.highdarts_events where slug='highdarts-2026' for update;
  if exists(select 1 from public.highdarts_fixtures where event_id=eid and stage='final') then raise exception using errcode='55000',message='The finals draw is locked'; end if;
  if public.highdarts_snapshot() is distinct from p_expected then raise exception using errcode='55000',message='Results changed. Review the tie again'; end if;
  if cardinality(p_player_ids)<>2 or p_player_ids[1]=p_player_ids[2] then raise exception using errcode='22023',message='Two different players required'; end if;
  if exists(select 1 from public.highdarts_fixtures f left join public.matches m on m.id=f.match_id where f.event_id=eid and f.stage='tiebreak' and f.tie_context=p_context
    and (m.completed_at is null or m.winner_player_id is null or m.ended_early)) then raise exception using errcode='55000',message='Finish the existing tie-break first'; end if;
  insert into public.highdarts_fixtures(event_id,stage,office,fixture_no,player_a_id,player_b_id,player_a_name,player_b_name,tie_context)
    values(eid,'tiebreak',p_office,(select coalesce(max(fixture_no),0)+1 from public.highdarts_fixtures where event_id=eid and stage='tiebreak'),p_player_ids[1],p_player_ids[2],
      (select display_name from public.players where id=p_player_ids[1]),(select display_name from public.players where id=p_player_ids[2]),p_context) returning id into fid;
  return fid;
end;
$$;

create function public.advance_highdarts_winner() returns trigger
language plpgsql security invoker set search_path='' as $$
declare f public.highdarts_fixtures%rowtype; target public.highdarts_fixtures%rowtype; winner_name text;
begin
  if new.highdarts_fixture_id is null then return new; end if;
  select * into f from public.highdarts_fixtures where id=new.highdarts_fixture_id;
  if f.next_fixture_id is null then return new; end if;
  if old.completed_at is not null and old.winner_player_id is not null and not old.ended_early and
    (new.winner_player_id is distinct from old.winner_player_id or new.completed_at is null or new.ended_early) then
    raise exception using errcode='55000',message='A finals result that advanced a player cannot be overwritten'; end if;
  if new.completed_at is null or new.winner_player_id is null or new.ended_early then return new; end if;
  if new.winner_player_id not in (f.player_a_id,f.player_b_id) then raise exception using errcode='22023',message='Winner is not in this fixture'; end if;
  select * into strict target from public.highdarts_fixtures where id=f.next_fixture_id for update;
  if (case when f.next_slot='a' then target.player_a_id else target.player_b_id end) = new.winner_player_id then return new; end if;
  if target.match_id is not null or (case when f.next_slot='a' then target.player_a_id else target.player_b_id end) is not null then raise exception using errcode='55000',message='The next-round place is already occupied'; end if;
  select display_name into winner_name from public.players where id=new.winner_player_id;
  update public.highdarts_fixtures set player_a_id=case when f.next_slot='a' then new.winner_player_id else player_a_id end,
    player_b_id=case when f.next_slot='b' then new.winner_player_id else player_b_id end,
    player_a_name=case when f.next_slot='a' then winner_name else player_a_name end,
    player_b_name=case when f.next_slot='b' then winner_name else player_b_name end where id=target.id;
  return new;
end;
$$;
create trigger advance_highdarts_winner after update on public.matches for each row execute function public.advance_highdarts_winner();

create function public.highdarts_guard_draw_scores() returns trigger
language plpgsql security invoker set search_path='' as $$
declare mid uuid; entity jsonb; eid uuid; fixture_stage text;
begin
  entity:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if tg_table_name='legs' then mid:=(entity->>'match_id')::uuid;
  elsif tg_table_name='turns' then select match_id into mid from public.legs where id=(entity->>'leg_id')::uuid;
  else select l.match_id into mid from public.legs l join public.turns t on t.leg_id=l.id where t.id=(entity->>'turn_id')::uuid; end if;
  select f.event_id,f.stage into eid,fixture_stage from public.matches m join public.highdarts_fixtures f on f.id=m.highdarts_fixture_id where m.id=mid;
  if eid is not null then
    perform 1 from public.highdarts_events where id=eid for update;
    if fixture_stage in ('group','tiebreak') and exists(select 1 from public.highdarts_fixtures where event_id=eid and stage='final') then
      raise exception using errcode='55000',message='Unlock the finals draw before correcting group scoring'; end if;
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;
create trigger highdarts_guard_draw_scores before insert or update or delete on public.throws for each row execute function public.highdarts_guard_draw_scores();
create trigger highdarts_guard_draw_turns before insert or update or delete on public.turns for each row execute function public.highdarts_guard_draw_scores();
create trigger highdarts_guard_draw_legs before insert or update or delete on public.legs for each row execute function public.highdarts_guard_draw_scores();

revoke all on function public.lock_highdarts_draw_atomic(jsonb,jsonb),public.unlock_highdarts_draw_atomic(),public.create_highdarts_tiebreak_atomic(jsonb,text,text,uuid[]),public.advance_highdarts_winner(),public.highdarts_guard_draw_scores() from public,anon,authenticated;
grant execute on function public.lock_highdarts_draw_atomic(jsonb,jsonb),public.unlock_highdarts_draw_atomic(),public.create_highdarts_tiebreak_atomic(jsonb,text,text,uuid[]) to service_role;
create function public.highdarts_guard_fixture_draw() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  perform 1 from public.highdarts_events where id=old.event_id for update;
  if old.stage in ('group','tiebreak') and exists(select 1 from public.highdarts_fixtures where event_id=old.event_id and stage='final') then
    if tg_op='DELETE' then raise exception using errcode='55000',message='Unlock the draw before changing its group fixtures'; end if;
    if (to_jsonb(new)-'slack_message_ts') is distinct from (to_jsonb(old)-'slack_message_ts') then raise exception using errcode='55000',message='Unlock the draw before changing its group fixtures'; end if;
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;
create trigger highdarts_guard_fixture_draw before update or delete on public.highdarts_fixtures for each row execute function public.highdarts_guard_fixture_draw();
revoke all on function public.highdarts_guard_fixture_draw() from public,anon,authenticated;
create or replace function public.map_highdarts_player_atomic(p_fixture_id uuid, p_side text, p_player_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare f public.highdarts_fixtures%rowtype; sheet_name text;
begin
  if p_side not in ('a','b') then raise exception using errcode='22023', message='Invalid fixture side'; end if;
  select * into f from public.highdarts_fixtures where id=p_fixture_id;
  if not found then raise exception using errcode='P0002', message='Fixture not found'; end if;
  if f.stage <> 'group' then raise exception using errcode='55000', message='Finals pairings are managed through the draw'; end if;
  if f.match_id is not null then raise exception using errcode='55000', message='Fixture is already claimed'; end if;
  if not exists (select 1 from public.players where id=p_player_id and is_active) then
    raise exception using errcode='22023', message='Active player not found';
  end if;
  sheet_name := case when p_side='a' then f.player_a_name else f.player_b_name end;
  -- Lock in a stable order before updating all occurrences of this sheet name.
  perform 1 from public.highdarts_fixtures where event_id=f.event_id and office is not distinct from f.office
    and match_id is null and (player_a_name=sheet_name or player_b_name=sheet_name) order by id for update;
  if exists (select 1 from public.highdarts_fixtures where id=p_fixture_id and match_id is not null) then
    raise exception using errcode='55000', message='Fixture was claimed while mapping';
  end if;
  update public.highdarts_fixtures set
    player_a_id=case when player_a_name=sheet_name then p_player_id else player_a_id end,
    player_b_id=case when player_b_name=sheet_name then p_player_id else player_b_id end
  where event_id=f.event_id and office is not distinct from f.office and match_id is null
    and (player_a_name=sheet_name or player_b_name=sheet_name);
end;
$$;

commit;
