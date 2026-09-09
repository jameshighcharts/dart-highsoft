begin;
create function pg_temp.reject_scoring_job() returns trigger language plpgsql as $$
begin raise exception 'injected bookkeeping failure'; end;
$$;
do $$
declare
  a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); board uuid:=gen_random_uuid(); m uuid; l uuid; eid bigint;
  tid uuid:=gen_random_uuid(); did uuid:=gen_random_uuid(); rev text; prepared jsonb; plan jsonb; result jsonb; count_before int;
begin
  insert into public.players(id,display_name,is_test) values(a,'Atomic Scolia A',true),(b,'Atomic Scolia B',true);
  insert into public.scolia_boards(id,serial_number,name) values(board,board::text,'Atomic scoring regression');
  select id into m from public.create_x01_match_atomic('301','double_out',1,false,array[a,b]);
  update public.matches set scolia_board_id=board where id=m;
  select id into l from public.legs where match_id=m;
  insert into public.scolia_events(board_id,message_id,event_type,payload) values(board,'atomic-1','THROW_DETECTED','{"sector":"T20"}') returning id into eid;
  prepared:=public.prepare_scolia_x01_throw(eid); rev:=prepared->>'revision';
  assert prepared->>'kind'='x01' and prepared#>>'{snapshot,match,id}'=m::text;
  assert not public.prepare_scolia_x01_throw(eid,m,rev) ? 'snapshot', 'Unchanged preparation must not download history';
  plan:=jsonb_build_object('createTurn',true,'completeTurn',false,'winnerId',null,'turn',jsonb_build_object(
    'id',tid,'leg_id',l,'player_id',a,'turn_number',1,'total_scored',0,'busted',false,'tiebreak_round',null,
    'throws',jsonb_build_array(jsonb_build_object('id',did,'dart_index',1))));
  update public.matches set paused_at=clock_timestamp() where id=m;
  assert public.commit_scolia_x01_throw(eid,m,rev,plan,'{"segment":"T20","scored":60}')->>'stale'='true';
  assert not exists(select 1 from public.throws where scolia_event_id=eid);
  update public.matches set paused_at=null where id=m;
  rev:=public.prepare_scolia_x01_throw(eid)->>'revision';
  -- A failure in durable bookkeeping rolls the throw and turn back too.
  create trigger test_fail_job before insert on public.background_jobs for each row execute function pg_temp.reject_scoring_job();
  begin
    perform public.commit_scolia_x01_throw(eid,m,rev,plan,'{"segment":"T20","scored":60}');
    raise exception 'Expected rollback';
  exception when others then
    if sqlerrm<>'injected bookkeeping failure' then raise; end if;
  end;
  drop trigger test_fail_job on public.background_jobs;
  assert not exists(select 1 from public.throws where scolia_event_id=eid);
  assert not exists(select 1 from public.turns where id=tid);
  assert (select processing_status from public.scolia_events where id=eid)='pending';
  result:=public.commit_scolia_x01_throw(eid,m,rev,plan,'{"segment":"T20","scored":60,"impactXmm":2,"impactYmm":100}');
  assert result#>>'{accepted,rows,id}'=did::text;
  assert result#>>'{accepted,rows,turn,player,id}'=a::text;
  assert result#>>'{accepted,rows,turn,leg,match,id}'=m::text;
  assert result#>>'{accepted,rows,impact_x_mm}'='2';
  assert (select processing_status from public.scolia_events where id=eid)='processed';
  assert (select count(*) from public.background_jobs where deduplication_key='dartiq_live_throw:'||did)=1;
  perform public.commit_scolia_x01_throw(eid,m,rev,plan,'{"segment":"T20","scored":60}');
  assert (select count(*) from public.throws where scolia_event_id=eid)=1;
  assert public.prepare_scolia_x01_throw(eid)->>'kind'='duplicate';
  assert (select count(*) from public.background_jobs where deduplication_key='dartiq_live_throw:'||did)=1;

  -- A corrected source cannot be settled using a pre-correction plan.
  insert into public.scolia_events(board_id,message_id,event_type,payload) values(board,'atomic-2','THROW_DETECTED','{}') returning id into eid;
  rev:=public.prepare_scolia_x01_throw(eid)->>'revision';
  update public.throws set segment='S20',scored=20 where id=did;
  plan:=jsonb_set(plan,'{createTurn}','false');
  plan:=jsonb_set(plan,'{turn,throws}',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'dart_index',2)));
  assert public.commit_scolia_x01_throw(eid,m,rev,plan,'{"segment":"T20","scored":60}')->>'stale'='true';
  assert not exists(select 1 from public.throws where scolia_event_id=eid);

  -- Commit a trusted winning plan and verify result, Elo, jobs, and retry together.
  rev:=public.prepare_scolia_x01_throw(eid)->>'revision';
  plan:=plan || jsonb_build_object('completeTurn',true,'winnerId',a);
  plan:=jsonb_set(plan,'{turn,total_scored}','60');
  result:=public.commit_scolia_x01_throw(eid,m,rev,plan,'{"segment":"D20","scored":40}');
  assert result#>>'{accepted,rows,turn,leg,winner_player_id}'=a::text;
  assert result#>>'{accepted,rows,turn,leg,match,winner_player_id}'=a::text;
  assert (select count(*) from public.elo_ratings where match_id=m)=2;
  assert (select count(*) from public.background_jobs where deduplication_key='dartiq_completed_leg:'||l)=1;
  select count(*) into count_before from public.throws where match_id=m;
  perform public.commit_scolia_x01_throw(eid,m,rev,plan,'{"segment":"D20","scored":40}');
  assert (select count(*) from public.throws where match_id=m)=count_before;
  assert (select count(*) from public.elo_ratings where match_id=m)=2;
  assert not has_function_privilege('anon','public.commit_scolia_x01_throw(bigint,uuid,text,jsonb,jsonb)','EXECUTE');
  assert not has_function_privilege('authenticated','public.prepare_scolia_x01_throw(bigint,uuid,text)','EXECUTE');
  assert has_function_privilege('service_role','public.commit_scolia_x01_throw(bigint,uuid,text,jsonb,jsonb)','EXECUTE');
end;
$$;
rollback;
