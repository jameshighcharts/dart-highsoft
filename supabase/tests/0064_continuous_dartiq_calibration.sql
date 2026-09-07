begin;

do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  m uuid;
  l uuid;
  t uuid;
  d uuid;
  model bigint;
  population bigint;
  event bigint;
  snapshot jsonb;
  initial_jobs integer;
  frozen_report bigint;
begin
  insert into public.players(id, display_name, is_test) values (a, 'Calibration A', false), (b, 'Calibration B', false);
  select id into m from public.create_x01_match_atomic('301', 'double_out', 1, false, array[a,b]);
  select id into l from public.legs where match_id = m;
  update public.matches set created_at = now() - interval '2 hours', completed_at = now() - interval '1 hour', winner_player_id = a where id = m;
  update public.dartiq_population_evidence set historical_cutoff_at = now() - interval '2 hours' where match_id = m returning id into population;
  insert into public.turns(leg_id, player_id, turn_number, total_scored) values(l,a,1,20) returning id into t;
  insert into public.throws(turn_id,dart_index,segment,scored,impact_x_mm,impact_y_mm) values(t,1,'S20',20,0,100) returning id into d;
  insert into public.dartiq_model_versions(model_key,implementation_hash,configuration,configuration_hash,outcome_model_version,evidence_schema_version)
    values('calibration-test',m::text,'{}',m::text,'behavioral-v1',1) returning id into model;

  for i in 1..45 loop
    insert into public.dartiq_projection_events(schema_version,match_id,leg_id,throw_id,source_throw_id,model_version_id,
      population_evidence_id,acting_player_id,provenance,live_capture_status,revision_hash,sequence,pre_state_hash,input_snapshot,
      finish_rule,cohort,player_count,score_before,score_band,checkout_state,confidence_tier,actual_score_delta,actual_is_double,busted,actual_outcome,computed_at)
    values(1,m,l,d,gen_random_uuid(),model,population,a,'live','complete','test',i,'test','{}',
      'double_out','scolia',2,301,'231_plus','none','population',20,false,false,'{}',now()-interval '90 minutes') returning id into event;
    insert into public.dartiq_player_projections(projection_event_id,player_id,player_evidence_id,
      leg_probability_before,leg_probability_after,match_probability_before,match_probability_after,expected_finish_summary,state_bucket,confidence_tier,backoff_level)
    select event,pe.player_id,pe.id,0.5,0.5,0.5,0.5,'{}','scoring','population','population'
      from public.dartiq_player_evidence pe where pe.match_id = m;
  end loop;

  snapshot := public.load_dartiq_calibration_window(model,now());
  assert jsonb_array_length(snapshot->'rows') = 40, 'Sampling must cap each match at 40 vectors';
  assert snapshot#>>'{rows,0,geometryAvailable}' = 'true', 'Geometry coverage must survive sampling';
  assert snapshot = public.load_dartiq_calibration_window(model,now()), 'Sampling order must be deterministic';
  assert snapshot#>>'{rows,0,probabilities}' is not null, 'Full vectors are required';

  insert into public.dartiq_calibration_reports(model_version_id,evaluator_version,source_fingerprint,window_end,sampled_event_ids,report)
    values(model,'frozen-test','first',now(),'{}','{"promotionEnabled":false,"candidateFamily":"temperature_scaling","temperature":0.85,"recommendation":"recommend_for_review"}')
    returning id into frozen_report;
  insert into public.dartiq_calibration_reports(model_version_id,evaluator_version,source_fingerprint,window_end,sampled_event_ids,report)
    values(model,'frozen-test','second',now(),'{}','{"promotionEnabled":false,"candidateFamily":"temperature_scaling","temperature":1.15,"recommendation":"recommend_for_review"}');
  assert public.load_dartiq_calibration_window(model,now(),'frozen-test')#>>'{candidate,reportId}' = frozen_report::text,
    'Later reports must not replace the frozen candidate';
  assert public.load_dartiq_calibration_window(model,now(),'different-version')->'candidate' = 'null'::jsonb,
    'Candidate must belong to the same evaluator configuration';

  update public.players set is_test = true where id = a;
  assert public.load_dartiq_calibration_window(model,now())->'rows' = '[]'::jsonb, 'Test participants excluded';
  update public.players set is_test = false where id = a;
  update public.matches set ended_early = true where id = m;
  assert public.load_dartiq_calibration_window(model,now())->'rows' = '[]'::jsonb, 'Ended-early matches excluded';
  update public.matches set ended_early = false where id = m;
  update public.dartiq_projection_events set computed_at = now() where model_version_id = model;
  assert public.load_dartiq_calibration_window(model,now())->'rows' = '[]'::jsonb, 'Post-resolution captures excluded';
  update public.dartiq_projection_events set computed_at = now()-interval '90 minutes', live_capture_status = 'partial' where model_version_id = model;
  assert public.load_dartiq_calibration_window(model,now())->'rows' = '[]'::jsonb, 'Correction/partial captures excluded';
  update public.dartiq_projection_events set live_capture_status = 'complete', superseded_at = now() where model_version_id = model;
  assert public.load_dartiq_calibration_window(model,now())->'rows' = '[]'::jsonb, 'Superseded captures excluded';
  update public.dartiq_projection_events set superseded_at = null where model_version_id = model;
  update public.dartiq_population_evidence set historical_cutoff_at = now() where id = population;
  assert public.load_dartiq_calibration_window(model,now())->'rows' = '[]'::jsonb, 'Future evidence excluded';
  update public.dartiq_population_evidence set historical_cutoff_at = now()-interval '2 hours' where id = population;
  delete from public.dartiq_player_projections where player_id = b and projection_event_id in (select id from public.dartiq_projection_events where model_version_id = model);
  assert public.load_dartiq_calibration_window(model,now())->'rows' = '[]'::jsonb, 'Incomplete vectors excluded';

  initial_jobs := public.enqueue_dartiq_calibration_jobs();
  assert initial_jobs between 1 and 4, 'Scheduler must cap model jobs';
  assert public.enqueue_dartiq_calibration_jobs() = 0, 'Same-day scheduling must deduplicate';
  begin
    insert into public.dartiq_calibration_reports(model_version_id,evaluator_version,source_fingerprint,window_end,sampled_event_ids,report)
      values(model,'test','test',now(),'{}','{}');
    raise exception 'Missing promotion guard accepted';
  exception when check_violation then null;
  end;
end;
$$;

do $$
begin
  assert not has_function_privilege('anon','public.load_dartiq_calibration_window(bigint,timestamptz,text)','EXECUTE');
  assert not has_function_privilege('authenticated','public.enqueue_dartiq_calibration_jobs()','EXECUTE');
  assert has_function_privilege('service_role','public.load_dartiq_calibration_window(bigint,timestamptz,text)','EXECUTE');
  assert not has_table_privilege('anon','public.dartiq_calibration_reports','SELECT');
  assert not has_table_privilege('authenticated','public.dartiq_calibration_reports','INSERT');
  assert not has_table_privilege('service_role','public.dartiq_calibration_reports','UPDATE');
  assert (select relrowsecurity from pg_class where oid = 'public.dartiq_calibration_reports'::regclass);
end;
$$;

rollback;
