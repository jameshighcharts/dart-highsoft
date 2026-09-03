-- Add rematch lineage to atomic X01 creation and freeze DartIQ evidence in a
-- single database statement before the first dart can be accepted.

drop function if exists public.create_x01_match_atomic(
  public.x01_start,
  public.finish_rule,
  integer,
  boolean,
  uuid[],
  uuid
);
drop function if exists public.create_x01_match_atomic(
  public.x01_start,
  public.finish_rule,
  integer,
  boolean,
  uuid[],
  uuid,
  uuid
);
drop function if exists public.capture_dartiq_match_evidence(uuid);

create function public.create_x01_match_atomic(
  p_start_score public.x01_start,
  p_finish public.finish_rule,
  p_legs_to_win integer,
  p_fair_ending boolean,
  p_player_ids uuid[],
  p_scolia_board_id uuid default null,
  p_rematch_of_match_id uuid default null
)
returns setof public.matches
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_match public.matches%rowtype;
  v_player_count integer;
begin
  if p_legs_to_win is null
     or p_legs_to_win < 1
     or p_fair_ending is null
     or p_player_ids is null
     or cardinality(p_player_ids) < 2
     or array_position(p_player_ids, null) is not null
     or cardinality(p_player_ids) <> (
       select count(distinct player_id)
       from unnest(p_player_ids) as requested(player_id)
     ) then
    raise exception using errcode = '22023', message = 'invalid_match_players';
  end if;

  select count(*) into v_player_count
  from public.players p
  where p.id = any(p_player_ids);

  if v_player_count <> cardinality(p_player_ids) then
    raise exception using errcode = 'P0002', message = 'player_not_found';
  end if;

  insert into public.matches (
    mode,
    start_score,
    finish,
    legs_to_win,
    fair_ending,
    scolia_board_id,
    rematch_of_match_id
  ) values (
    'x01',
    p_start_score,
    p_finish,
    p_legs_to_win,
    p_fair_ending,
    p_scolia_board_id,
    p_rematch_of_match_id
  ) returning * into v_match;

  insert into public.match_players (match_id, player_id, play_order)
  select v_match.id, requested.player_id, requested.ordinality::integer - 1
  from unnest(p_player_ids) with ordinality as requested(player_id, ordinality);

  insert into public.legs (match_id, leg_number, starting_player_id)
  values (v_match.id, 1, p_player_ids[1]);

  perform public.capture_dartiq_match_evidence(v_match.id);

  return next v_match;
  return;
end;
$$;

create function public.capture_dartiq_match_evidence(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_finish public.finish_rule;
  v_cutoff timestamptz := statement_timestamp();
  v_population jsonb;
  v_population_id bigint;
  v_player record;
  v_player_evidence jsonb;
begin
  select m.finish into strict v_finish
  from public.matches m
  where m.id = p_match_id;

  select jsonb_build_object(
    'profile', (
      select to_jsonb(profile)
      from public.dartiq_population_profiles profile
      where profile.finish_rule = v_finish
    ),
    'outcomes', coalesce((
      select jsonb_agg(to_jsonb(outcome) order by outcome.current_score, outcome.darts_left, outcome.score_delta, outcome.is_double)
      from public.dartiq_population_outcomes outcome
      where outcome.finish_rule = v_finish
    ), '[]'::jsonb)
  ) into v_population;

  insert into public.dartiq_population_evidence (
    match_id,
    finish_rule,
    historical_cutoff_at,
    eligibility_version,
    eligible_player_count,
    evidence_schema_version,
    raw_evidence,
    content_hash
  ) values (
    p_match_id,
    v_finish::text,
    v_cutoff,
    'completed-nontest-x01-v1',
    (select count(*) from public.dartiq_player_profiles profile where profile.finish_rule = v_finish),
    1,
    v_population,
    md5(v_population::text)
  )
  on conflict (match_id, finish_rule) do nothing;

  select evidence.id into strict v_population_id
  from public.dartiq_population_evidence evidence
  where evidence.match_id = p_match_id
    and evidence.finish_rule = v_finish::text;

  for v_player in
    select match_player.player_id
    from public.match_players match_player
    where match_player.match_id = p_match_id
    order by match_player.play_order
  loop
    select jsonb_build_object(
      'profile', (
        select to_jsonb(profile)
        from public.dartiq_player_profiles profile
        where profile.finish_rule = v_finish
          and profile.player_id = v_player.player_id
      ),
      'outcomes', coalesce((
        select jsonb_agg(to_jsonb(outcome) order by outcome.current_score, outcome.darts_left, outcome.score_delta, outcome.is_double)
        from public.dartiq_player_outcomes outcome
        where outcome.finish_rule = v_finish
          and outcome.player_id = v_player.player_id
      ), '[]'::jsonb)
    ) into v_player_evidence;

    insert into public.dartiq_player_evidence (
      match_id,
      player_id,
      population_evidence_id,
      finish_rule,
      historical_cutoff_at,
      evidence_schema_version,
      raw_evidence,
      content_hash
    ) values (
      p_match_id,
      v_player.player_id,
      v_population_id,
      v_finish::text,
      v_cutoff,
      1,
      v_player_evidence,
      md5(v_player_evidence::text)
    )
    on conflict (match_id, player_id, finish_rule) do nothing;
  end loop;
end;
$$;

revoke all on function public.capture_dartiq_match_evidence(uuid) from public, anon, authenticated;
grant execute on function public.capture_dartiq_match_evidence(uuid) to service_role;

comment on function public.capture_dartiq_match_evidence(uuid) is
  'Freezes population and player DartIQ evidence for one match in a single statement snapshot.';
