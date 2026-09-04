-- Frozen DartIQ evidence and append-only projection telemetry.
-- These tables are server-only. Browser roles receive no RLS policy.

create table public.dartiq_model_versions (
  id bigint generated always as identity primary key,
  model_key text not null,
  implementation_hash text not null,
  configuration jsonb not null,
  configuration_hash text not null,
  outcome_model_version text not null,
  evidence_schema_version integer not null check (evidence_schema_version > 0),
  created_at timestamptz not null default now(),
  unique (implementation_hash, configuration_hash)
);

create table public.dartiq_population_evidence (
  id bigint generated always as identity primary key,
  match_id uuid not null references public.matches(id) on delete cascade,
  finish_rule text not null check (finish_rule in ('single_out', 'double_out')),
  historical_cutoff_at timestamptz not null,
  eligibility_version text not null,
  eligible_player_count integer not null check (eligible_player_count >= 0),
  evidence_schema_version integer not null check (evidence_schema_version > 0),
  raw_evidence jsonb not null,
  content_hash text not null,
  created_at timestamptz not null default now(),
  unique (match_id, finish_rule)
);

create index dartiq_population_evidence_content_hash_idx
  on public.dartiq_population_evidence (content_hash);

create table public.dartiq_player_evidence (
  id bigint generated always as identity primary key,
  match_id uuid not null references public.matches(id) on delete cascade,
  player_id uuid not null references public.players(id),
  population_evidence_id bigint not null
    references public.dartiq_population_evidence(id) on delete cascade,
  finish_rule text not null check (finish_rule in ('single_out', 'double_out')),
  historical_cutoff_at timestamptz not null,
  evidence_schema_version integer not null check (evidence_schema_version > 0),
  raw_evidence jsonb not null,
  content_hash text not null,
  created_at timestamptz not null default now(),
  unique (match_id, player_id, finish_rule)
);

create index dartiq_player_evidence_player_idx
  on public.dartiq_player_evidence (player_id);

create index dartiq_player_evidence_population_idx
  on public.dartiq_player_evidence (population_evidence_id);

create index dartiq_player_evidence_content_hash_idx
  on public.dartiq_player_evidence (content_hash);

create table public.dartiq_projection_events (
  id bigint generated always as identity primary key,
  schema_version integer not null check (schema_version > 0),
  match_id uuid not null references public.matches(id) on delete cascade,
  leg_id uuid not null references public.legs(id) on delete cascade,
  throw_id uuid references public.throws(id) on delete set null,
  source_throw_id uuid not null,
  model_version_id bigint not null references public.dartiq_model_versions(id),
  population_evidence_id bigint not null
    references public.dartiq_population_evidence(id) on delete cascade,
  acting_player_id uuid not null references public.players(id),
  provenance text not null check (provenance in ('live', 'reconstructed')),
  live_capture_status text not null
    check (live_capture_status in ('complete', 'partial', 'not_supported')),
  live_capture_cause text,
  revision integer not null default 0 check (revision >= 0),
  revision_hash text not null,
  sequence integer not null check (sequence > 0),
  pre_state_hash text not null,
  input_snapshot jsonb not null,
  finish_rule text not null check (finish_rule in ('single_out', 'double_out')),
  cohort text not null check (cohort in ('manual', 'scolia')),
  player_count integer not null check (player_count > 0),
  score_before smallint not null check (score_before >= 0),
  score_band text not null check (
    score_band in ('finished', '1_40', '41_60', '61_100', '101_170', '171_230', '231_plus', 'tiebreak')
  ),
  checkout_state text not null check (
    checkout_state in ('none', 'available', 'bogey', 'waiting', 'tiebreak', 'resolved')
  ),
  confidence_tier text not null check (
    confidence_tier in ('fallback', 'population', 'player_sparse', 'player_established')
  ),
  outcome_model_applicable boolean not null default true,
  approximation_modes text[] not null default '{}',
  actual_score_delta smallint not null,
  actual_is_double boolean not null,
  busted boolean not null,
  actual_outcome jsonb not null,
  superseded_at timestamptz,
  computed_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (
    (live_capture_status = 'complete' and live_capture_cause is null)
    or live_capture_status <> 'complete'
  )
);

