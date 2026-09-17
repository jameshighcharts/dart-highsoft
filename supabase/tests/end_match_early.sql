-- Disposable database only. All synthetic rows roll back.
begin;
do $$
declare board uuid := gen_random_uuid(); a uuid; b uuid; eid uuid; fid uuid; mid uuid; replacement uuid; lid uuid; tid uuid; result jsonb; original jsonb;
begin
  if has_function_privilege('anon', 'public.end_match_early_atomic(uuid)', 'execute')
    or has_function_privilege('authenticated', 'public.end_match_early_atomic(uuid)', 'execute') then
    raise exception 'Reset RPC is exposed to browser roles';
  end if;
  insert into public.players(display_name,is_test) values ('__Reset A ' || gen_random_uuid(),true) returning id into a;
  insert into public.players(display_name,is_test) values ('__Reset B ' || gen_random_uuid(),true) returning id into b;
  insert into public.highdarts_events(slug,name) values ('reset-test-' || gen_random_uuid(),'Reset regression') returning id into eid;
  insert into public.highdarts_fixtures(event_id,stage,office,fixture_no,player_a_name,player_b_name,player_a_id,player_b_id)
    values (eid,'group','bergen',1,'A','B',a,b) returning id into fid;
  select to_jsonb(f)-'match_id' into original from public.highdarts_fixtures f where id=fid;
  insert into public.scolia_boards(id,serial_number,name,enabled,worker_connection_status,board_status,worker_heartbeat_at) values(board,'reset-'||board,'Reset test Bergen',true,'connected','Ready',now());
  select id into mid from public.create_highdarts_match_atomic(fid,array[a,b],'301','single_out',2,false,false,board);
  result := public.end_match_early_atomic(mid);
  if result->>'resetFixtureId' <> fid::text or exists(select 1 from public.matches where id=mid)
    or exists(select 1 from public.highdarts_fixtures where id=fid and match_id is not null) then
    raise exception 'Empty attempt did not reset to unplayed';
  end if;
  if (select to_jsonb(f)-'match_id' from public.highdarts_fixtures f where id=fid) <> original then
    raise exception 'Reset changed fixture metadata';
  end if;
  if exists(select 1 from public.matches where scolia_board_id=board) then raise exception 'Board still assigned after reset'; end if;
  select id into replacement from public.create_highdarts_match_atomic(fid,array[a,b],'301','single_out',2,false);
  begin
    perform public.end_match_early_atomic(mid);
    raise exception 'Old attempt retry unexpectedly succeeded';
  exception when no_data_found then null; end;
  if (select match_id from public.highdarts_fixtures where id=fid) <> replacement then raise exception 'Retry damaged new attempt'; end if;
  mid := replacement;
  select id into lid from public.legs where match_id=mid;
  insert into public.turns(leg_id,player_id,turn_number,total_scored) values(lid,a,1,20) returning id into tid;
  insert into public.throws(turn_id,dart_index,segment,scored) values(tid,1,'S20',20);
  perform public.end_match_early_atomic(mid);
  if exists(select 1 from public.turns where id=tid) or exists(select 1 from public.legs where id=lid)
    or exists(select 1 from public.throws where turn_id=tid) then raise exception 'Abandoned scoring survived reset'; end if;

  select id into mid from public.create_highdarts_match_atomic(fid,array[a,b],'301','single_out',2,false);
  update public.matches set ended_early=true,completed_at=now() where id=mid;
  if not exists(select 1 from public.background_jobs where deduplication_key='highdarts_result:'||fid::text) then raise exception 'Missing legacy result job'; end if;
  update public.background_jobs set status='dispatching' where deduplication_key='highdarts_result:'||fid::text;
  begin
    perform public.end_match_early_atomic(mid);
    raise exception 'Reset raced an active result delivery';
  exception when object_not_in_prerequisite_state then null; end;
  update public.background_jobs set status='pending' where deduplication_key='highdarts_result:'||fid::text;
  perform public.end_match_early_atomic(mid);
  if exists(select 1 from public.background_jobs where deduplication_key='highdarts_result:'||fid::text) then raise exception 'Legacy result job survived reset'; end if;

  select id into mid from public.create_highdarts_match_atomic(fid,array[a,b],'301','single_out',2,false);
  update public.highdarts_fixtures set slack_message_ts='123.456' where id=fid;
  begin
    perform public.end_match_early_atomic(mid);
    raise exception 'Reset deleted a published result';
  exception when object_not_in_prerequisite_state then null; end;
  if not exists(select 1 from public.matches where id=mid) then raise exception 'Published attempt changed'; end if;
  update public.highdarts_fixtures set slack_message_ts=null where id=fid;
  insert into public.highdarts_fixtures(event_id,stage,fixture_no,player_a_name,player_b_name,player_a_id,player_b_id)
    values(eid,'final',1,'A','B',a,b);
  begin
    perform public.end_match_early_atomic(mid);
    raise exception 'Reset bypassed locked finals draw';
  exception when object_not_in_prerequisite_state then null; end;
  if not exists(select 1 from public.matches where id=mid) then raise exception 'Failed reset deleted match'; end if;
  delete from public.highdarts_fixtures where event_id=eid and stage='final';
  update public.matches set winner_player_id=a,completed_at=now() where id=mid;
  begin
    perform public.end_match_early_atomic(mid);
    raise exception 'Reset deleted a completed result';
  exception when object_not_in_prerequisite_state then null; end;
  if not exists(select 1 from public.matches where id=mid and winner_player_id=a) then raise exception 'Completed result changed'; end if;

  select id into mid from public.create_x01_match_atomic('301','single_out',1,false,array[a,b]);
  result := public.end_match_early_atomic(mid);
  if result <> '{"ok":true}'::jsonb or not exists(select 1 from public.matches where id=mid and ended_early and completed_at is not null) then
    raise exception 'Ordinary early ending changed';
  end if;
end;
$$;
rollback;
