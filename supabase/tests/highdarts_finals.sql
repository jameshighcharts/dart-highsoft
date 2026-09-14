-- Disposable regression. Every synthetic match and result is rolled back.
begin;
do $$
declare ids uuid[]:='{}'; pid uuid; eid uuid; f record; m uuid; games jsonb:='[]'; snap jsonb; round_stage text; n integer; a uuid; b uuid; fid uuid; target uuid; legid uuid; turnid uuid; before_count integer;
begin
  select id into eid from public.highdarts_events where slug='highdarts-2026';
  if has_function_privilege('anon','public.lock_highdarts_draw_atomic(jsonb,jsonb)','execute') or has_function_privilege('authenticated','public.create_highdarts_tiebreak_atomic(jsonb,text,text,uuid[])','execute') then raise exception 'Client can mutate draw'; end if;
  for n in 1..12 loop insert into public.players(display_name) values('__Highdarts Finals Test '||n||' '||gen_random_uuid()) returning id into pid; ids:=array_append(ids,pid); end loop;
  begin
    perform public.lock_highdarts_draw_atomic(public.highdarts_snapshot(),'[]'); raise exception 'Locked incomplete groups';
  exception when object_not_in_prerequisite_state then null; end;
  for f in select * from public.highdarts_fixtures where stage='group' and event_id=eid order by id loop
    update public.highdarts_fixtures set player_a_id=ids[1],player_b_id=ids[2] where id=f.id;
    select id into m from public.create_highdarts_match_atomic(f.id,array[ids[1],ids[2]],'301','single_out',2,false);
    update public.matches set completed_at=now(),winner_player_id=ids[1] where id=m;
  end loop;
  fid:=public.create_highdarts_tiebreak_atomic(public.highdarts_snapshot(),'test fourth-place tie','bergen',array[ids[1],ids[2]]);
  begin perform public.create_highdarts_tiebreak_atomic(public.highdarts_snapshot(),'test fourth-place tie','bergen',array[ids[1],ids[2]]); raise exception 'Accepted duplicate pending tie'; exception when object_not_in_prerequisite_state then null; end;
  select id into m from public.create_highdarts_match_atomic(fid,array[ids[1],ids[2]],'301','single_out',2,false);
  update public.matches set completed_at=now(),winner_player_id=ids[2] where id=m;
  for round_stage in select unnest(array['playoff','quarterfinal','semifinal','final']) loop
    for n in 1..case round_stage when 'playoff' then 4 when 'quarterfinal' then 4 when 'semifinal' then 2 else 1 end loop
      a:=case when round_stage='playoff' then ids[4+(n-1)*2+1] when round_stage='quarterfinal' then ids[n] else null end;
      b:=case when round_stage='playoff' then ids[4+(n-1)*2+2] else null end;
      games:=games||jsonb_build_array(jsonb_build_object('stage',round_stage,'position',n,'player_a_id',a,'player_b_id',b,'player_a_name',coalesce(a::text,'TBD'),'player_b_name',coalesce(b::text,'TBD')));
    end loop;
  end loop;
  snap:=public.highdarts_snapshot();
  update public.highdarts_fixtures set player_a_name=player_a_name||' edited' where event_id=eid and stage='group' and office='bergen' and fixture_no=1;
  begin perform public.lock_highdarts_draw_atomic(snap,games); raise exception 'Accepted stale snapshot'; exception when object_not_in_prerequisite_state then null; end;
  perform public.lock_highdarts_draw_atomic(public.highdarts_snapshot(),games);
  if (select count(*) from public.highdarts_fixtures where stage in ('playoff','quarterfinal','semifinal','final') and event_id=eid)<>11 then raise exception 'Wrong draw count'; end if;
  if (select count(*) from public.highdarts_fixtures where next_fixture_id is not null and event_id=eid)<>10 then raise exception 'Missing advancement links'; end if;
  begin perform public.lock_highdarts_draw_atomic(public.highdarts_snapshot(),games); raise exception 'Accepted duplicate draw'; exception when object_not_in_prerequisite_state then null; end;
  select * into f from public.highdarts_fixtures where event_id=eid and stage='playoff' and fixture_no=1;
  select id into m from public.create_highdarts_match_atomic(f.id,array[f.player_a_id,f.player_b_id],'301','single_out',2,false);
  perform public.unlock_highdarts_draw_atomic();
  if exists(select 1 from public.matches where id=m) or exists(select 1 from public.highdarts_fixtures where event_id=eid and stage='final') then raise exception 'Unlock did not clean unplayed draw'; end if;
  perform public.lock_highdarts_draw_atomic(public.highdarts_snapshot(),games);
  select match_id into m from public.highdarts_fixtures where stage='group' and office='bergen' and fixture_no=1;
  begin update public.matches set winner_player_id=ids[2] where id=m; raise exception 'Changed group result after lock'; exception when object_not_in_prerequisite_state then null; end;
  select id into legid from public.legs where match_id=m limit 1;
  begin insert into public.turns(leg_id,player_id,turn_number,total_scored) values(legid,ids[1],1,20); raise exception 'Changed group scoring after lock'; exception when object_not_in_prerequisite_state then null; end;
  for round_stage in select unnest(array['playoff','quarterfinal','semifinal','final']) loop
    for f in select * from public.highdarts_fixtures where event_id=eid and highdarts_fixtures.stage=round_stage order by fixture_no loop
      if f.player_a_id is null or f.player_b_id is null then raise exception 'Winner failed to advance'; end if;
      select count(*) into before_count from public.matches;
      begin
        perform public.create_highdarts_match_atomic(f.id,array[f.player_a_id,f.player_b_id],'201','single_out',2,false); raise exception 'Accepted wrong round format';
      exception when invalid_parameter_value then null; end;
      if (select count(*) from public.matches)<>before_count then raise exception 'Leaked rejected match'; end if;
      select id into m from public.create_highdarts_match_atomic(f.id,array[f.player_a_id,f.player_b_id],(case when round_stage='final' then '501' else '301' end)::public.x01_start,(case when round_stage='playoff' then 'single_out' else 'double_out' end)::public.finish_rule,2,false);
      if round_stage='playoff' and f.fixture_no=1 then
        select id into legid from public.legs where match_id=m limit 1;
        insert into public.turns(leg_id,player_id,turn_number,total_scored) values(legid,f.player_a_id,1,20) returning id into turnid;
        insert into public.throws(turn_id,dart_index,segment,scored) values(turnid,1,'S20',20);
        begin perform public.unlock_highdarts_draw_atomic(); raise exception 'Unlocked after first dart'; exception when object_not_in_prerequisite_state then null; end;
      end if;
      update public.matches set completed_at=now(),winner_player_id=f.player_a_id where id=m;
      update public.matches set completed_at=now() where id=m;
      if f.next_fixture_id is not null and not exists(select 1 from public.highdarts_fixtures where id=f.next_fixture_id and (case when f.next_slot='a' then player_a_id else player_b_id end)=f.player_a_id) then raise exception 'Advanced into wrong slot'; end if;
      if f.next_fixture_id is not null then
        begin update public.matches set winner_player_id=f.player_b_id where id=m; raise exception 'Changed advanced winner'; exception when object_not_in_prerequisite_state then null; end;
      end if;
    end loop;
  end loop;
  if not exists(select 1 from public.highdarts_fixtures fx join public.matches mx on mx.id=fx.match_id where fx.stage='final' and mx.start_score='501' and mx.finish='double_out' and mx.winner_player_id is not null) then raise exception 'Final did not finish correctly'; end if;
  set constraints all immediate;
end $$;
rollback;
