begin;
do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); m uuid; l uuid; t uuid;
  pinned uuid; unpinned uuid; artifact_id uuid; raw jsonb; training_window jsonb; fitted jsonb;
begin
  insert into public.players(id,display_name,is_test) values(a,'Training A',false),(b,'Training B',false);
  select id into m from public.create_x01_match_atomic('301','double_out',1,false,array[a,b]);
  select id into l from public.legs where match_id = m;
  insert into public.turns(leg_id,player_id,turn_number,total_scored,busted) values(l,a,1,40,false) returning id into t;
  insert into public.throws(turn_id,dart_index,segment,scored,impact_x_mm,impact_y_mm)
    values(t,1,'S20',20,0,130),(t,2,'S20',20,0,130);
  update public.matches set created_at = now()-interval '2 hours',completed_at = now()-interval '1 hour',winner_player_id = a where id = m;
  training_window := public.load_dartiq_training_window(now());
  -- Local development may contain real history; inspect only this fixture.
  assert (select count(*) from jsonb_array_elements(training_window->'rows') d where d->>'matchId' = m::text) = 2;
  assert exists(select 1 from jsonb_array_elements(training_window->'rows') d where d->>'matchId' = m::text and d->>'currentScore' = '301' and d->>'dartsLeft' = '3');
  assert exists(select 1 from jsonb_array_elements(training_window->'rows') d where d->>'matchId' = m::text and d->>'currentScore' = '281' and d->>'dartsLeft' = '2');
  update public.players set is_test = true where id = b;
  assert not exists(select 1 from jsonb_array_elements(public.load_dartiq_training_window(now())->'rows') d
    where d->>'matchId' = m::text), 'Exclude whole test matches, not just actor';
  update public.players set is_test = false where id = b;

  fitted := jsonb_build_object('version','adaptive-scoring-v1','trainedThrough',now()-interval '1 day',
    'matchCount',30,'dartCount',500,'players','{}'::jsonb,'population','[]'::jsonb,'geometry','{}'::jsonb);
  assert public.commit_dartiq_training(0,'adaptive-scoring-v1','fixture',fitted);
  assert not public.commit_dartiq_training(0,'adaptive-scoring-v1','stale',fitted), 'Stale jobs must not commit';
  assert not exists(select 1 from public.dartiq_training_registry where active_id is not null), 'Training alone cannot activate';
  begin
    perform public.commit_dartiq_training(1,'adaptive-scoring-v1','fixture',null,'{"eligible":true,"baseline":{"matches":1,"count":1}}');
    raise exception 'Thin validation activated';
  exception when raise_exception then
    if sqlerrm <> 'Insufficient activation evidence' then raise; end if;
  end;
  assert public.commit_dartiq_training(1,'adaptive-scoring-v1','fixture',null,
    '{"eligible":true,"geometryContexts":[],"baseline":{"matches":30,"count":500}}');
  select active_id into artifact_id from public.dartiq_training_registry;
  -- Simulate activation before this transaction's match creation clock.
  update public.dartiq_trained_artifacts set activated_at = now()-interval '1 minute' where id = artifact_id;
  select id into pinned from public.create_x01_match_atomic('301','double_out',1,false,array[a,b]);
  select raw_evidence into raw from public.dartiq_population_evidence where match_id = pinned;
  assert raw#>>'{modelDeployment,id}' = artifact_id::text, 'New matches pin the active artifact';
  assert not exists(select 1 from public.dartiq_population_evidence where match_id = m and raw_evidence ? 'modelDeployment'), 'Old matches unchanged';
  assert public.commit_dartiq_training(2,'adaptive-scoring-v1','fixture',null,
    '{"rollback":true,"baseline":{"matches":30,"count":500}}');
  assert (select raw_evidence from public.dartiq_population_evidence where match_id = pinned) = raw, 'Rollback cannot rewrite pinned evidence';
  select id into unpinned from public.create_x01_match_atomic('301','double_out',1,false,array[a,b]);
  assert not exists(select 1 from public.dartiq_population_evidence where match_id = unpinned and raw_evidence ? 'modelDeployment'), 'New matches fall back after rollback';
  perform public.enqueue_dartiq_training_job();
  perform public.enqueue_dartiq_training_job();
  assert (select count(*) from public.background_jobs where job_type = 'dartiq_training') = 1, 'Daily jobs deduplicate';
end;
$$;
do $$
begin
  assert not has_table_privilege('service_role','public.dartiq_trained_artifacts','UPDATE');
  assert not has_table_privilege('anon','public.dartiq_training_registry','SELECT');
  assert not has_function_privilege('authenticated','public.commit_dartiq_training(bigint,text,text,jsonb,jsonb)','EXECUTE');
  assert has_function_privilege('service_role','public.load_dartiq_training_window(timestamptz)','EXECUTE');
end;
$$;
rollback;