create unique index dartiq_projection_events_active_key
  on public.dartiq_projection_events (
    match_id,
    source_throw_id,
    model_version_id,
    provenance
  )
  where superseded_at is null;

create index dartiq_projection_events_match_sequence_idx
  on public.dartiq_projection_events (match_id, sequence);

create unique index dartiq_projection_events_active_sequence_key
  on public.dartiq_projection_events (match_id, sequence, model_version_id, provenance)
  where superseded_at is null;

create index dartiq_projection_events_leg_idx
  on public.dartiq_projection_events (leg_id);

create index dartiq_projection_events_throw_idx
  on public.dartiq_projection_events (throw_id)
  where throw_id is not null;

create index dartiq_projection_events_model_time_idx
  on public.dartiq_projection_events (model_version_id, created_at);

create index dartiq_projection_events_population_idx
  on public.dartiq_projection_events (population_evidence_id);

create index dartiq_projection_events_acting_player_idx
  on public.dartiq_projection_events (acting_player_id);

create table public.dartiq_player_projections (
  projection_event_id bigint not null
    references public.dartiq_projection_events(id) on delete cascade,
  player_id uuid not null references public.players(id),
  player_evidence_id bigint not null
    references public.dartiq_player_evidence(id) on delete cascade,
  leg_probability_before double precision not null
    check (leg_probability_before between 0 and 1),
  leg_probability_after double precision not null
    check (leg_probability_after between 0 and 1),
  match_probability_before double precision not null
    check (match_probability_before between 0 and 1),
  match_probability_after double precision not null
    check (match_probability_after between 0 and 1),
  expected_finish_summary jsonb not null,
  state_bucket text not null,
  confidence_tier text not null check (
    confidence_tier in ('fallback', 'population', 'player_sparse', 'player_established')
  ),
  backoff_level text not null,
  primary key (projection_event_id, player_id)
);

create index dartiq_player_projections_player_idx
  on public.dartiq_player_projections (player_id);

create index dartiq_player_projections_evidence_idx
  on public.dartiq_player_projections (player_evidence_id);

create table public.dartiq_projection_resolutions (
  id bigint generated always as identity primary key,
  match_id uuid not null references public.matches(id) on delete cascade,
  leg_id uuid references public.legs(id) on delete cascade,
  kind text not null check (kind in ('leg', 'match')),
  winner_player_id uuid references public.players(id),
  ended_early boolean not null default false,
  resolved_at timestamptz not null,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  check (
    (kind = 'leg' and leg_id is not null)
    or (kind = 'match' and leg_id is null)
  )
);

create unique index dartiq_projection_resolutions_active_leg_key
  on public.dartiq_projection_resolutions (match_id, leg_id)
  where kind = 'leg' and superseded_at is null;

create unique index dartiq_projection_resolutions_active_match_key
  on public.dartiq_projection_resolutions (match_id)
  where kind = 'match' and superseded_at is null;

create index dartiq_projection_resolutions_leg_idx
  on public.dartiq_projection_resolutions (leg_id)
  where leg_id is not null;

create index dartiq_projection_resolutions_winner_idx
  on public.dartiq_projection_resolutions (winner_player_id)
  where winner_player_id is not null;

