begin;

select plan(1);

insert into public.players (id, display_name, is_test)
values
  ('d1000000-0000-0000-0000-000000000001', 'DartIQ Alice', true),
  ('d1000000-0000-0000-0000-000000000002', 'DartIQ Bob', true);

do $$
declare
  v_match public.matches%rowtype;
  v_population_id bigint;
begin
  select *
  into v_match
  from public.create_x01_match_atomic(
    '301',
    'double_out',
    2,
    false,
    array[
      'd1000000-0000-0000-0000-000000000001'::uuid,
      'd1000000-0000-0000-0000-000000000002'::uuid
    ]
  );

  select evidence.id
  into strict v_population_id
  from public.dartiq_population_evidence evidence
  where evidence.match_id = v_match.id
    and evidence.finish_rule = 'double_out'
    and evidence.raw_evidence ? 'profile'
    and evidence.raw_evidence ? 'outcomes';

  if (
    select count(*)
    from public.dartiq_player_evidence evidence
    where evidence.match_id = v_match.id
      and evidence.population_evidence_id = v_population_id
      and evidence.historical_cutoff_at = (
        select population.historical_cutoff_at
        from public.dartiq_population_evidence population
        where population.id = v_population_id
      )
      and evidence.raw_evidence ? 'profile'
      and evidence.raw_evidence ? 'outcomes'
  ) <> 2 then
    raise exception 'Atomic match creation did not freeze one linked DartIQ evidence row per player';
  end if;

  perform public.capture_dartiq_match_evidence(v_match.id);
  if (select count(*) from public.dartiq_population_evidence where match_id = v_match.id) <> 1
     or (select count(*) from public.dartiq_player_evidence where match_id = v_match.id) <> 2 then
    raise exception 'DartIQ evidence capture is not idempotent';
  end if;

  if has_table_privilege('anon', 'public.dartiq_player_profiles', 'select')
     or has_table_privilege('authenticated', 'public.dartiq_population_outcomes', 'select')
     or has_table_privilege('anon', 'public.dartiq_projection_events', 'select')
     or has_table_privilege('authenticated', 'public.dartiq_player_projections', 'insert')
     or has_function_privilege(
       'anon',
       'public.capture_dartiq_match_evidence(uuid)',
       'execute'
     )
     or not has_function_privilege(
       'service_role',
       'public.capture_dartiq_match_evidence(uuid)',
       'execute'
     ) then
    raise exception 'DartIQ evidence or telemetry privileges are incorrect';
  end if;
end;
$$;

select pass('DartIQ evidence freezes atomically, idempotently, and privately');
select * from finish();

rollback;
