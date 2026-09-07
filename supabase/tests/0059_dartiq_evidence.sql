begin;

select plan(1);

insert into public.players (id, display_name, is_test)
values
  ('d1000000-0000-0000-0000-000000000001', 'DartIQ Alice', false),
  ('d1000000-0000-0000-0000-000000000002', 'DartIQ Bob', false);

insert into public.matches (
  id, start_score, finish, legs_to_win, winner_player_id, completed_at, created_at
) values
  ('d1000000-0000-0000-0000-000000000101', '301', 'double_out', 1,
   'd1000000-0000-0000-0000-000000000001', now() - interval '3 days', now() - interval '3 days 1 hour'),
  ('d1000000-0000-0000-0000-000000000102', '301', 'double_out', 1,
   'd1000000-0000-0000-0000-000000000001', now() - interval '2 days', now() - interval '2 days 1 hour');

insert into public.match_players (match_id, player_id, play_order) values
  ('d1000000-0000-0000-0000-000000000101', 'd1000000-0000-0000-0000-000000000001', 0),
  ('d1000000-0000-0000-0000-000000000101', 'd1000000-0000-0000-0000-000000000002', 1),
  ('d1000000-0000-0000-0000-000000000102', 'd1000000-0000-0000-0000-000000000002', 0),
  ('d1000000-0000-0000-0000-000000000102', 'd1000000-0000-0000-0000-000000000001', 1);

insert into public.legs (id, match_id, leg_number, starting_player_id, winner_player_id) values
  ('d1000000-0000-0000-0000-000000000201', 'd1000000-0000-0000-0000-000000000101', 1,
   'd1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001'),
  ('d1000000-0000-0000-0000-000000000202', 'd1000000-0000-0000-0000-000000000102', 1,
   'd1000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000001');

insert into public.turns (id, leg_id, player_id, turn_number, total_scored, busted) values
  ('d1000000-0000-0000-0000-000000000301', 'd1000000-0000-0000-0000-000000000201', 'd1000000-0000-0000-0000-000000000001', 1, 180, false),
  ('d1000000-0000-0000-0000-000000000302', 'd1000000-0000-0000-0000-000000000201', 'd1000000-0000-0000-0000-000000000002', 2, 142, false),
  ('d1000000-0000-0000-0000-000000000303', 'd1000000-0000-0000-0000-000000000201', 'd1000000-0000-0000-0000-000000000001', 3, 121, false),
  ('d1000000-0000-0000-0000-000000000304', 'd1000000-0000-0000-0000-000000000202', 'd1000000-0000-0000-0000-000000000002', 1, 180, false),
  ('d1000000-0000-0000-0000-000000000305', 'd1000000-0000-0000-0000-000000000202', 'd1000000-0000-0000-0000-000000000001', 2, 140, false),
  ('d1000000-0000-0000-0000-000000000306', 'd1000000-0000-0000-0000-000000000202', 'd1000000-0000-0000-0000-000000000002', 3, 81, false),
  ('d1000000-0000-0000-0000-000000000307', 'd1000000-0000-0000-0000-000000000202', 'd1000000-0000-0000-0000-000000000001', 4, 161, false);

insert into public.throws (turn_id, dart_index, segment, scored) values
  ('d1000000-0000-0000-0000-000000000301', 1, 'T20', 60),
  ('d1000000-0000-0000-0000-000000000301', 2, 'T20', 60),
  ('d1000000-0000-0000-0000-000000000301', 3, 'T20', 60),
  ('d1000000-0000-0000-0000-000000000302', 1, 'D11', 22),
  ('d1000000-0000-0000-0000-000000000302', 2, 'T20', 60),
  ('d1000000-0000-0000-0000-000000000302', 3, 'T20', 60),
  ('d1000000-0000-0000-0000-000000000303', 1, 'T20', 60),
  ('d1000000-0000-0000-0000-000000000303', 2, 'T11', 33),
  ('d1000000-0000-0000-0000-000000000303', 3, 'D14', 28),
  ('d1000000-0000-0000-0000-000000000304', 1, 'T20', 60),
  ('d1000000-0000-0000-0000-000000000304', 2, 'T20', 60),
  ('d1000000-0000-0000-0000-000000000304', 3, 'T20', 60),
  ('d1000000-0000-0000-0000-000000000305', 1, 'T20', 60),
  ('d1000000-0000-0000-0000-000000000305', 2, 'T20', 60),
  ('d1000000-0000-0000-0000-000000000305', 3, 'S20', 20),
  ('d1000000-0000-0000-0000-000000000306', 1, 'T19', 57),
  ('d1000000-0000-0000-0000-000000000306', 2, 'S12', 12),
  ('d1000000-0000-0000-0000-000000000306', 3, 'S12', 12),
  ('d1000000-0000-0000-0000-000000000307', 1, 'T20', 60),
  ('d1000000-0000-0000-0000-000000000307', 2, 'T17', 51),
  ('d1000000-0000-0000-0000-000000000307', 3, 'DB', 50);

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
    and evidence.raw_evidence ? 'outcomes'
    and evidence.raw_evidence ? 'historicalFacts';

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

  if not exists (
    select 1
    from public.dartiq_population_evidence population,
      jsonb_array_elements(population.raw_evidence -> 'historicalFacts') fact
    where population.id = v_population_id
      and fact ->> 'kind' = 'matchup_history'
      and (fact -> 'evidence' ->> 'sharedMatches')::integer = 2
      and (fact -> 'evidence' ->> 'subjectWins')::integer = 2
      and (fact -> 'evidence' ->> 'counterpartWins')::integer = 0
      and (fact -> 'evidence' ->> 'currentWinnerStreak')::integer = 2
  ) then
    raise exception 'Frozen matchup history is missing or incorrect';
  end if;

  if not exists (
    select 1
    from public.dartiq_population_evidence population,
      jsonb_array_elements(population.raw_evidence -> 'historicalFacts') fact
    where population.id = v_population_id
      and fact ->> 'kind' = 'player_history'
      and fact ->> 'subjectPlayerId' = 'd1000000-0000-0000-0000-000000000001'
      and (fact -> 'evidence' ->> 'highestCheckout')::integer = 161
      and (fact -> 'evidence' ->> 'fastestWinningLegDarts')::integer = 6
  ) then
    raise exception 'Frozen personal records are missing or incorrect';
  end if;

  if not exists (
    select 1
    from public.dartiq_population_evidence population,
      jsonb_array_elements(population.raw_evidence -> 'historicalFacts') fact
    where population.id = v_population_id
      and (population.raw_evidence ->> 'historicalFactsCutoffAt')::timestamptz = v_match.created_at
      and fact ->> 'kind' = 'player_history'
      and fact ->> 'subjectPlayerId' = 'd1000000-0000-0000-0000-000000000002'
      and (fact -> 'evidence' ->> 'bogeyLeaves')::integer = 1
  ) then
    raise exception 'Frozen fact cutoff or bogey history is missing or incorrect';
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
