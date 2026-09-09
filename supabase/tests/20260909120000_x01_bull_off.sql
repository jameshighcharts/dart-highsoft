begin;
insert into public.players(id, display_name, is_test) values
 ('b0110000-0000-4000-8000-000000000001','Bull-off regression A',true),
 ('b0110000-0000-4000-8000-000000000002','Bull-off regression B',true);
do $$
declare m public.matches%rowtype; state jsonb; v_leg_id uuid;
begin
  select * into strict m from public.create_bull_off_match_atomic('301','double_out',1,true,
    array['b0110000-0000-4000-8000-000000000001'::uuid,'b0110000-0000-4000-8000-000000000002'::uuid]);
  if m.bull_off->>'phase' <> 'throwing' then raise exception 'Missing initial bull-off'; end if;
  select id into strict v_leg_id from public.legs where match_id=m.id;
  begin
    insert into public.turns(leg_id,player_id,turn_number,total_scored) values(v_leg_id,'b0110000-0000-4000-8000-000000000001',1,0);
    raise exception 'Scoring guard did not run';
  exception when raise_exception then
    if sqlerrm <> 'Complete closest to bull before scoring' then raise; end if;
  end;
  begin
    update public.match_players set play_order = play_order + 10 where match_id = m.id;
    raise exception 'Lineup guard did not run';
  exception when raise_exception then
    if sqlerrm <> 'Player lineup is locked during bull-off' then raise; end if;
  end;
  state := jsonb_set(m.bull_off,'{revision}','1') || jsonb_build_object('shots', jsonb_build_array(
    jsonb_build_object('playerId','b0110000-0000-4000-8000-000000000001','round',1,'distanceMm',152.4)));

  if public.update_bull_off_atomic(m.id,8,state) then raise exception 'Stale state was accepted'; end if;
  if not public.update_bull_off_atomic(m.id,0,state) then raise exception 'Transition failed'; end if;
  if public.update_bull_off_atomic(m.id,0,state) then raise exception 'Duplicate transition accepted'; end if;
  state := state || jsonb_build_object('revision',2,'phase','complete','order',jsonb_build_array(
    'b0110000-0000-4000-8000-000000000002','b0110000-0000-4000-8000-000000000001'));
  state := jsonb_set(state, '{shots}', (state->'shots') || jsonb_build_array(
    jsonb_build_object('playerId','b0110000-0000-4000-8000-000000000002','round',1,'distanceMm',25.4)));
  if not public.update_bull_off_atomic(m.id,1,state) then raise exception 'Completion failed'; end if;
  if (select starting_player_id from public.legs where id=v_leg_id) <> 'b0110000-0000-4000-8000-000000000002'::uuid then raise exception 'Wrong starting player'; end if;
  if (select player_id from public.match_players where match_id=m.id and play_order=0) <> 'b0110000-0000-4000-8000-000000000002'::uuid then raise exception 'Wrong order'; end if;
  if (select count(*) from public.bull_off_throws where match_id=m.id) <> 2 then raise exception 'Missing historical darts'; end if;
  if (select distance_mm from public.bull_off_throws where match_id=m.id and player_id='b0110000-0000-4000-8000-000000000001') <> 152.4 then raise exception 'Historical distance changed'; end if;
  if exists(select 1 from public.turns where turns.leg_id=v_leg_id) then raise exception 'Bull-off polluted scoring'; end if;
  insert into public.turns(leg_id,player_id,turn_number,total_scored) values(v_leg_id,'b0110000-0000-4000-8000-000000000002',1,0);
  if has_function_privilege('anon','public.update_bull_off_atomic(uuid,integer,jsonb,bigint)','execute') then raise exception 'Public mutation allowed'; end if;
end;
$$;
rollback;