create table public.dartiq_projection_divergences (
  reconstructed_projection_event_id bigint primary key
    references public.dartiq_projection_events(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  leg_id uuid not null references public.legs(id) on delete cascade,
  source_throw_id uuid not null,
  model_version_id bigint not null references public.dartiq_model_versions(id),
  live_projection_event_id bigint
    references public.dartiq_projection_events(id) on delete set null,
  status text not null check (status in ('exact', 'diverged', 'missing_live')),
  pre_state_matches boolean,
  max_leg_probability_delta double precision
    check (max_leg_probability_delta >= 0),
  max_match_probability_delta double precision
    check (max_match_probability_delta >= 0),
  detected_at timestamptz not null default now()
);

create index dartiq_projection_divergences_match_status_idx
  on public.dartiq_projection_divergences (match_id, status, detected_at);

create index dartiq_projection_divergences_leg_idx
  on public.dartiq_projection_divergences (leg_id);

create index dartiq_projection_divergences_source_throw_idx
  on public.dartiq_projection_divergences (source_throw_id);

create index dartiq_projection_divergences_model_idx
  on public.dartiq_projection_divergences (model_version_id);

create index dartiq_projection_divergences_live_event_idx
  on public.dartiq_projection_divergences (live_projection_event_id)
  where live_projection_event_id is not null;

create table public.dartiq_commentary_policy_decisions (
  id bigint generated always as identity primary key,
  session_id uuid not null,
  match_id uuid not null references public.matches(id) on delete cascade,
  throw_id uuid references public.throws(id) on delete set null,
  turn_id uuid references public.turns(id) on delete set null,
  source_event_id text not null,
  epoch bigint not null check (epoch >= 0),
  channel text not null check (channel in ('browser', 'scolia_worker')),
  policy_version text not null,
  priority text not null check (priority in ('silent', 'ordinary', 'notable', 'marquee', 'terminal')),
  signals text[] not null default '{}',
  should_speak boolean not null,
  guaranteed boolean not null,
  interrupt boolean not null,
  reason text not null check (reason in (
    'guaranteed',
    'silent-priority',
    'visit-in-progress',
    'rapid-sequence',
    'duplicate-observation',
    'cooldown',
    'ordinary-sampling',
    'active-higher-priority',
    'speak'
  )),
  evaluated_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (session_id, match_id)
    references public.commentary_realtime_sessions(id, match_id) on delete cascade,
  unique (session_id, epoch, source_event_id, policy_version)
);

create index dartiq_commentary_policy_decisions_match_idx
  on public.dartiq_commentary_policy_decisions (match_id, evaluated_at);

create index dartiq_commentary_policy_decisions_calibration_idx
  on public.dartiq_commentary_policy_decisions (policy_version, priority, should_speak)
  include (reason, signals, evaluated_at);

create index dartiq_commentary_policy_decisions_throw_idx
  on public.dartiq_commentary_policy_decisions (throw_id)
  where throw_id is not null;

create index dartiq_commentary_policy_decisions_turn_idx
  on public.dartiq_commentary_policy_decisions (turn_id)
  where turn_id is not null;

alter table public.dartiq_model_versions enable row level security;
alter table public.dartiq_population_evidence enable row level security;
alter table public.dartiq_player_evidence enable row level security;
alter table public.dartiq_projection_events enable row level security;
alter table public.dartiq_player_projections enable row level security;
alter table public.dartiq_projection_resolutions enable row level security;
alter table public.dartiq_projection_divergences enable row level security;
alter table public.dartiq_commentary_policy_decisions enable row level security;

revoke all on public.dartiq_model_versions from anon, authenticated;
revoke all on public.dartiq_population_evidence from anon, authenticated;
revoke all on public.dartiq_player_evidence from anon, authenticated;
revoke all on public.dartiq_projection_events from anon, authenticated;
revoke all on public.dartiq_player_projections from anon, authenticated;
revoke all on public.dartiq_projection_resolutions from anon, authenticated;
revoke all on public.dartiq_projection_divergences from anon, authenticated;
revoke all on public.dartiq_commentary_policy_decisions from anon, authenticated;

grant all on public.dartiq_model_versions to service_role;
grant all on public.dartiq_population_evidence to service_role;
grant all on public.dartiq_player_evidence to service_role;
grant all on public.dartiq_projection_events to service_role;
grant all on public.dartiq_player_projections to service_role;
grant all on public.dartiq_projection_resolutions to service_role;
grant all on public.dartiq_projection_divergences to service_role;
grant all on public.dartiq_commentary_policy_decisions to service_role;

revoke all on sequence public.dartiq_model_versions_id_seq from anon, authenticated;
revoke all on sequence public.dartiq_population_evidence_id_seq from anon, authenticated;
revoke all on sequence public.dartiq_player_evidence_id_seq from anon, authenticated;
revoke all on sequence public.dartiq_projection_events_id_seq from anon, authenticated;
revoke all on sequence public.dartiq_projection_resolutions_id_seq from anon, authenticated;
revoke all on sequence public.dartiq_commentary_policy_decisions_id_seq from anon, authenticated;

grant usage, select on sequence public.dartiq_model_versions_id_seq to service_role;
grant usage, select on sequence public.dartiq_population_evidence_id_seq to service_role;
grant usage, select on sequence public.dartiq_player_evidence_id_seq to service_role;
grant usage, select on sequence public.dartiq_projection_events_id_seq to service_role;
grant usage, select on sequence public.dartiq_projection_resolutions_id_seq to service_role;
grant usage, select on sequence public.dartiq_commentary_policy_decisions_id_seq to service_role;

comment on table public.dartiq_model_versions is
  'Immutable DartIQ implementation and configuration registry.';

comment on table public.dartiq_population_evidence is
  'Installation evidence frozen at match creation for leakage-free replay.';

comment on table public.dartiq_player_evidence is
  'Per-player raw evidence frozen at match creation before the match contributes history.';

comment on table public.dartiq_projection_events is
  'Append-only per-dart projection inputs, realized outcomes, provenance, and capture status.';

comment on column public.dartiq_projection_events.source_throw_id is
  'Immutable copied throw identity that survives correction or physical throw deletion.';

comment on table public.dartiq_player_projections is
  'Normalized full per-player probability vectors for calibration and replay diagnostics.';

comment on table public.dartiq_projection_resolutions is
  'Append-only authoritative leg and match outcomes attached after projection.';

comment on table public.dartiq_projection_divergences is
  'Server-only comparison of each active reconstructed projection against its live predecessor.';

comment on table public.dartiq_commentary_policy_decisions is
  'Versioned per-listener deterministic speak/skip decisions; does not measure provider or audio latency.';

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

revoke all on function public.create_x01_match_atomic(
  public.x01_start, public.finish_rule, integer, boolean, uuid[], uuid, uuid
) from public, anon, authenticated;
grant execute on function public.create_x01_match_atomic(
  public.x01_start, public.finish_rule, integer, boolean, uuid[], uuid, uuid
) to service_role;

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

-- Store one reconstructed leg revision atomically. The database owns both the
-- no-op decision and monotone revision number under a transaction-scoped lock.

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
security definer
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
    left join public.matches event_match
      on event_match.id = event_row.match_id
    left join public.legs event_leg
      on event_leg.id = event_row.leg_id
     and event_leg.match_id = event_row.match_id
    left join public.dartiq_model_versions event_model
      on event_model.id = event_row.model_version_id
    left join public.dartiq_population_evidence population_evidence
      on population_evidence.id = event_row.population_evidence_id
     and population_evidence.match_id = event_row.match_id
     and population_evidence.finish_rule = event_row.finish_rule
    left join public.match_players acting_participant
      on acting_participant.match_id = event_row.match_id
     and acting_participant.player_id = event_row.acting_player_id
    left join public.throws source_throw
      on source_throw.id = event_row.throw_id
    left join public.turns source_turn
      on source_turn.id = source_throw.turn_id
    where event_row.match_id is distinct from p_match_id
       or event_row.leg_id is distinct from p_leg_id
       or event_row.model_version_id is distinct from p_model_version_id
       or event_row.provenance is distinct from p_provenance
       or event_match.id is null
       or event_leg.id is null
       or event_model.id is null
       or population_evidence.id is null
       or event_model.evidence_schema_version
          is distinct from population_evidence.evidence_schema_version
       or event_row.finish_rule is distinct from event_match.finish::text
       or event_row.cohort is distinct from case
         when event_match.scolia_board_id is null then 'manual'
         else 'scolia'
       end
       or acting_participant.player_id is null
       or event_row.player_count is distinct from (
         select count(*)::integer
         from public.match_players participant
         where participant.match_id = event_row.match_id
       )
       or (
         event_row.throw_id is not null
         and (
           source_throw.id is null
           or source_throw.match_id is distinct from event_row.match_id
           or source_turn.leg_id is distinct from event_row.leg_id
           or source_turn.player_id is distinct from event_row.acting_player_id
           or event_row.source_throw_id is distinct from event_row.throw_id
         )
       )
  ) then
    raise exception using errcode = '22023', message = 'invalid_dartiq_projection_ownership';
  end if;

  if (
    select count(distinct event_row.source_throw_id)
    from jsonb_array_elements(p_events) as event_payload(value)
    cross join lateral jsonb_populate_record(
      null::public.dartiq_projection_events,
      event_payload.value
    ) event_row
  ) <> jsonb_array_length(p_events)
  or exists (
    with event_rows as (
      select event_row.*
      from jsonb_array_elements(p_events) as event_payload(value)
      cross join lateral jsonb_populate_record(
        null::public.dartiq_projection_events,
        event_payload.value
      ) event_row
    ),
    player_rows as (
      select
        (player_payload.value ->> 'source_throw_id')::uuid as source_throw_id,
        player_row.*
      from jsonb_array_elements(p_player_projections) as player_payload(value)
      cross join lateral jsonb_populate_record(
        null::public.dartiq_player_projections,
        player_payload.value - 'source_throw_id'
      ) player_row
    )
    select 1
    from player_rows player_row
    left join event_rows event_row
      on event_row.source_throw_id = player_row.source_throw_id
    left join public.match_players participant
      on participant.match_id = event_row.match_id
     and participant.player_id = player_row.player_id
    left join public.dartiq_player_evidence player_evidence
      on player_evidence.id = player_row.player_evidence_id
     and player_evidence.match_id = event_row.match_id
     and player_evidence.player_id = player_row.player_id
     and player_evidence.population_evidence_id = event_row.population_evidence_id
     and player_evidence.finish_rule = event_row.finish_rule
    where event_row.source_throw_id is null
       or participant.player_id is null
       or player_evidence.id is null
  )
  or exists (
    with event_rows as (
      select event_row.*
      from jsonb_array_elements(p_events) as event_payload(value)
      cross join lateral jsonb_populate_record(
        null::public.dartiq_projection_events,
        event_payload.value
      ) event_row
    ),
    player_rows as (
      select
        (player_payload.value ->> 'source_throw_id')::uuid as source_throw_id,
        player_row.player_id
      from jsonb_array_elements(p_player_projections) as player_payload(value)
      cross join lateral jsonb_populate_record(
        null::public.dartiq_player_projections,
        player_payload.value - 'source_throw_id'
      ) player_row
    )
    select 1
    from event_rows event_row
    left join player_rows player_row
      on player_row.source_throw_id = event_row.source_throw_id
    group by event_row.source_throw_id, event_row.player_count
    having count(player_row.player_id) <> event_row.player_count
       or count(distinct player_row.player_id) <> event_row.player_count
  ) then
    raise exception using errcode = '22023', message = 'invalid_dartiq_projection_participants';
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
      cohort,
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
      event_row.cohort,
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

