begin;
do $$
declare
  eid uuid; a uuid; b uuid; fid uuid; m public.matches%rowtype;
  round_stage text; chosen_finish public.finish_rule; chosen_legs integer; score public.x01_start;
  n integer := 0;
begin
  if has_function_privilege('authenticated','public.create_highdarts_match_atomic(uuid,uuid[],public.x01_start,public.finish_rule,integer,boolean,boolean,uuid)','execute')
    or has_function_privilege('anon','public.link_highdarts_match_atomic(uuid,uuid)','execute') then
    raise exception 'Client can mutate fixtures';
  end if;
  insert into public.highdarts_events(slug,name) values ('options-test-'||gen_random_uuid(),'Options test') returning id into eid;
  insert into public.players(display_name) values ('Options A') returning id into a;
  insert into public.players(display_name) values ('Options B') returning id into b;
  foreach round_stage in array array['playoff','quarterfinal','semifinal','final'] loop
    score := (case when round_stage='final' then '501' else '301' end)::public.x01_start;
    foreach chosen_finish in array array['single_out','double_out']::public.finish_rule[] loop
      foreach chosen_legs in array array[1,2,3] loop
        n := n+1;
        insert into public.highdarts_fixtures(event_id,stage,fixture_no,player_a_name,player_b_name,player_a_id,player_b_id)
          values(eid,round_stage,n,'Options A','Options B',a,b) returning id into fid;
        select * into strict m from public.create_highdarts_match_atomic(fid,array[a,b],score,chosen_finish,chosen_legs,false);
        if m.finish <> chosen_finish or m.legs_to_win <> chosen_legs or m.start_score <> score or m.fair_ending then
          raise exception 'Selected settings were not preserved';
        end if;
        begin update public.matches set fair_ending=true where id=m.id; raise exception 'Allowed fair ending'; exception when invalid_parameter_value then null; end;
        begin update public.matches set start_score='201' where id=m.id; raise exception 'Allowed wrong start score'; exception when invalid_parameter_value then null; end;
        update public.matches set completed_at=now(),winner_player_id=a where id=m.id;
      end loop;
    end loop;
    n := n+1;
    insert into public.highdarts_fixtures(event_id,stage,fixture_no,player_a_name,player_b_name,player_a_id,player_b_id)
      values(eid,round_stage,n,'Options A','Options B',a,b) returning id into fid;
    begin perform public.create_highdarts_match_atomic(fid,array[a,b],score,'single_out',0,false); raise exception 'Allowed zero legs'; exception when invalid_parameter_value then null; end;
    begin perform public.create_highdarts_match_atomic(fid,array[a,b],score,'single_out',null,false); raise exception 'Allowed missing legs'; exception when invalid_parameter_value then null; end;
    begin perform public.create_highdarts_match_atomic(fid,array[a,b],score,null,1,false); raise exception 'Allowed missing finish'; exception when invalid_parameter_value then null; end;
    begin perform public.create_highdarts_match_atomic(fid,array[a,b],score,'single_out',1,true); raise exception 'Allowed fair ending on creation'; exception when invalid_parameter_value then null; end;
    select * into strict m from public.create_x01_match_atomic('201','single_out',3,false,array[a,b]);
    perform public.link_highdarts_match_atomic(m.id,fid);
    select * into strict m from public.matches where id=m.id;
    if m.start_score <> score or m.finish <> 'single_out' or m.legs_to_win <> 3 then raise exception 'Tag overwrote chosen settings'; end if;
    update public.matches set completed_at=now(),winner_player_id=a where id=m.id;
  end loop;
  -- Separate event keeps qualification checks independent of the synthetic final.
  insert into public.highdarts_events(slug,name) values ('locked-options-test-'||gen_random_uuid(),'Locked options test') returning id into eid;
  foreach round_stage in array array['group','tiebreak'] loop
    insert into public.highdarts_fixtures(event_id,stage,office,fixture_no,player_a_name,player_b_name,player_a_id,player_b_id)
      values(eid,round_stage,'vik',1,'Options A','Options B',a,b) returning id into fid;
    begin perform public.create_highdarts_match_atomic(fid,array[a,b],'301','double_out',2,false); raise exception 'Unlocked group finish'; exception when invalid_parameter_value then null; end;
    begin perform public.create_highdarts_match_atomic(fid,array[a,b],'301','single_out',1,false); raise exception 'Unlocked group legs'; exception when invalid_parameter_value then null; end;
    select * into strict m from public.create_highdarts_match_atomic(fid,array[a,b],'301','single_out',2,false);
    begin update public.matches set legs_to_win=3 where id=m.id; raise exception 'Unlocked group legs on update'; exception when invalid_parameter_value then null; end;
    update public.matches set completed_at=now(),winner_player_id=a where id=m.id;
  end loop;
  set constraints all immediate;
end $$;
rollback;
