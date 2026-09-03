-- Frozen Pressure Engine evidence and append-only projection telemetry.
-- These tables are server-only. Browser roles receive no RLS policy.

create table public.pressure_model_versions (
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

create table public.pressure_population_evidence (
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

create index pressure_population_evidence_content_hash_idx
  on public.pressure_population_evidence (content_hash);

create table public.pressure_player_evidence (
  id bigint generated always as identity primary key,
  match_id uuid not null references public.matches(id) on delete cascade,
  player_id uuid not null references public.players(id),
  population_evidence_id bigint not null
    references public.pressure_population_evidence(id) on delete cascade,
  finish_rule text not null check (finish_rule in ('single_out', 'double_out')),
  historical_cutoff_at timestamptz not null,
  evidence_schema_version integer not null check (evidence_schema_version > 0),
  raw_evidence jsonb not null,
  content_hash text not null,
  created_at timestamptz not null default now(),
  unique (match_id, player_id, finish_rule)
);

create index pressure_player_evidence_player_idx
  on public.pressure_player_evidence (player_id);

create index pressure_player_evidence_population_idx
  on public.pressure_player_evidence (population_evidence_id);

create index pressure_player_evidence_content_hash_idx
  on public.pressure_player_evidence (content_hash);

create table public.pressure_projection_events (
  id bigint generated always as identity primary key,
  schema_version integer not null check (schema_version > 0),
  match_id uuid not null references public.matches(id) on delete cascade,
  leg_id uuid not null references public.legs(id) on delete cascade,
  throw_id uuid references public.throws(id) on delete set null,
  source_throw_id uuid not null,
  model_version_id bigint not null references public.pressure_model_versions(id),
  population_evidence_id bigint not null
    references public.pressure_population_evidence(id) on delete cascade,
  acting_player_id uuid not null references public.players(id),
  provenance text not null check (provenance in ('live', 'reconstructed')),
  live_capture_status text not null
    check (live_capture_status in ('complete', 'partial', 'not_supported')),
  live_capture_cause text,
  epoch bigint not null default 0 check (epoch >= 0),
  revision integer not null default 0 check (revision >= 0),
  sequence integer not null check (sequence > 0),
  pre_state_hash text not null,
  input_snapshot jsonb not null,
  finish_rule text not null check (finish_rule in ('single_out', 'double_out')),
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

create unique index pressure_projection_events_active_key
  on public.pressure_projection_events (
    match_id,
    source_throw_id,
    model_version_id,
    provenance
  )
  where superseded_at is null;

create index pressure_projection_events_match_sequence_idx
  on public.pressure_projection_events (match_id, sequence);

create unique index pressure_projection_events_active_sequence_key
  on public.pressure_projection_events (match_id, sequence, model_version_id, provenance)
  where superseded_at is null;

create index pressure_projection_events_leg_idx
  on public.pressure_projection_events (leg_id);

create index pressure_projection_events_throw_idx
  on public.pressure_projection_events (throw_id)
  where throw_id is not null;

create index pressure_projection_events_model_time_idx
  on public.pressure_projection_events (model_version_id, created_at);

create index pressure_projection_events_population_idx
  on public.pressure_projection_events (population_evidence_id);

create index pressure_projection_events_acting_player_idx
  on public.pressure_projection_events (acting_player_id);

create table public.pressure_player_projections (
  projection_event_id bigint not null
    references public.pressure_projection_events(id) on delete cascade,
  player_id uuid not null references public.players(id),
  player_evidence_id bigint not null
    references public.pressure_player_evidence(id) on delete cascade,
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

create index pressure_player_projections_player_idx
  on public.pressure_player_projections (player_id);

create index pressure_player_projections_evidence_idx
  on public.pressure_player_projections (player_evidence_id);

create table public.pressure_projection_resolutions (
  id bigint generated always as identity primary key,
  match_id uuid not null references public.matches(id) on delete cascade,
  leg_id uuid references public.legs(id) on delete cascade,
  kind text not null check (kind in ('leg', 'match')),
  winner_player_id uuid references public.players(id),
  resolution_epoch bigint not null default 0 check (resolution_epoch >= 0),
  ended_early boolean not null default false,
  resolved_at timestamptz not null,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  check (
    (kind = 'leg' and leg_id is not null)
    or (kind = 'match' and leg_id is null)
  )
);

create unique index pressure_projection_resolutions_active_leg_key
  on public.pressure_projection_resolutions (match_id, leg_id)
  where kind = 'leg' and superseded_at is null;

create unique index pressure_projection_resolutions_active_match_key
  on public.pressure_projection_resolutions (match_id)
  where kind = 'match' and superseded_at is null;

create index pressure_projection_resolutions_leg_idx
  on public.pressure_projection_resolutions (leg_id)
  where leg_id is not null;

create index pressure_projection_resolutions_winner_idx
  on public.pressure_projection_resolutions (winner_player_id)
  where winner_player_id is not null;

alter table public.pressure_model_versions enable row level security;
alter table public.pressure_population_evidence enable row level security;
alter table public.pressure_player_evidence enable row level security;
alter table public.pressure_projection_events enable row level security;
alter table public.pressure_player_projections enable row level security;
alter table public.pressure_projection_resolutions enable row level security;

revoke all on public.pressure_model_versions from anon, authenticated;
revoke all on public.pressure_population_evidence from anon, authenticated;
revoke all on public.pressure_player_evidence from anon, authenticated;
revoke all on public.pressure_projection_events from anon, authenticated;
revoke all on public.pressure_player_projections from anon, authenticated;
revoke all on public.pressure_projection_resolutions from anon, authenticated;

grant all on public.pressure_model_versions to service_role;
grant all on public.pressure_population_evidence to service_role;
grant all on public.pressure_player_evidence to service_role;
grant all on public.pressure_projection_events to service_role;
grant all on public.pressure_player_projections to service_role;
grant all on public.pressure_projection_resolutions to service_role;

revoke all on sequence public.pressure_model_versions_id_seq from anon, authenticated;
revoke all on sequence public.pressure_population_evidence_id_seq from anon, authenticated;
revoke all on sequence public.pressure_player_evidence_id_seq from anon, authenticated;
revoke all on sequence public.pressure_projection_events_id_seq from anon, authenticated;
revoke all on sequence public.pressure_projection_resolutions_id_seq from anon, authenticated;

grant usage, select on sequence public.pressure_model_versions_id_seq to service_role;
grant usage, select on sequence public.pressure_population_evidence_id_seq to service_role;
grant usage, select on sequence public.pressure_player_evidence_id_seq to service_role;
grant usage, select on sequence public.pressure_projection_events_id_seq to service_role;
grant usage, select on sequence public.pressure_projection_resolutions_id_seq to service_role;

comment on table public.pressure_model_versions is
  'Immutable Pressure Engine implementation and configuration registry.';

comment on table public.pressure_population_evidence is
  'Installation evidence frozen at match creation for leakage-free replay.';

comment on table public.pressure_player_evidence is
  'Per-player raw evidence frozen at match creation before the match contributes history.';

comment on table public.pressure_projection_events is
  'Append-only per-dart projection inputs, realized outcomes, provenance, and capture status.';

comment on column public.pressure_projection_events.source_throw_id is
  'Immutable copied throw identity that survives correction or physical throw deletion.';

comment on table public.pressure_player_projections is
  'Normalized full per-player probability vectors for calibration and replay diagnostics.';

comment on table public.pressure_projection_resolutions is
  'Append-only authoritative leg and match outcomes attached after projection.';