drop function if exists public.replace_dartiq_projection_resolution(
  uuid, uuid, text, uuid, boolean, timestamptz
);

create function public.replace_dartiq_projection_resolution(
  p_match_id uuid,
  p_leg_id uuid,
  p_kind text,
  p_winner_player_id uuid,
  p_ended_early boolean,
  p_resolved_at timestamptz
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active public.dartiq_projection_resolutions%rowtype;
  v_resolution_id bigint;
begin
  if p_kind is null
     or p_kind not in ('leg', 'match')
     or p_ended_early is null
     or p_resolved_at is null
     or not exists (
       select 1
       from public.matches match_row
       where match_row.id = p_match_id
     )
     or (
       p_kind = 'leg'
       and (
         p_leg_id is null
         or not exists (
           select 1
           from public.legs leg
           where leg.id = p_leg_id
             and leg.match_id = p_match_id
         )
       )
     )
     or (p_kind = 'match' and p_leg_id is not null)
     or (
       p_winner_player_id is not null
       and not exists (
         select 1
         from public.match_players participant
         where participant.match_id = p_match_id
           and participant.player_id = p_winner_player_id
       )
     ) then
    raise exception using errcode = '22023', message = 'invalid_dartiq_projection_resolution';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_match_id::text || ':' || p_kind || ':'
        || coalesce(p_leg_id::text, 'match'),
      0
    )
  );

  select resolution.*
  into v_active
  from public.dartiq_projection_resolutions resolution
  where resolution.match_id = p_match_id
    and resolution.kind = p_kind
    and resolution.leg_id is not distinct from p_leg_id
    and resolution.superseded_at is null;

  if p_winner_player_id is null then
    update public.dartiq_projection_resolutions resolution
    set superseded_at = statement_timestamp()
    where resolution.id = v_active.id;

    return null;
  end if;

  if v_active.id is not null
     and v_active.winner_player_id is not distinct from p_winner_player_id
     and v_active.ended_early = p_ended_early then
    return v_active.id;
  end if;

  update public.dartiq_projection_resolutions resolution
  set superseded_at = statement_timestamp()
  where resolution.id = v_active.id;

  insert into public.dartiq_projection_resolutions (
    match_id,
    leg_id,
    kind,
    winner_player_id,
    ended_early,
    resolved_at
  ) values (
    p_match_id,
    p_leg_id,
    p_kind,
    p_winner_player_id,
    p_ended_early,
    p_resolved_at
  )
  returning id into v_resolution_id;

  return v_resolution_id;
