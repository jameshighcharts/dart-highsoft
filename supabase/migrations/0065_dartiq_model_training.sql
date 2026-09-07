-- Immutable fitted payloads; only the daily service handler can advance the registry.
create table public.dartiq_trained_artifacts (
  id uuid primary key default gen_random_uuid(),
  version text not null,
  source_hash text not null,
  artifact jsonb not null check (jsonb_typeof(artifact) = 'object'),
  geometry_contexts text[] not null default '{}',
  status text not null check (status in ('pending','active','retired','rejected')),
  validation jsonb,
  created_at timestamptz not null default clock_timestamp(),
  activated_at timestamptz,
  previous_id uuid references public.dartiq_trained_artifacts(id),
  unique(version, source_hash)
);
create table public.dartiq_training_registry (
  singleton boolean primary key default true check(singleton),
  generation bigint not null default 0,
  active_id uuid references public.dartiq_trained_artifacts(id),
  pending_id uuid references public.dartiq_trained_artifacts(id)
);
insert into public.dartiq_training_registry(singleton) values(true);
alter table public.dartiq_trained_artifacts enable row level security;
alter table public.dartiq_training_registry enable row level security;
revoke all on public.dartiq_trained_artifacts, public.dartiq_training_registry from public, anon, authenticated, service_role;
grant select on public.dartiq_trained_artifacts, public.dartiq_training_registry to service_role;

create function public.load_dartiq_training_window(p_window_end timestamptz)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with recent as materialized (
    select m.* from public.matches m
    where m.completed_at < p_window_end and m.completed_at >= p_window_end - interval '180 days'
      and m.winner_player_id is not null and not m.ended_early
      and not exists(select 1 from public.match_players mp join public.players p on p.id = mp.player_id
        where mp.match_id = m.id and p.is_test)
    order by m.completed_at desc,m.id limit 400
  ), visits as materialized (
    select t.id,t.player_id,t.leg_id,t.turn_number,m.id as match_id,m.created_at,m.completed_at,m.finish,
      m.start_score::text::int - coalesce(sum(case when t.busted then 0 else t.total_scored end)
        over(partition by t.leg_id,t.player_id order by t.turn_number rows between unbounded preceding and 1 preceding),0)::int as visit_start
    from recent m join public.legs l on l.match_id = m.id join public.turns t on t.leg_id = l.id
    where t.tiebreak_round is null
  ), darts as materialized (
    select d.id,v.player_id,v.match_id,v.created_at,v.completed_at,v.finish,d.segment,d.impact_x_mm,d.impact_y_mm,
      4-d.dart_index as darts_left,
      v.visit_start - coalesce(sum(d.scored) over(partition by d.turn_id order by d.dart_index rows between unbounded preceding and 1 preceding),0)::int as current_score
    from visits v join public.throws d on d.turn_id = v.id
  ), sampled as (
    select d.*, row_number() over(partition by d.match_id order by md5(d.id::text),d.id) as sample_index
    from darts d where d.current_score > 0 and d.darts_left between 1 and 3
  )
  select jsonb_build_object(
    'generation', r.generation::text,
    'active', (select to_jsonb(a) from public.dartiq_trained_artifacts a where a.id = r.active_id),
    'previous', (select to_jsonb(a) from public.dartiq_trained_artifacts a
      where a.id = (select active.previous_id from public.dartiq_trained_artifacts active where active.id = r.active_id)),
    'pending', (select to_jsonb(a) from public.dartiq_trained_artifacts a where a.id = r.pending_id),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
      'id',d.id,'matchId',d.match_id,'playerId',d.player_id,'matchCreatedAt',d.created_at,'completedAt',d.completed_at,
      'finishRule',d.finish,'currentScore',d.current_score,'dartsLeft',d.darts_left,
      'segment',d.segment,'x',d.impact_x_mm,'y',d.impact_y_mm
    ) order by d.completed_at,d.match_id,d.id) from sampled d where d.sample_index <= 60),'[]'::jsonb)
  ) from public.dartiq_training_registry r where r.singleton;
$$;

