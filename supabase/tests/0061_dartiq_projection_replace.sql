begin;

select plan(1);

insert into public.players (id, display_name, is_test)
values
  ('d2000000-0000-0000-0000-000000000001', 'Atomic DartIQ Alice', true),
  ('d2000000-0000-0000-0000-000000000002', 'Atomic DartIQ Bob', true),
  ('d2000000-0000-0000-0000-000000000003', 'Atomic DartIQ Outsider', true);

do $$
declare
  v_match public.matches%rowtype;
  v_leg_id uuid;
  v_model_id bigint;
  v_population_id bigint;
  v_alice_evidence_id bigint;
  v_bob_evidence_id bigint;
  v_throw_id uuid := 'd2000000-0000-0000-0000-000000000010';
  v_event jsonb;
  v_players jsonb;
  v_original_event_id bigint;
  v_live_event_id bigint;
  v_same_live_event_id bigint;
  v_corrected_live_event_id bigint;
  v_divergence_status text;
  v_resolution_id bigint;
  v_same_resolution_id bigint;
  v_corrected_resolution_id bigint;
  v_resolved_at timestamptz := statement_timestamp();
begin
  select * into v_match
  from public.create_x01_match_atomic(
    '301',
    'double_out',
    2,
    false,
    array[
      'd2000000-0000-0000-0000-000000000001'::uuid,
      'd2000000-0000-0000-0000-000000000002'::uuid
    ]
  );

  select leg.id into strict v_leg_id
  from public.legs leg
  where leg.match_id = v_match.id and leg.leg_number = 1;

  select evidence.id into strict v_population_id
  from public.dartiq_population_evidence evidence
  where evidence.match_id = v_match.id;

  select evidence.id into strict v_alice_evidence_id
  from public.dartiq_player_evidence evidence
  where evidence.match_id = v_match.id
    and evidence.player_id = 'd2000000-0000-0000-0000-000000000001';

  select evidence.id into strict v_bob_evidence_id
  from public.dartiq_player_evidence evidence
  where evidence.match_id = v_match.id
    and evidence.player_id = 'd2000000-0000-0000-0000-000000000002';

  insert into public.dartiq_model_versions (
    model_key,
    implementation_hash,
    configuration,
    configuration_hash,
    outcome_model_version,
    evidence_schema_version
  ) values (
    'atomic-test',
    'atomic-implementation',
    '{}'::jsonb,
    'atomic-configuration',
    'behavioral-v1',
    1
  ) returning id into v_model_id;

  v_event := jsonb_build_object(
    'schema_version', 1,
    'match_id', v_match.id,
    'leg_id', v_leg_id,
    'throw_id', null,
    'source_throw_id', v_throw_id,
    'model_version_id', v_model_id,
    'population_evidence_id', v_population_id,
    'acting_player_id', 'd2000000-0000-0000-0000-000000000001',
    'provenance', 'reconstructed',
    'live_capture_status', 'not_supported',
    'live_capture_cause', 'completed_leg_reconstruction',
    'revision', 0,
    'sequence', 1,
    'pre_state_hash', 'state-0',
    'input_snapshot', '{}'::jsonb,
    'finish_rule', 'double_out',
    'cohort', 'manual',
    'player_count', 2,
    'score_before', 40,
    'score_band', '1_40',
    'checkout_state', 'available',
    'confidence_tier', 'fallback',
    'outcome_model_applicable', true,
    'approximation_modes', '[]'::jsonb,
    'actual_score_delta', 40,
    'actual_is_double', true,
    'busted', false,
    'actual_outcome', '{}'::jsonb,
    'computed_at', now()
  );

  v_players := jsonb_build_array(
    jsonb_build_object(
      'source_throw_id', v_throw_id,
      'player_id', 'd2000000-0000-0000-0000-000000000001',
      'player_evidence_id', v_alice_evidence_id,
      'leg_probability_before', 0.6,
      'leg_probability_after', 1.0,
      'match_probability_before', 0.55,
      'match_probability_after', 0.7,
      'expected_finish_summary', '{}'::jsonb,
      'state_bucket', '1_40:1',
      'confidence_tier', 'fallback',
      'backoff_level', 'fallback:family'
    ),
    jsonb_build_object(
      'source_throw_id', v_throw_id,
      'player_id', 'd2000000-0000-0000-0000-000000000002',
      'player_evidence_id', v_bob_evidence_id,
      'leg_probability_before', 0.4,
      'leg_probability_after', 0.0,
      'match_probability_before', 0.45,
      'match_probability_after', 0.3,
      'expected_finish_summary', '{}'::jsonb,
      'state_bucket', '61_100:3',
      'confidence_tier', 'fallback',
      'backoff_level', 'fallback:family'
    )
  );

  perform * from public.replace_dartiq_leg_projection_events(
    v_match.id, v_leg_id, v_model_id, 'reconstructed', 'revision-0', now(),
    jsonb_build_array(v_event), v_players
  );

  select event.id into strict v_original_event_id
  from public.dartiq_projection_events event
  where event.match_id = v_match.id and event.superseded_at is null;

  begin
    perform * from public.replace_dartiq_leg_projection_events(
      v_match.id,
      v_leg_id,
      v_model_id,
      'reconstructed',
      'revision-unmatched-player',
      now(),
      jsonb_build_array(v_event || jsonb_build_object('pre_state_hash', 'state-unmatched')),
      jsonb_set(
        v_players,
        '{1,source_throw_id}',
        to_jsonb('d2000000-0000-0000-0000-000000000099'::uuid)
      )
    );
    raise exception 'Expected replacement with an unmatched player row to fail';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    perform * from public.replace_dartiq_leg_projection_events(
      v_match.id,
      v_leg_id,
      v_model_id,
      'reconstructed',
      'revision-invalid-cohort',
      now(),
      jsonb_build_array(v_event || jsonb_build_object('cohort', 'scolia')),
      v_players
    );
    raise exception 'Expected projection cohort inconsistent with match ownership to fail';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    perform * from public.replace_dartiq_leg_projection_events(
      v_match.id,
      v_leg_id,
      v_model_id,
      'reconstructed',
      'revision-duplicate-participant',
      now(),
      jsonb_build_array(v_event),
      jsonb_set(
        jsonb_set(
          v_players,
          '{1,player_id}',
          to_jsonb('d2000000-0000-0000-0000-000000000001'::uuid)
        ),
        '{1,player_evidence_id}',
        to_jsonb(v_alice_evidence_id)
      )
    );
    raise exception 'Expected incomplete participant identity to fail';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    perform * from public.replace_dartiq_leg_projection_events(
      v_match.id,
      v_leg_id,
      v_model_id,
      'reconstructed',
      'revision-1',
      now(),
      jsonb_build_array(v_event || jsonb_build_object('revision', 1, 'pre_state_hash', 'state-1')),
      jsonb_set(
        v_players,
        '{1,player_evidence_id}',
        to_jsonb(v_alice_evidence_id)
      )
    );
    raise exception 'Expected replacement with mismatched player evidence to fail';
  exception when sqlstate '22023' then
    null;
  end;

  if not exists (
    select 1
    from public.dartiq_projection_events event
    where event.id = v_original_event_id and event.superseded_at is null
  ) then
    raise exception 'Failed replacement did not roll back its supersede';
  end if;

  if (
    select count(*)
    from public.dartiq_player_projections projection
    where projection.projection_event_id = v_original_event_id
  ) <> 2 then
    raise exception 'Atomic batch did not persist the complete player vector';
  end if;

  begin
    perform public.capture_dartiq_live_projection_event(
      v_event || jsonb_build_object(
        'provenance', 'live',
        'live_capture_status', 'complete',
        'live_capture_cause', null,
        'revision_hash', 'invalid-live-ownership'
      ),
      jsonb_set(
        v_players,
        '{0,player_evidence_id}',
        to_jsonb(v_bob_evidence_id)
      )
    );
    raise exception 'Expected live capture with mismatched player evidence to fail';
  exception when sqlstate '22023' then
    null;
  end;

  v_live_event_id := public.capture_dartiq_live_projection_event(
    v_event || jsonb_build_object(
      'provenance', 'live',
      'live_capture_status', 'complete',
      'live_capture_cause', null,
      'revision_hash', 'live-revision-0'
    ),
    v_players
  );

  v_same_live_event_id := public.capture_dartiq_live_projection_event(
    v_event || jsonb_build_object(
      'provenance', 'live',
      'live_capture_status', 'complete',
      'live_capture_cause', null,
      'revision_hash', 'live-revision-0'
    ),
    v_players
  );

  if v_same_live_event_id <> v_live_event_id then
    raise exception 'Identical live capture was not idempotent';
  end if;

  begin
    perform public.capture_dartiq_live_projection_event(
      v_event || jsonb_build_object(
        'provenance', 'live',
        'live_capture_status', 'complete',
        'live_capture_cause', null,
        'revision_hash', 'live-revision-0',
        'pre_state_hash', 'hash-collision-state'
      ),
      v_players
    );
    raise exception 'Expected reused live revision hash with different state to fail';
  exception when sqlstate '22023' then
    null;
  end;

  perform public.refresh_dartiq_projection_divergences(
    v_match.id,
    v_leg_id,
    v_model_id
  );

  select divergence.status into strict v_divergence_status
  from public.dartiq_projection_divergences divergence
  where divergence.reconstructed_projection_event_id = v_original_event_id;

  if v_divergence_status <> 'exact' then
    raise exception 'Matching live and reconstructed projections were not exact';
  end if;

  v_corrected_live_event_id := public.capture_dartiq_live_projection_event(
    v_event || jsonb_build_object(
      'provenance', 'live',
      'live_capture_status', 'complete',
      'live_capture_cause', null,
      'revision_hash', 'live-revision-1'
    ),
    jsonb_set(
      jsonb_set(v_players, '{0,leg_probability_after}', '0.98'::jsonb),
      '{0,match_probability_after}',
      '0.68'::jsonb
    )
  );

  if v_corrected_live_event_id = v_live_event_id
     or not exists (
       select 1
       from public.dartiq_projection_events event
       where event.id = v_live_event_id
         and event.superseded_at is not null
     ) then
    raise exception 'Corrected live capture did not preserve and supersede the old revision';
  end if;

  perform public.refresh_dartiq_projection_divergences(
    v_match.id,
    v_leg_id,
    v_model_id
  );

  if not exists (
    select 1
    from public.dartiq_projection_divergences divergence
    where divergence.reconstructed_projection_event_id = v_original_event_id
      and divergence.status = 'diverged'
      and divergence.pre_state_matches = true
      and divergence.max_leg_probability_delta > 0
      and divergence.max_match_probability_delta > 0
  ) then
    raise exception 'After-only live probability difference was not recorded as diverged';
  end if;

  update public.dartiq_projection_events event
  set live_capture_status = 'partial',
      live_capture_cause = 'correction_replay'
  where event.id = v_corrected_live_event_id;

  perform public.refresh_dartiq_projection_divergences(
    v_match.id,
    v_leg_id,
    v_model_id
  );

  if not exists (
    select 1
    from public.dartiq_projection_divergences divergence
    where divergence.reconstructed_projection_event_id = v_original_event_id
      and divergence.status = 'missing_live'
      and divergence.live_projection_event_id is null
  ) then
    raise exception 'Correction replay was incorrectly treated as independent live evidence';
  end if;

  update public.dartiq_projection_events event
  set superseded_at = statement_timestamp()
  where event.id = v_corrected_live_event_id;

  perform public.refresh_dartiq_projection_divergences(
    v_match.id,
    v_leg_id,
    v_model_id
  );

  if not exists (
    select 1
    from public.dartiq_projection_divergences divergence
    where divergence.reconstructed_projection_event_id = v_original_event_id
      and divergence.status = 'missing_live'
      and divergence.live_projection_event_id is null
      and divergence.pre_state_matches is null
      and divergence.max_leg_probability_delta is null
      and divergence.max_match_probability_delta is null
  ) then
    raise exception 'Absent active live projection was not recorded as missing';
  end if;

  v_resolution_id := public.replace_dartiq_projection_resolution(
    v_match.id,
    v_leg_id,
    'leg',
    'd2000000-0000-0000-0000-000000000001',
    false,
    v_resolved_at + interval '1 second'
  );
  v_same_resolution_id := public.replace_dartiq_projection_resolution(
    v_match.id,
    v_leg_id,
    'leg',
    'd2000000-0000-0000-0000-000000000001',
    false,
    v_resolved_at
  );

  if v_same_resolution_id <> v_resolution_id then
    raise exception 'Identical projection resolution replacement was not idempotent';
  end if;

  v_corrected_resolution_id := public.replace_dartiq_projection_resolution(
    v_match.id,
    v_leg_id,
    'leg',
    null,
    false,
    v_resolved_at + interval '1 second'
  );

  if v_corrected_resolution_id is not null
     or not exists (
       select 1
       from public.dartiq_projection_resolutions resolution
       where resolution.id = v_resolution_id
         and resolution.superseded_at is not null
     )
     or exists (
       select 1
       from public.dartiq_projection_resolutions resolution
       where resolution.match_id = v_match.id
         and resolution.kind = 'leg'
         and resolution.superseded_at is null
     ) then
    raise exception 'Null winner did not supersede the active leg resolution without a sentinel';
  end if;

  if public.replace_dartiq_projection_resolution(
    v_match.id,
    null,
    'match',
    null,
    false,
    v_resolved_at
  ) is not null
  or exists (
    select 1
    from public.dartiq_projection_resolutions resolution
    where resolution.match_id = v_match.id
      and resolution.kind = 'match'
  ) then
    raise exception 'Initial null match resolution was not a no-op';
  end if;

  perform public.replace_dartiq_projection_resolution(
    v_match.id,
    null,
    'match',
    'd2000000-0000-0000-0000-000000000002',
    false,
    v_resolved_at
  );
  perform public.replace_dartiq_projection_resolution(
    v_match.id,
    null,
    'match',
    null,
    true,
    v_resolved_at + interval '1 second'
  );

  if (
    select count(*)
    from public.dartiq_projection_resolutions resolution
    where resolution.match_id = v_match.id
      and resolution.kind = 'match'
  ) <> 1
  or exists (
    select 1
    from public.dartiq_projection_resolutions resolution
    where resolution.match_id = v_match.id
      and resolution.kind = 'match'
      and resolution.superseded_at is null
  ) then
    raise exception 'Match null winner did not preserve history while clearing active state';
  end if;

  begin
    perform public.replace_dartiq_projection_resolution(
      v_match.id,
      v_leg_id,
      'leg',
      'd2000000-0000-0000-0000-000000000003',
      false,
      v_resolved_at
    );
    raise exception 'Expected non-participant projection winner to fail';
  exception when sqlstate '22023' then
    null;
  end;

  if has_table_privilege('anon', 'public.dartiq_projection_divergences', 'select')
     or has_table_privilege('authenticated', 'public.dartiq_projection_divergences', 'insert')
     or has_function_privilege(
       'anon',
       'public.capture_dartiq_live_projection_event(jsonb,jsonb)',
       'execute'
     ) then
    raise exception 'DartIQ live projection evidence is exposed to browser roles';
  end if;

  if has_function_privilege(
    'anon',
    'public.replace_dartiq_projection_resolution(uuid,uuid,text,uuid,boolean,timestamp with time zone)',
    'execute'
  )
  or has_function_privilege(
    'authenticated',
    'public.replace_dartiq_projection_resolution(uuid,uuid,text,uuid,boolean,timestamp with time zone)',
    'execute'
  )
  or not has_function_privilege(
    'service_role',
    'public.replace_dartiq_projection_resolution(uuid,uuid,text,uuid,boolean,timestamp with time zone)',
    'execute'
  ) then
    raise exception 'DartIQ resolution replacement is exposed to browser roles';
  end if;
end;
$$;

select pass('DartIQ projection persistence is atomic, correction-safe, comparable, and server-only');
select * from finish();

rollback;
