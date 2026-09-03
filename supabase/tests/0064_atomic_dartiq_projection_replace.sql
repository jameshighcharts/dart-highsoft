begin;

select plan(1);

insert into public.players (id, display_name, is_test)
values
  ('d2000000-0000-0000-0000-000000000001', 'Atomic DartIQ Alice', true),
  ('d2000000-0000-0000-0000-000000000002', 'Atomic DartIQ Bob', true);

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
      'revision-1',
      now(),
      jsonb_build_array(v_event || jsonb_build_object('revision', 1, 'pre_state_hash', 'state-1')),
      jsonb_set(
        v_players,
        '{1,player_evidence_id}',
        to_jsonb(9223372036854775807::bigint)
      )
    );
    raise exception 'Expected replacement with invalid evidence to fail';
  exception when foreign_key_violation then
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
end;
$$;

select pass('DartIQ projection replacement preserves the active revision when a child insert fails');
select * from finish();

rollback;