end;
$$;

revoke all on function public.replace_dartiq_projection_resolution(
  uuid, uuid, text, uuid, boolean, timestamptz
) from public, anon, authenticated;
grant execute on function public.replace_dartiq_projection_resolution(
  uuid, uuid, text, uuid, boolean, timestamptz
) to service_role;

comment on function public.replace_dartiq_projection_resolution(
  uuid, uuid, text, uuid, boolean, timestamptz
) is 'Atomically preserves and supersedes corrected leg or match outcomes; a null winner removes the active resolution without a sentinel row.';

drop function if exists public.capture_dartiq_live_projection_event(jsonb, jsonb);

create function public.capture_dartiq_live_projection_event(
  p_event jsonb,
  p_player_projections jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.dartiq_projection_events%rowtype;
  v_active_id bigint;
  v_active_revision integer;
  v_active_revision_hash text;
  v_active_pre_state_hash text;
  v_projection_event_id bigint;
  v_player_count integer;
  v_revision integer;
begin
  if jsonb_typeof(p_event) <> 'object'
     or jsonb_typeof(p_player_projections) <> 'array'
     or jsonb_array_length(p_player_projections) = 0 then
    raise exception using errcode = '22023', message = 'invalid_dartiq_live_projection';
  end if;

  select *
  into v_event
  from jsonb_populate_record(
    null::public.dartiq_projection_events,
    p_event
  );

  if v_event.provenance is distinct from 'live'
     or v_event.live_capture_status is distinct from 'complete'
     or v_event.live_capture_cause is not null
     or v_event.match_id is null
     or v_event.leg_id is null
     or v_event.source_throw_id is null
     or v_event.model_version_id is null
     or nullif(v_event.revision_hash, '') is null
     or nullif(v_event.pre_state_hash, '') is null
     or v_event.player_count is distinct from jsonb_array_length(p_player_projections) then
    raise exception using errcode = '22023', message = 'invalid_dartiq_live_projection';
  end if;

  if not exists (
    select 1
    from public.matches event_match
    join public.legs event_leg
      on event_leg.id = v_event.leg_id
     and event_leg.match_id = event_match.id
    join public.dartiq_model_versions event_model
      on event_model.id = v_event.model_version_id
    join public.dartiq_population_evidence population_evidence
      on population_evidence.id = v_event.population_evidence_id
     and population_evidence.match_id = event_match.id
     and population_evidence.finish_rule = v_event.finish_rule
     and population_evidence.evidence_schema_version = event_model.evidence_schema_version
    join public.match_players acting_participant
      on acting_participant.match_id = event_match.id
     and acting_participant.player_id = v_event.acting_player_id
    where event_match.id = v_event.match_id
      and event_match.finish::text = v_event.finish_rule
      and v_event.cohort = case
        when event_match.scolia_board_id is null then 'manual'
        else 'scolia'
      end
      and v_event.player_count = (
        select count(*)::integer
        from public.match_players participant
        where participant.match_id = event_match.id
      )
  )
  or (
    v_event.throw_id is not null
    and not exists (
      select 1
      from public.throws source_throw
      join public.turns source_turn
        on source_turn.id = source_throw.turn_id
      where source_throw.id = v_event.throw_id
        and source_throw.match_id = v_event.match_id
        and source_turn.leg_id = v_event.leg_id
        and source_turn.player_id = v_event.acting_player_id
        and v_event.source_throw_id = v_event.throw_id
    )
  )
  or (
    select count(distinct player_row.player_id)
    from jsonb_array_elements(p_player_projections) as player_payload(value)
    cross join lateral jsonb_populate_record(
      null::public.dartiq_player_projections,
      player_payload.value - 'projection_event_id'
    ) player_row
  ) <> v_event.player_count
  or exists (
    select 1
    from jsonb_array_elements(p_player_projections) as player_payload(value)
    cross join lateral jsonb_populate_record(
      null::public.dartiq_player_projections,
      player_payload.value - 'projection_event_id'
    ) player_row
    left join public.match_players participant
      on participant.match_id = v_event.match_id
     and participant.player_id = player_row.player_id
    left join public.dartiq_player_evidence player_evidence
      on player_evidence.id = player_row.player_evidence_id
     and player_evidence.match_id = v_event.match_id
     and player_evidence.player_id = player_row.player_id
     and player_evidence.population_evidence_id = v_event.population_evidence_id
     and player_evidence.finish_rule = v_event.finish_rule
    where participant.player_id is null
       or player_evidence.id is null
  ) then
    raise exception using errcode = '22023', message = 'invalid_dartiq_live_projection_ownership';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      v_event.match_id::text || ':' || v_event.source_throw_id::text || ':'
        || v_event.model_version_id::text || ':live',
      0
    )
  );

  select
    existing.id,
    existing.revision,
    existing.revision_hash,
    existing.pre_state_hash
  into
    v_active_id,
    v_active_revision,
    v_active_revision_hash,
    v_active_pre_state_hash
  from public.dartiq_projection_events existing
  where existing.match_id = v_event.match_id
    and existing.source_throw_id = v_event.source_throw_id
    and existing.model_version_id = v_event.model_version_id
    and existing.provenance = 'live'
    and existing.superseded_at is null;

  if v_active_id is not null
     and v_active_revision_hash = v_event.revision_hash
     and v_active_pre_state_hash = v_event.pre_state_hash then
    return v_active_id;
  end if;

  if v_active_id is not null
     and v_active_revision_hash = v_event.revision_hash
     and v_active_pre_state_hash is distinct from v_event.pre_state_hash then
    raise exception using
      errcode = '22023',
      message = 'conflicting_dartiq_live_revision_hash';
  end if;

  select coalesce(max(existing.revision), -1) + 1
  into v_revision
  from public.dartiq_projection_events existing
  where existing.match_id = v_event.match_id
    and existing.source_throw_id = v_event.source_throw_id
    and existing.model_version_id = v_event.model_version_id
    and existing.provenance = 'live';

  update public.dartiq_projection_events existing
  set superseded_at = statement_timestamp()
  where existing.id = v_active_id;

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
    cohort,
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
  ) values (
    v_event.schema_version,
    v_event.match_id,
    v_event.leg_id,
    v_event.throw_id,
    v_event.source_throw_id,
    v_event.model_version_id,
    v_event.population_evidence_id,
    v_event.acting_player_id,
    'live',
    'complete',
    null,
    v_revision,
    v_event.revision_hash,
    v_event.sequence,
    v_event.pre_state_hash,
    v_event.input_snapshot,
    v_event.finish_rule,
    v_event.cohort,
    v_event.player_count,
    v_event.score_before,
    v_event.score_band,
    v_event.checkout_state,
    v_event.confidence_tier,
    v_event.outcome_model_applicable,
    v_event.approximation_modes,
    v_event.actual_score_delta,
    v_event.actual_is_double,
    v_event.busted,
    v_event.actual_outcome,
    v_event.computed_at
  )
  returning id into v_projection_event_id;

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
    v_projection_event_id,
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
    player_payload.value - 'projection_event_id'
  ) player_row;

  get diagnostics v_player_count = row_count;
  if v_player_count <> v_event.player_count then
    raise exception using errcode = '22023', message = 'incomplete_dartiq_player_projections';
  end if;

  return v_projection_event_id;
