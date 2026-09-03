-- Store one reconstructed leg revision atomically. The database owns both the
-- no-op decision and monotone revision number under a transaction-scoped lock.

alter table public.dartiq_projection_events
  add column if not exists outcome_model_applicable boolean not null default true;

alter table public.dartiq_projection_events
  add column if not exists revision_hash text not null default '';

drop function if exists public.replace_dartiq_leg_projection_events(
  uuid, uuid, bigint, text, timestamptz, jsonb, jsonb
);
drop function if exists public.replace_dartiq_leg_projection_events(
  uuid, uuid, bigint, text, text, timestamptz, jsonb, jsonb
);

create function public.replace_dartiq_leg_projection_events(
  p_match_id uuid,
  p_leg_id uuid,
  p_model_version_id bigint,
  p_provenance text,
  p_revision_hash text,
  p_replaced_at timestamptz,
  p_events jsonb,
  p_player_projections jsonb
)
returns table (source_throw_id uuid, projection_event_id bigint)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_active_count integer;
  v_event_count integer;
  v_player_count integer;
  v_revision integer;
  v_result jsonb;
begin
  if p_provenance not in ('live', 'reconstructed')
     or nullif(p_revision_hash, '') is null
     or jsonb_typeof(p_events) <> 'array'
     or jsonb_typeof(p_player_projections) <> 'array'
     or jsonb_array_length(p_events) = 0
     or jsonb_array_length(p_player_projections) = 0 then
    raise exception using errcode = '22023', message = 'invalid_dartiq_projection_batch';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_events) as event_payload(value)
    cross join lateral jsonb_populate_record(
      null::public.dartiq_projection_events,
      event_payload.value
    ) event_row
    where event_row.match_id is distinct from p_match_id
       or event_row.leg_id is distinct from p_leg_id
       or event_row.model_version_id is distinct from p_model_version_id
       or event_row.provenance is distinct from p_provenance
  ) then
    raise exception using errcode = '22023', message = 'mismatched_dartiq_projection_batch';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_match_id::text || ':' || p_leg_id::text || ':'
        || p_model_version_id::text || ':' || p_provenance,
      0
    )
  );

  select count(*)::integer into v_active_count
  from public.dartiq_projection_events event
  where event.match_id = p_match_id
    and event.leg_id = p_leg_id
    and event.model_version_id = p_model_version_id
    and event.provenance = p_provenance
    and event.superseded_at is null
    and event.revision_hash = p_revision_hash;

  if v_active_count = jsonb_array_length(p_events) then
    insert into public.dartiq_player_projections (
      projection_event_id,
      player_id,
      player_evidence_id,
      leg_probability_before,
      leg_probability_after,
      match_probability_before,
      match_probability_after,
      expected_finish_summary,
      state_bucket,
      confidence_tier,
      backoff_level
    )
    select
      active_event.id,
      player_row.player_id,
      player_row.player_evidence_id,
      player_row.leg_probability_before,
      player_row.leg_probability_after,
      player_row.match_probability_before,
      player_row.match_probability_after,
      player_row.expected_finish_summary,
      player_row.state_bucket,
      player_row.confidence_tier,
      player_row.backoff_level
    from jsonb_array_elements(p_player_projections) as player_payload(value)
    cross join lateral jsonb_populate_record(
      null::public.dartiq_player_projections,
      player_payload.value - 'source_throw_id'
    ) player_row
    join public.dartiq_projection_events active_event
      on active_event.source_throw_id = (player_payload.value ->> 'source_throw_id')::uuid
     and active_event.match_id = p_match_id
     and active_event.leg_id = p_leg_id
     and active_event.model_version_id = p_model_version_id
     and active_event.provenance = p_provenance
     and active_event.superseded_at is null
     and active_event.revision_hash = p_revision_hash
    on conflict (projection_event_id, player_id) do update set
      player_evidence_id = excluded.player_evidence_id,
      leg_probability_before = excluded.leg_probability_before,
      leg_probability_after = excluded.leg_probability_after,
      match_probability_before = excluded.match_probability_before,
      match_probability_after = excluded.match_probability_after,
      expected_finish_summary = excluded.expected_finish_summary,
      state_bucket = excluded.state_bucket,
      confidence_tier = excluded.confidence_tier,
      backoff_level = excluded.backoff_level;

    get diagnostics v_player_count = row_count;
    if v_player_count <> jsonb_array_length(p_player_projections) then
      raise exception using errcode = '22023', message = 'incomplete_dartiq_player_projections';
    end if;

    return query
    select event.source_throw_id, event.id
    from public.dartiq_projection_events event
    where event.match_id = p_match_id
      and event.leg_id = p_leg_id
      and event.model_version_id = p_model_version_id
      and event.provenance = p_provenance
      and event.superseded_at is null
      and event.revision_hash = p_revision_hash;
    return;
  end if;

  select coalesce(max(event.revision), -1) + 1 into v_revision
  from public.dartiq_projection_events event
  where event.match_id = p_match_id
    and event.leg_id = p_leg_id
    and event.model_version_id = p_model_version_id
    and event.provenance = p_provenance;

  update public.dartiq_projection_events existing
  set superseded_at = p_replaced_at
  where existing.match_id = p_match_id
    and existing.leg_id = p_leg_id
    and existing.model_version_id = p_model_version_id
    and existing.provenance = p_provenance
    and existing.superseded_at is null;

  with inserted_events as (
    insert into public.dartiq_projection_events (
      schema_version,
      match_id,
      leg_id,
      throw_id,
      source_throw_id,
      model_version_id,
      population_evidence_id,
      acting_player_id,
      provenance,
      live_capture_status,
      live_capture_cause,
      revision,
      revision_hash,
      sequence,
      pre_state_hash,
      input_snapshot,
      finish_rule,
      player_count,
      score_before,
      score_band,
      checkout_state,
      confidence_tier,
      outcome_model_applicable,
      approximation_modes,
      actual_score_delta,
      actual_is_double,
      busted,
      actual_outcome,
      computed_at
    )
    select
      event_row.schema_version,
      event_row.match_id,
      event_row.leg_id,
      event_row.throw_id,
      event_row.source_throw_id,
      event_row.model_version_id,
      event_row.population_evidence_id,
      event_row.acting_player_id,
      event_row.provenance,
      event_row.live_capture_status,
      event_row.live_capture_cause,
      v_revision,
      p_revision_hash,
      event_row.sequence,
      event_row.pre_state_hash,
      event_row.input_snapshot,
      event_row.finish_rule,
      event_row.player_count,
      event_row.score_before,
      event_row.score_band,
      event_row.checkout_state,
      event_row.confidence_tier,
      event_row.outcome_model_applicable,
      event_row.approximation_modes,
      event_row.actual_score_delta,
      event_row.actual_is_double,
      event_row.busted,
      event_row.actual_outcome,
      event_row.computed_at
    from jsonb_array_elements(p_events) as event_payload(value)
    cross join lateral jsonb_populate_record(
      null::public.dartiq_projection_events,
      event_payload.value
    ) event_row
    returning id, dartiq_projection_events.source_throw_id
  ), inserted_players as (
    insert into public.dartiq_player_projections (
      projection_event_id,
      player_id,
      player_evidence_id,
      leg_probability_before,
      leg_probability_after,
      match_probability_before,
      match_probability_after,
      expected_finish_summary,
      state_bucket,
      confidence_tier,
      backoff_level
    )
    select
      inserted_events.id,
      player_row.player_id,
      player_row.player_evidence_id,
      player_row.leg_probability_before,
      player_row.leg_probability_after,
      player_row.match_probability_before,
      player_row.match_probability_after,
      player_row.expected_finish_summary,
      player_row.state_bucket,
      player_row.confidence_tier,
      player_row.backoff_level
    from jsonb_array_elements(p_player_projections) as player_payload(value)
    cross join lateral jsonb_populate_record(
      null::public.dartiq_player_projections,
      player_payload.value - 'source_throw_id'
    ) player_row
    join inserted_events
      on inserted_events.source_throw_id = (player_payload.value ->> 'source_throw_id')::uuid
    returning dartiq_player_projections.projection_event_id
  )
  select
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'source_throw_id', inserted_events.source_throw_id,
        'projection_event_id', inserted_events.id
      ))
      from inserted_events
    ), '[]'::jsonb),
    (select count(*)::integer from inserted_events),
    (select count(*)::integer from inserted_players)
  into v_result, v_event_count, v_player_count;

  if v_event_count <> jsonb_array_length(p_events) then
    raise exception using errcode = '22023', message = 'incomplete_dartiq_projection_events';
  end if;
  if v_player_count <> jsonb_array_length(p_player_projections) then
    raise exception using errcode = '22023', message = 'incomplete_dartiq_player_projections';
  end if;

  return query
  select result.source_throw_id, result.projection_event_id
  from jsonb_to_recordset(v_result) as result(
    source_throw_id uuid,
    projection_event_id bigint
  );
end;
$$;

revoke all on function public.replace_dartiq_leg_projection_events(
  uuid, uuid, bigint, text, text, timestamptz, jsonb, jsonb
) from public, anon, authenticated;

grant execute on function public.replace_dartiq_leg_projection_events(
  uuid, uuid, bigint, text, text, timestamptz, jsonb, jsonb
) to service_role;

comment on function public.replace_dartiq_leg_projection_events(
  uuid, uuid, bigint, text, text, timestamptz, jsonb, jsonb
) is 'Atomically reuses or replaces one leg projection revision and its complete player vectors.';
