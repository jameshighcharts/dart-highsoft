begin;

select plan(1);

insert into public.players (id, display_name, is_test)
values
  ('d0620000-0000-0000-0000-000000000001', 'Policy Alice', true),
  ('d0620000-0000-0000-0000-000000000002', 'Policy Bob', true);

do $$
declare
  v_match public.matches%rowtype;
  v_other_match public.matches%rowtype;
  v_session_id uuid;
begin
  select * into v_match
  from public.create_x01_match_atomic(
    '301',
    'double_out',
    1,
    false,
    array[
      'd0620000-0000-0000-0000-000000000001'::uuid,
      'd0620000-0000-0000-0000-000000000002'::uuid
    ]
  );

  select * into v_other_match
  from public.create_x01_match_atomic(
    '301',
    'double_out',
    1,
    false,
    array[
      'd0620000-0000-0000-0000-000000000002'::uuid,
      'd0620000-0000-0000-0000-000000000001'::uuid
    ]
  );

  insert into public.commentary_realtime_sessions (
    match_id,
    client_instance_id,
    openai_call_id,
    persona_id,
    voice
  ) values (
    v_match.id,
    'd0620000-0000-0000-0000-000000000010',
    'policy-call-1',
    'classic',
    'alloy'
  ) returning id into v_session_id;

  update public.commentary_realtime_sessions
  set opening_call_claimed_at = now()
  where id = v_session_id;

  begin
    insert into public.commentary_realtime_sessions (
      match_id,
      client_instance_id,
      openai_call_id,
      persona_id,
      voice,
      opening_call_claimed_at
    ) values (
      v_match.id,
      'd0620000-0000-0000-0000-000000000010',
      'policy-call-reconnect',
      'classic',
      'alloy',
      now()
    );
    raise exception 'A reconnect claimed a duplicate pre-match opener';
  exception
    when unique_violation then null;
  end;

  insert into public.commentary_realtime_sessions (
    match_id,
    client_instance_id,
    openai_call_id,
    persona_id,
    voice,
    opening_call_claimed_at
  ) values (
    v_match.id,
    'd0620000-0000-0000-0000-000000000011',
    'policy-call-other-listener',
    'classic',
    'alloy',
    now()
  );

  insert into public.dartiq_commentary_policy_decisions (
    session_id,
    match_id,
    source_event_id,
    epoch,
    channel,
    policy_version,
    priority,
    signals,
    should_speak,
    guaranteed,
    interrupt,
    reason,
    evaluated_at
  ) values (
    v_session_id,
    v_match.id,
    'turn:one',
    0,
    'browser',
    'policy-test-v1',
    'notable',
    array['large_swing'],
    true,
    false,
    false,
    'speak',
    now()
  );

  insert into public.dartiq_commentary_policy_decisions (
    session_id,
    match_id,
    source_event_id,
    epoch,
    channel,
    policy_version,
    priority,
    should_speak,
    guaranteed,
    interrupt,
    reason,
    evaluated_at
  ) values (
    v_session_id,
    v_match.id,
    'turn:one',
    0,
    'browser',
    'policy-test-v1',
    'notable',
    true,
    false,
    false,
    'speak',
    now()
  ) on conflict do nothing;

  if (
    select count(*)
    from public.dartiq_commentary_policy_decisions
    where session_id = v_session_id
  ) <> 1 then
    raise exception 'Policy decision idempotency key did not deduplicate';
  end if;

  insert into public.dartiq_commentary_arc_events (
    session_id, match_id, source_event_id, epoch, sequence, channel,
    director_version, arc_key, arc_kind, subject_player_id, counterpart_player_id,
    lifecycle_event, phase, treatment, strength, callback_trigger, evidence, occurred_at
  ) values (
    v_session_id, v_match.id, 'turn:one', 0, 12, 'browser',
    'broadcast-director-test', 'comeback:alice:bob', 'comeback',
    'd0620000-0000-0000-0000-000000000001',
    'd0620000-0000-0000-0000-000000000002',
    'payoff_due', 'payoff', 'narrative_callback', 0.88,
    'probability_reversal', '{"swing": 0.42}'::jsonb, now()
  );

  insert into public.dartiq_commentary_arc_events (
    session_id, match_id, source_event_id, epoch, sequence, channel,
    director_version, arc_key, arc_kind, subject_player_id, counterpart_player_id,
    lifecycle_event, phase, treatment, strength, callback_trigger, evidence,
    provider_response_id, transcript, occurred_at
  ) values (
    v_session_id, v_match.id, 'turn:one', 0, 12, 'browser',
    'broadcast-director-test', 'comeback:alice:bob', 'comeback',
    'd0620000-0000-0000-0000-000000000001',
    'd0620000-0000-0000-0000-000000000002',
    'response_completed', 'payoff', 'narrative_callback', 0.88,
    'probability_reversal', '{"swing": 0.42}'::jsonb,
    'resp_policy_test', 'And that completes the comeback.', now()
  );

  insert into public.dartiq_commentary_arc_events (
    session_id, match_id, source_event_id, epoch, sequence, channel,
    director_version, arc_key, arc_kind, lifecycle_event, phase, treatment,
    strength, callback_trigger, evidence, provider_response_id, transcript, occurred_at
  ) values (
    v_session_id, v_match.id, 'turn:one', 0, 12, 'browser',
    'broadcast-director-test', 'comeback:alice:bob', 'comeback',
    'response_completed', 'payoff', 'narrative_callback', 0.88,
    'probability_reversal', '{}'::jsonb,
    'resp_duplicate', 'Duplicate completion.', now()
  ) on conflict do nothing;

  if (
    select count(*)
    from public.dartiq_commentary_arc_events
    where session_id = v_session_id
  ) <> 2 then
    raise exception 'Arc lifecycle did not preserve due/completed events or deduplicate retries';
  end if;

  begin
    insert into public.dartiq_commentary_arc_events (
      session_id, match_id, source_event_id, epoch, sequence, channel,
      director_version, arc_key, arc_kind, lifecycle_event, phase, treatment,
      strength, callback_trigger, evidence, provider_response_id, occurred_at
    ) values (
      v_session_id, v_match.id, 'turn:missing-transcript', 0, 13, 'browser',
      'broadcast-director-test', 'comeback:alice:bob', 'comeback',
      'response_completed', 'payoff', 'narrative_callback', 0.88,
      'probability_reversal', '{}'::jsonb, 'resp_without_words', now()
    );
    raise exception 'Response completion accepted a missing transcript';
  exception
    when check_violation then null;
  end;

  begin
    insert into public.dartiq_commentary_policy_decisions (
      session_id,
      match_id,
      source_event_id,
      epoch,
      channel,
      policy_version,
      priority,
      should_speak,
      guaranteed,
      interrupt,
      reason,
      evaluated_at
    ) values (
      v_session_id,
      v_other_match.id,
      'turn:wrong-match',
      0,
      'browser',
      'policy-test-v1',
      'silent',
      false,
      false,
      false,
      'silent-priority',
      now()
    );
    raise exception 'Policy decision accepted a session from another match';
  exception
    when foreign_key_violation then null;
  end;

  if not (
    select relrowsecurity
    from pg_class
    where oid = 'public.dartiq_commentary_policy_decisions'::regclass
  )
  or has_table_privilege('anon', 'public.dartiq_commentary_policy_decisions', 'select')
  or has_table_privilege('authenticated', 'public.dartiq_commentary_policy_decisions', 'insert')
  or not (
    select relrowsecurity
    from pg_class
    where oid = 'public.dartiq_commentary_arc_events'::regclass
  )
  or has_table_privilege('anon', 'public.dartiq_commentary_arc_events', 'select')
  or has_table_privilege('authenticated', 'public.dartiq_commentary_arc_events', 'insert') then
    raise exception 'Commentary policy telemetry is not server-only under RLS';
  end if;
end;
$$;

select pass('DartIQ commentary policy decisions are private, idempotent, and match-bound');
select * from finish();

rollback;
