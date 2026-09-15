-- Disposable-database regression. All test rows and choices roll back.
begin;
do $$
declare
  test_event_id uuid := gen_random_uuid();
  owner_id uuid := gen_random_uuid();
  opponent_ids uuid[] := array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  fixtures uuid[] := array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  team text := 'counting-test-' || gen_random_uuid();
  n integer;
  counted integer;
begin
  insert into public.highdarts_events(id,slug,name) values (test_event_id,'counting-test-' || test_event_id,'Counting test');
  insert into public.players(id,display_name,is_test) values (owner_id,'__Counting owner ' || owner_id,true);
  insert into public.slack_player_links(team_id,slack_user_id,player_id) values (team,'owner',owner_id);
  for n in 1..6 loop
    insert into public.players(id,display_name,is_test) values (opponent_ids[n],'__Counting opponent ' || opponent_ids[n],true);
    insert into public.highdarts_fixtures(id,event_id,stage,office,fixture_no,player_a_name,player_b_name,player_a_id,player_b_id)
    values (fixtures[n],test_event_id,'group','vik',n,'A','B',case when n=6 then opponent_ids[n] else owner_id end,case when n=6 then owner_id else opponent_ids[n] end);
  end loop;
  begin
    insert into public.highdarts_fixtures(event_id,stage,fixture_no,player_a_name,player_b_name) values (test_event_id,'tiebreak',1,'A','B');
    raise exception 'Qualification accepted a missing choice';
  exception when object_not_in_prerequisite_state then null; end;
  begin
    perform public.set_highdarts_counting_atomic(test_event_id,owner_id,fixtures[1],null,team,'not-owner',false);
    raise exception 'Someone else changed the owner choice';
  exception when insufficient_privilege then null; end;
  begin
    perform public.set_highdarts_counting_atomic(test_event_id,opponent_ids[1],fixtures[1],null,team,'admin',true);
    raise exception 'A player without six fixtures discarded a result';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.set_highdarts_counting_atomic(test_event_id,owner_id,gen_random_uuid(),null,team,'owner',false);
    raise exception 'Accepted a fixture outside the player schedule';
  exception when invalid_parameter_value then null; end;
  perform public.set_highdarts_counting_atomic(test_event_id,owner_id,fixtures[1],null,team,'owner',false);
  perform public.set_highdarts_counting_atomic(test_event_id,owner_id,fixtures[1],null,team,'owner',false);
  if (select counts_for_a or not counts_for_b from public.highdarts_fixtures where id=fixtures[1]) then raise exception 'Wrong side excluded'; end if;
  begin
    perform public.set_highdarts_counting_atomic(test_event_id,owner_id,fixtures[6],null,team,'owner',false);
    raise exception 'Stale choice overwrote a newer choice';
  exception when object_not_in_prerequisite_state then null; end;
  perform public.set_highdarts_counting_atomic(test_event_id,owner_id,fixtures[6],fixtures[1],team,'admin',true);
  select count(*) filter (where case when player_a_id=owner_id then counts_for_a else counts_for_b end) into counted
    from public.highdarts_fixtures f where f.event_id=test_event_id and f.stage='group';
  if counted<>5 then raise exception 'Choice replacement did not keep exactly five counted games'; end if;
  if exists(select 1 from public.highdarts_fixtures f where f.event_id=test_event_id and not (case when player_a_id=owner_id then counts_for_b else counts_for_a end)) then raise exception 'An opponent lost a result'; end if;
  perform public.set_highdarts_counting_atomic(test_event_id,owner_id,null,fixtures[6],team,'owner',false);
  begin
    insert into public.highdarts_fixtures(event_id,stage,fixture_no,player_a_name,player_b_name) values (test_event_id,'final',1,'A','B');
    raise exception 'Finals accepted a cleared choice';
  exception when object_not_in_prerequisite_state then null; end;
  perform public.set_highdarts_counting_atomic(test_event_id,owner_id,fixtures[1],null,team,'owner',false);
  insert into public.highdarts_fixtures(event_id,stage,fixture_no,player_a_name,player_b_name) values (test_event_id,'final',1,'A','B');
  begin
    perform public.set_highdarts_counting_atomic(test_event_id,owner_id,fixtures[2],fixtures[1],team,'owner',false);
    raise exception 'Changed choice after finals lock';
  exception when object_not_in_prerequisite_state then null; end;
  if has_function_privilege('anon','public.set_highdarts_counting_atomic(uuid,uuid,uuid,uuid,text,text,boolean)','execute')
    or has_function_privilege('authenticated','public.set_highdarts_counting_atomic(uuid,uuid,uuid,uuid,text,text,boolean)','execute') then
    raise exception 'Direct browser mutation allowed';
  end if;
end;
$$;
rollback;
