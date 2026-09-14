-- Run after the Highdarts migration. Every test write is rolled back.
begin;
do $$
declare a uuid; b uuid; c uuid; f uuid; m uuid; friendly uuid; l uuid; t uuid; snapshot jsonb;
begin
  if (select count(*) from public.highdarts_fixtures f join public.highdarts_events e on e.id=f.event_id
    where e.slug='highdarts-2026' and stage='group') <> 76 then raise exception 'Expected 76 fixtures'; end if;
  if (select count(*) from public.highdarts_fixtures where office='sogndal' and stage='group') <> 13 then raise exception 'Repeated Sogndal fixtures lost'; end if;
  if public.highdarts_normalize_name('  HÅVARD  Jørgen Ægir Émil ') <> 'havard jorgen aegir emil' then raise exception 'Name folding failed'; end if;
  if has_table_privilege('anon','public.highdarts_fixtures','INSERT') or has_table_privilege('authenticated','public.highdarts_fixtures','UPDATE') then raise exception 'Client write access'; end if;
  if has_function_privilege('anon','public.link_highdarts_match_atomic(uuid,uuid)','EXECUTE') then raise exception 'Client RPC access'; end if;
  if not (select relrowsecurity from pg_class where oid='public.highdarts_fixtures'::regclass) then raise exception 'RLS missing'; end if;
  insert into public.players(display_name) values ('__Highdarts SQL A ' || gen_random_uuid()) returning id into a;
  insert into public.players(display_name) values ('__Highdarts SQL B ' || gen_random_uuid()) returning id into b;
  insert into public.players(display_name) values ('__Highdarts SQL C ' || gen_random_uuid()) returning id into c;
  select id into f from public.highdarts_fixtures where stage='group' and office='bergen' and fixture_no=3;
  update public.highdarts_fixtures set player_a_id=a,player_b_id=b,match_id=null where id=f;
  begin
    perform public.create_highdarts_match_atomic(f,array[a,b],'501','single_out',2,false);
    raise exception 'Accepted wrong format';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.create_highdarts_match_atomic(f,array[a,c],'301','single_out',2,false);
    raise exception 'Accepted wrong players';
  exception when invalid_parameter_value then null; end;
  select id into m from public.create_highdarts_match_atomic(f,array[b,a],'301','single_out',2,false,true);
  if (select match_id from public.highdarts_fixtures where id=f) <> m then raise exception 'Fixture not linked'; end if;
  if (select highdarts_fixture_id from public.matches where id=m) <> f then raise exception 'Match not linked'; end if;
  if (select bull_off->>'phase' from public.matches where id=m) <> 'throwing' then raise exception 'Bull-off lost'; end if;
  begin
    perform public.create_highdarts_match_atomic(f,array[a,b],'301','single_out',2,false);
    raise exception 'Accepted duplicate claim';
  exception when unique_violation then null; end;
  begin
    update public.matches set start_score='501' where id=m;
    raise exception 'Changed tagged settings';
  exception when invalid_parameter_value then null; end;
  begin
    delete from public.match_players where match_id=m and player_id=a;
    raise exception 'Changed tagged lineup';
  exception when object_not_in_prerequisite_state then null; end;
  update public.matches set winner_player_id=b,completed_at=now() where id=m;
  update public.matches set completed_at=now() where id=m;
  if (select count(*) from public.background_jobs where deduplication_key='highdarts_result:'||f::text) <> 1 then raise exception 'Completion job not idempotent'; end if;
  select id into friendly from public.create_x01_match_atomic('301','single_out',2,false,array[a,b],null,m);
  if (select highdarts_fixture_id from public.matches where id=friendly) is not null then raise exception 'Rematch inherited fixture'; end if;
  select id into f from public.highdarts_fixtures where stage='group' and office='bergen' and fixture_no=5;
  update public.highdarts_fixtures set player_a_id=a,player_b_id=b where id=f;
  perform public.link_highdarts_match_atomic(friendly,f);
  update public.matches set ended_early=true, completed_at=now() where id=friendly;
  if not exists (select 1 from public.background_jobs where deduplication_key='highdarts_result:'||f::text) then raise exception 'Early ending not queued'; end if;
  select id into friendly from public.create_x01_match_atomic('501','double_out',1,true,array[a,b]);
  select id into f from public.highdarts_fixtures where stage='group' and office='bergen' and fixture_no=6;
  update public.highdarts_fixtures set player_a_id=a,player_b_id=b where id=f;
  perform public.link_highdarts_match_atomic(friendly,f);
  if not exists (select 1 from public.matches where id=friendly and start_score='301' and finish='single_out' and legs_to_win=2 and not fair_ending) then raise exception 'Pre-start settings not updated'; end if;
  select id into friendly from public.create_x01_match_atomic('501','double_out',1,false,array[a,b]);
  select id into l from public.legs where match_id=friendly;
  insert into public.turns(leg_id,player_id,turn_number,total_scored) values(l,a,1,20) returning id into t;
  insert into public.throws(turn_id,dart_index,segment,scored) values(t,1,'S20',20);
  select id into f from public.highdarts_fixtures where stage='group' and office='bergen' and fixture_no=7;
  update public.highdarts_fixtures set player_a_id=a,player_b_id=b where id=f;
  begin
    perform public.link_highdarts_match_atomic(friendly,f);
    raise exception 'Tagged after first dart';
  exception when object_not_in_prerequisite_state then null; end;
  perform public.map_highdarts_player_atomic(f,'a',a);
  if exists (select 1 from public.highdarts_fixtures where office='bergen' and match_id is null
    and player_a_name=(select player_a_name from public.highdarts_fixtures where id=f) and player_a_id is distinct from a) then
    raise exception 'Mapping missed another fixture';
  end if;
  set constraints all immediate;
  snapshot := public.highdarts_snapshot();
  if jsonb_array_length(snapshot->'fixtures') <> 76 then raise exception 'Snapshot dropped fixtures'; end if;
end $$;
rollback;
