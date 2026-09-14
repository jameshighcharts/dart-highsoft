-- Run only in a disposable database with no active fixtures. All writes roll back.
begin;
do $$
declare a uuid; b uuid; c uuid; d uuid; event uuid; first_fixture uuid; second_fixture uuid; other_fixture uuid;
  first_match uuid; other_match uuid; board uuid := gen_random_uuid(); before_count integer;
begin
  insert into public.players(display_name) values ('__Board test A ' || gen_random_uuid()) returning id into a;
  insert into public.players(display_name) values ('__Board test B ' || gen_random_uuid()) returning id into b;
  insert into public.players(display_name) values ('__Board test C ' || gen_random_uuid()) returning id into c;
  insert into public.players(display_name) values ('__Board test D ' || gen_random_uuid()) returning id into d;
  insert into public.highdarts_events(slug,name) values ('board-test-' || gen_random_uuid(),'Board regression') returning id into event;
  insert into public.highdarts_fixtures(event_id,stage,office,fixture_no,player_a_name,player_b_name,player_a_id,player_b_id)
    values (event,'group','bergen',1,'A','B',a,b) returning id into first_fixture;
  insert into public.highdarts_fixtures(event_id,stage,office,fixture_no,player_a_name,player_b_name,player_a_id,player_b_id)
    values (event,'group','bergen',2,'C','D',c,d) returning id into second_fixture;
  insert into public.highdarts_fixtures(event_id,stage,office,fixture_no,player_a_name,player_b_name,player_a_id,player_b_id)
    values (event,'group','vik',1,'C','D',c,d) returning id into other_fixture;

  select id into first_match from public.create_highdarts_match_atomic(first_fixture,array[a,b],'301','single_out',2,false);
  select count(*) into before_count from public.matches;
  begin
    perform public.create_highdarts_match_atomic(second_fixture,array[c,d],'301','single_out',2,false);
    raise exception 'Started two tournament games in one office';
  exception when object_not_in_prerequisite_state then null; end;
  if (select count(*) from public.matches) <> before_count then raise exception 'Conflict left an orphan match'; end if;
  select id into other_match from public.create_highdarts_match_atomic(other_fixture,array[c,d],'301','single_out',2,false);
  update public.matches set completed_at=now(),ended_early=true where id in (first_match,other_match);

  insert into public.scolia_boards(id,serial_number,name,enabled,worker_connection_status,board_status,worker_heartbeat_at)
    values (board,'board-test-' || board,'Scolia Bergen test',true,'connected','Ready',now());
  begin
    perform public.create_highdarts_match_atomic(second_fixture,array[c,d],'301','single_out',2,false);
    raise exception 'Bypassed office board through manual scoring';
  exception when invalid_parameter_value then null; end;

  select id into first_match from public.create_x01_match_atomic('301','single_out',2,false,array[a,b],board);
  begin
    perform public.create_highdarts_match_atomic(second_fixture,array[c,d],'301','single_out',2,false);
    raise exception 'Bypassed busy friendly with manual scoring';
  exception when object_not_in_prerequisite_state then null; end;
  update public.matches set completed_at=now(),ended_early=true where id=first_match;
  select id into other_match from public.create_highdarts_match_atomic(second_fixture,array[c,d],'301','single_out',2,false,false,board);
  if (select scolia_board_id from public.matches where id=other_match) <> board then raise exception 'Lost office board'; end if;
  if has_function_privilege('anon','public.guard_highdarts_board_availability()','execute') then raise exception 'Anonymous guard execution allowed'; end if;
end $$;
rollback;