-- Compare-and-swap prevents concurrent/stale daily jobs from replacing registry state.
create function public.commit_dartiq_training(p_generation bigint,p_version text,p_source_hash text,
  p_artifact jsonb default null,p_validation jsonb default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare r public.dartiq_training_registry; pending public.dartiq_trained_artifacts; next_id uuid;
begin
  select * into strict r from public.dartiq_training_registry where singleton for update;
  if r.generation <> p_generation then return false; end if;
  if p_validation->'rollback' = 'true'::jsonb then
    if coalesce((p_validation#>>'{baseline,matches}')::int,0) < 30
      or coalesce((p_validation#>>'{baseline,count}')::int,0) < 500 then raise exception 'Insufficient rollback evidence'; end if;
    update public.dartiq_trained_artifacts set status = 'retired', validation = p_validation where id = r.active_id;
    update public.dartiq_trained_artifacts set status = 'rejected' where id = r.pending_id;
    update public.dartiq_training_registry set active_id = null,pending_id = null,generation = generation+1 where singleton;
    return true;
  end if;
  if r.pending_id is not null then
    select * into strict pending from public.dartiq_trained_artifacts where id = r.pending_id;
    if p_validation is null then return false; end if;
    if pending.version <> p_version then
      update public.dartiq_trained_artifacts set status = 'rejected' where id = pending.id;
      update public.dartiq_training_registry set pending_id = null,generation = generation+1 where singleton;
      return true;
    end if;
    update public.dartiq_trained_artifacts set validation = p_validation where id = pending.id;
    if p_validation->'eligible' = 'true'::jsonb then
      if coalesce((p_validation#>>'{baseline,matches}')::int,0) < 30
        or coalesce((p_validation#>>'{baseline,count}')::int,0) < 500 then raise exception 'Insufficient activation evidence'; end if;
      update public.dartiq_trained_artifacts set status = 'retired' where id = r.active_id;
      update public.dartiq_trained_artifacts set status = 'active',activated_at = clock_timestamp(),
        geometry_contexts = array(select jsonb_array_elements_text(p_validation->'geometryContexts')) where id = pending.id;
      update public.dartiq_training_registry set active_id = pending.id,pending_id = null,generation = generation+1 where singleton;
    elsif pending.created_at < now() - interval '90 days' then
      update public.dartiq_trained_artifacts set status = 'rejected' where id = pending.id;
      update public.dartiq_training_registry set pending_id = null,generation = generation+1 where singleton;
    else
      update public.dartiq_training_registry set generation = generation+1 where singleton;
    end if;
  elsif p_artifact is not null then
    if p_artifact->>'version' is distinct from p_version or p_artifact->>'trainedThrough' is null
      or (p_artifact->>'trainedThrough')::timestamptz >= clock_timestamp()
      or coalesce((p_artifact->>'matchCount')::int,0) < 30 or coalesce((p_artifact->>'dartCount')::int,0) < 500
      or octet_length(p_artifact::text) > 8000000 then raise exception 'Invalid trained artifact'; end if;
    insert into public.dartiq_trained_artifacts(version,source_hash,artifact,status,previous_id)
      values(p_version,p_source_hash,p_artifact,'pending',r.active_id) on conflict(version,source_hash) do nothing returning id into next_id;
    if next_id is null then return false; end if;
    update public.dartiq_training_registry set pending_id = next_id,generation = generation+1 where singleton;
  else return false;
  end if;
  return true;
end;
$$;

-- Evidence is inserted atomically during match creation. Older/backfilled matches
-- must never inherit a model activated after their creation time.
create function public.pin_dartiq_trained_artifact() returns trigger
language plpgsql security definer set search_path = '' as $$
declare deployment jsonb;
begin
  select jsonb_build_object('id',a.id,'artifact',a.artifact,'geometryContexts',a.geometry_contexts) into deployment
  from public.dartiq_training_registry r join public.dartiq_trained_artifacts a on a.id = r.active_id
  join public.matches m on m.id = new.match_id
  where r.singleton and a.status = 'active' and a.activated_at <= m.created_at;
  if deployment is not null then
    deployment := jsonb_set(deployment,'{artifact,players}',coalesce((select jsonb_object_agg(p.key,p.value)
      from jsonb_each(deployment#>'{artifact,players}') p
      where exists(select 1 from public.match_players mp where mp.match_id = new.match_id and mp.player_id::text = p.key)),'{}'::jsonb));
    deployment := jsonb_set(deployment,'{artifact,geometry}',coalesce((select jsonb_object_agg(p.key,p.value)
      from jsonb_each(deployment#>'{artifact,geometry}') p
      where exists(select 1 from public.match_players mp where mp.match_id = new.match_id and mp.player_id::text = split_part(p.key,':',1))),'{}'::jsonb));
    deployment := jsonb_set(deployment,'{geometryContexts}',coalesce((select jsonb_agg(context_key)
      from jsonb_array_elements_text(deployment->'geometryContexts') context_key
      where exists(select 1 from public.match_players mp where mp.match_id = new.match_id
        and mp.player_id::text = split_part(context_key,':',1))),'[]'::jsonb));
    new.raw_evidence := new.raw_evidence || jsonb_build_object('modelDeployment',deployment);
    new.content_hash := md5(new.raw_evidence::text);
  end if;
  return new;
end;
$$;
create trigger pin_dartiq_trained_artifact before insert on public.dartiq_population_evidence
for each row execute function public.pin_dartiq_trained_artifact();

create function public.enqueue_dartiq_training_job() returns void
language sql security definer set search_path = '' as $$
  insert into public.background_jobs(job_type,payload,deduplication_key,run_at)
  values('dartiq_training',jsonb_build_object('windowEnd',date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'),
    'dartiq_training:' || to_char(now() at time zone 'UTC','YYYY-MM-DD'),now()) on conflict(deduplication_key) do nothing;
$$;
revoke all on function public.load_dartiq_training_window(timestamptz),public.commit_dartiq_training(bigint,text,text,jsonb,jsonb),
  public.pin_dartiq_trained_artifact(),public.enqueue_dartiq_training_job() from public,anon,authenticated;
grant execute on function public.load_dartiq_training_window(timestamptz),public.commit_dartiq_training(bigint,text,text,jsonb,jsonb),
  public.enqueue_dartiq_training_job() to service_role;
select cron.schedule('dartiq-training-daily','27 2 * * *','select public.enqueue_dartiq_training_job();');