end;
$$;

revoke all on function public.capture_dartiq_live_projection_event(jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.capture_dartiq_live_projection_event(jsonb, jsonb)
  to service_role;

comment on function public.capture_dartiq_live_projection_event(jsonb, jsonb) is
  'Atomically captures one live projection and its full player vector, preserving corrected revisions.';

drop function if exists public.refresh_dartiq_projection_divergences(uuid, uuid, bigint);

create function public.refresh_dartiq_projection_divergences(
  p_match_id uuid,
  p_leg_id uuid,
  p_model_version_id bigint
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(
      p_match_id::text || ':' || p_leg_id::text || ':'
        || p_model_version_id::text || ':reconstructed',
      0
    )
  );

  delete from public.dartiq_projection_divergences divergence
  where divergence.match_id = p_match_id
    and divergence.leg_id = p_leg_id
    and divergence.model_version_id = p_model_version_id;

  insert into public.dartiq_projection_divergences (
    reconstructed_projection_event_id,
    match_id,
    leg_id,
    source_throw_id,
    model_version_id,
    live_projection_event_id,
    status,
    pre_state_matches,
    max_leg_probability_delta,
    max_match_probability_delta,
    detected_at
  )
  select
    reconstructed.id,
    reconstructed.match_id,
    reconstructed.leg_id,
    reconstructed.source_throw_id,
    reconstructed.model_version_id,
    live.id,
    case
      when live.id is null then 'missing_live'
      when reconstructed.pre_state_hash = live.pre_state_hash
        and vector_comparison.reconstructed_count = vector_comparison.matched_count
        and vector_comparison.reconstructed_count = vector_comparison.live_count
        and coalesce(vector_comparison.max_leg_delta, 0) <= 1e-12
        and coalesce(vector_comparison.max_match_delta, 0) <= 1e-12
        then 'exact'
      else 'diverged'
    end,
    case
      when live.id is null then null
      else reconstructed.pre_state_hash = live.pre_state_hash
    end,
    case when live.id is null then null else vector_comparison.max_leg_delta end,
    case when live.id is null then null else vector_comparison.max_match_delta end,
    statement_timestamp()
  from public.dartiq_projection_events reconstructed
  left join public.dartiq_projection_events live
    on live.match_id = reconstructed.match_id
   and live.source_throw_id = reconstructed.source_throw_id
   and live.model_version_id = reconstructed.model_version_id
   and live.provenance = 'live'
   and live.live_capture_status = 'complete'
   and live.superseded_at is null
  left join lateral (
    select
      count(reconstructed_player.player_id)::integer as reconstructed_count,
      count(live_player.player_id)::integer as matched_count,
      (
        select count(*)::integer
        from public.dartiq_player_projections all_live_players
        where all_live_players.projection_event_id = live.id
      ) as live_count,
      max(abs(
        greatest(
          abs(
            reconstructed_player.leg_probability_before
              - live_player.leg_probability_before
          ),
          abs(
            reconstructed_player.leg_probability_after
              - live_player.leg_probability_after
          )
        )
      )) as max_leg_delta,
      max(abs(
        greatest(
          abs(
            reconstructed_player.match_probability_before
              - live_player.match_probability_before
          ),
          abs(
            reconstructed_player.match_probability_after
              - live_player.match_probability_after
          )
        )
      )) as max_match_delta
    from public.dartiq_player_projections reconstructed_player
    left join public.dartiq_player_projections live_player
      on live_player.projection_event_id = live.id
     and live_player.player_id = reconstructed_player.player_id
    where reconstructed_player.projection_event_id = reconstructed.id
  ) vector_comparison on true
  where reconstructed.match_id = p_match_id
    and reconstructed.leg_id = p_leg_id
    and reconstructed.model_version_id = p_model_version_id
    and reconstructed.provenance = 'reconstructed'
    and reconstructed.superseded_at is null;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke all on function public.refresh_dartiq_projection_divergences(uuid, uuid, bigint)
  from public, anon, authenticated;
grant execute on function public.refresh_dartiq_projection_divergences(uuid, uuid, bigint)
  to service_role;

comment on function public.refresh_dartiq_projection_divergences(uuid, uuid, bigint) is
  'Rebuilds live-versus-reconstructed parity evidence for one leg and model.';
