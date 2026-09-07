-- Observation-only calibration. No model-selection or promotion write path.
create table public.dartiq_calibration_reports (
  id bigint generated always as identity primary key,
  model_version_id bigint not null references public.dartiq_model_versions(id) on delete cascade,
  evaluator_version text not null,
  source_fingerprint text not null,
  window_end timestamptz not null,
  sampled_event_ids text[] not null,
  report jsonb not null check (jsonb_typeof(report) = 'object' and report @> '{"promotionEnabled":false}'::jsonb),
  created_at timestamptz not null default now(),
  unique(model_version_id, evaluator_version, source_fingerprint)
);
create index dartiq_calibration_reports_model_window_idx
  on public.dartiq_calibration_reports(model_version_id, window_end desc);
alter table public.dartiq_calibration_reports enable row level security;
revoke all on public.dartiq_calibration_reports from public, anon, authenticated, service_role;
grant select, insert on public.dartiq_calibration_reports to service_role;
revoke all on sequence public.dartiq_calibration_reports_id_seq from public, anon, authenticated;
grant usage, select on sequence public.dartiq_calibration_reports_id_seq to service_role;

create index matches_calibration_completed_idx on public.matches(completed_at desc, id)
  where completed_at is not null and winner_player_id is not null and not ended_early;

-- One consistent read, bounded to 200 recent matches and 40 deterministic samples
-- per match. Only vectors actually recorded before the match ended qualify.
create function public.load_dartiq_calibration_window(p_model_version_id bigint, p_window_end timestamptz, p_evaluator_version text default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with recent_matches as materialized (
    select m.id, m.created_at, m.completed_at, m.winner_player_id
    from public.matches m
    where m.completed_at < p_window_end and m.completed_at >= p_window_end - interval '90 days'
      and m.winner_player_id is not null and not m.ended_early
      and not exists (select 1 from public.match_players mp join public.players p on p.id = mp.player_id
        where mp.match_id = m.id and p.is_test)
      and exists (select 1 from public.dartiq_projection_events e
        where e.match_id = m.id and e.model_version_id = p_model_version_id
          and e.provenance = 'live' and e.live_capture_status = 'complete'
          and e.superseded_at is null and e.computed_at < m.completed_at)
    order by m.completed_at desc, m.id limit 200
  ), sampled as materialized (
    select m.id as match_id, m.created_at as match_created_at, m.completed_at, m.winner_player_id, e.*
    from recent_matches m cross join lateral (
      select pe.id as event_id, pe.computed_at, pe.population_evidence_id, pe.throw_id,
        pe.finish_rule, pe.player_count, pe.score_band, pe.checkout_state, pe.confidence_tier,
        pe.cohort, pe.approximation_modes
      from public.dartiq_projection_events pe
      where pe.match_id = m.id and pe.model_version_id = p_model_version_id
        and pe.provenance = 'live' and pe.live_capture_status = 'complete'
        and pe.superseded_at is null and pe.computed_at >= m.created_at and pe.computed_at < m.completed_at
      order by md5(pe.id::text), pe.id limit 40
    ) e
  )
  select jsonb_build_object(
    'modelVersionId', p_model_version_id::text,
    -- Freeze the first qualifying artifact, never chase whichever later candidate
    -- wins on the same follow-up matches. Reports are append-only for service_role.
    'candidate', (select jsonb_build_object(
      'reportId', r.id::text, 'frozenAt', r.created_at,
      'family', 'temperature_scaling', 'temperature', r.report->'temperature',
      'sourceFingerprint', r.source_fingerprint)
      from public.dartiq_calibration_reports r
      where r.model_version_id = p_model_version_id and r.evaluator_version = p_evaluator_version
        and r.report->>'recommendation' = 'recommend_for_review'
        and r.report->>'candidateFamily' = 'temperature_scaling'
        and r.report->'temperature' <> '1'::jsonb
      order by r.id limit 1),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
      'id', s.event_id::text, 'matchId', s.match_id::text,
      'matchCreatedAt', s.match_created_at, 'completedAt', s.completed_at,
      'recordedAt', s.computed_at, 'evidenceCutoff', evidence.historical_cutoff_at,
      'winnerPlayerId', s.winner_player_id::text, 'probabilities', vector.probabilities,
      'geometryAvailable', d.impact_x_mm is not null and d.impact_y_mm is not null,
      'approximationModes', s.approximation_modes,
      'slices', jsonb_build_object('finishRule', s.finish_rule, 'playerCount', s.player_count,
        'scoreBand', s.score_band, 'checkoutState', s.checkout_state,
        'actorConfidenceTier', s.confidence_tier, 'cohort', s.cohort)
    ) order by s.completed_at, s.match_id, s.event_id)
    from sampled s join public.dartiq_population_evidence evidence on evidence.id = s.population_evidence_id
    left join public.throws d on d.id = s.throw_id
    cross join lateral (
      select jsonb_object_agg(p.player_id::text, p.match_probability_after) as probabilities,
        count(*) as player_count, sum(p.match_probability_after) as total
      from public.dartiq_player_projections p where p.projection_event_id = s.event_id
    ) vector
    where evidence.historical_cutoff_at <= s.match_created_at
      and evidence.historical_cutoff_at < s.computed_at
      and vector.player_count = s.player_count and s.player_count >= 2
      and abs(vector.total - 1) < 0.000001
      and vector.probabilities ? s.winner_player_id::text), '[]'::jsonb)
  );
$$;
revoke all on function public.load_dartiq_calibration_window(bigint,timestamptz,text) from public, anon, authenticated;
grant execute on function public.load_dartiq_calibration_window(bigint,timestamptz,text) to service_role;

create function public.enqueue_dartiq_calibration_jobs() returns integer
language plpgsql security definer set search_path = '' as $$
declare queued integer;
begin
  insert into public.background_jobs(job_type, payload, run_at, deduplication_key)
  select 'dartiq_calibration',
    jsonb_build_object('modelVersionId', model.id::text, 'windowEnd', date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'),
    now(), 'dartiq_calibration:' || model.id::text || ':' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD')
  from (
    select mv.id from public.dartiq_model_versions mv
    where exists (select 1 from public.dartiq_projection_events e
      where e.model_version_id = mv.id and e.created_at >= now() - interval '90 days'
        and e.provenance = 'live' and e.live_capture_status = 'complete')
      or exists (select 1 from public.dartiq_calibration_reports r
        where r.model_version_id = mv.id and r.window_end >= now() - interval '90 days')
    order by mv.id desc limit 4
  ) model
  on conflict (deduplication_key) do nothing;
  get diagnostics queued = row_count;
  return queued;
end;
$$;
revoke all on function public.enqueue_dartiq_calibration_jobs() from public, anon, authenticated;
grant execute on function public.enqueue_dartiq_calibration_jobs() to service_role;

select cron.schedule('dartiq-calibration-daily', '17 2 * * *', 'select public.enqueue_dartiq_calibration_jobs();');
