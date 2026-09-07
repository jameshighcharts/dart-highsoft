-- Service-only, statement-consistent snapshots. No client grants or RLS bypass.
create sequence public.dartiq_source_revision_seq;
revoke all on sequence public.dartiq_source_revision_seq from public, anon, authenticated;
create table public.dartiq_source_revisions (
  match_id uuid primary key references public.matches(id) on delete cascade,
  revision bigint not null default 1
);
alter table public.dartiq_source_revisions enable row level security;
revoke all on public.dartiq_source_revisions from public, anon, authenticated;
grant select, insert, update, delete on public.dartiq_source_revisions to service_role;

create function public.bump_dartiq_source_revision() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  row_data jsonb;
  match_ids uuid[] := '{}';
  source_match uuid;
begin
  -- Both sides matter when a row is reparented; parent triggers cover cascades.
  for row_data in select value from jsonb_array_elements(
    case when TG_OP = 'INSERT' then jsonb_build_array(to_jsonb(NEW))
         when TG_OP = 'DELETE' then jsonb_build_array(to_jsonb(OLD))
         else jsonb_build_array(to_jsonb(OLD), to_jsonb(NEW)) end
  ) loop
    source_match := null;
    if TG_TABLE_NAME = 'matches' then
      source_match := (row_data->>'id')::uuid;
    elsif TG_TABLE_NAME = 'turns' then
      select match_id into source_match from public.legs where id = (row_data->>'leg_id')::uuid;
    elsif TG_TABLE_NAME = 'throws' then
      select l.match_id into source_match from public.turns t
      join public.legs l on l.id = t.leg_id where t.id = (row_data->>'turn_id')::uuid;
    else
      source_match := (row_data->>'match_id')::uuid;
    end if;
    match_ids := array_append(match_ids, source_match);
  end loop;
  for source_match in select distinct id from unnest(match_ids) id where id is not null order by id loop
    insert into public.dartiq_source_revisions(match_id, revision)
    select id, nextval('public.dartiq_source_revision_seq') from public.matches where id = source_match
    on conflict (match_id) do update set revision = excluded.revision;
  end loop;
  return null;
end;
$$;
revoke all on function public.bump_dartiq_source_revision() from public, anon, authenticated;

do $$
declare source_table text;
begin
  foreach source_table in array array['matches', 'match_players', 'legs', 'turns', 'throws',
    'dartiq_population_evidence', 'dartiq_player_evidence'] loop
    execute format('create trigger dartiq_source_revision after insert or update or delete on public.%I
      for each row execute function public.bump_dartiq_source_revision()', source_table);
  end loop;
end;
$$;

-- STABLE ensures every read, including the revision check, uses the same MVCC snapshot.
create function public.load_dartiq_telemetry_snapshot(p_match_id uuid, p_known_revision text default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  source_revision text;
  match_row jsonb;
  leg_rows jsonb;
  turns_by_leg jsonb;
begin
  if not exists (select 1 from public.matches where id = p_match_id) then return null; end if;
  select coalesce((select revision from public.dartiq_source_revisions where match_id = p_match_id), 0)::text
    into source_revision;
  if source_revision = p_known_revision then
    return jsonb_build_object('revision', source_revision, 'unchanged', true);
  end if;
  select to_jsonb(m) into match_row from public.matches m where id = p_match_id;
  if match_row is null then return null; end if;
  select coalesce(jsonb_agg(to_jsonb(l) order by l.leg_number), '[]') into leg_rows
    from public.legs l where l.match_id = p_match_id;
  select coalesce(jsonb_object_agg(l.id::text, (
    select coalesce(jsonb_agg(to_jsonb(t) || jsonb_build_object('throws', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', d.id, 'turn_id', d.turn_id, 'dart_index', d.dart_index,
        'segment', d.segment, 'scored', d.scored, 'scolia_event_id', d.scolia_event_id
      ) order by d.dart_index), '[]') from public.throws d where d.turn_id = t.id
    )) order by t.turn_number), '[]') from public.turns t where t.leg_id = l.id
  )), '{}') into turns_by_leg from public.legs l where l.match_id = p_match_id;
  return jsonb_build_object(
    'revision', source_revision, 'unchanged', false,
    'data', jsonb_build_object('match', match_row, 'legs', leg_rows, 'turnsByLeg', turns_by_leg,
      'players', (select coalesce(jsonb_agg(jsonb_build_object('id', mp.player_id) order by mp.play_order), '[]')
        from public.match_players mp where mp.match_id = p_match_id)),
    'population', (select to_jsonb(e) from public.dartiq_population_evidence e where e.match_id = p_match_id),
    'players', (select coalesce(jsonb_agg(to_jsonb(e) order by e.player_id), '[]')
      from public.dartiq_player_evidence e where e.match_id = p_match_id)
  );
end;
$$;
revoke all on function public.load_dartiq_telemetry_snapshot(uuid, text) from public, anon, authenticated;
grant execute on function public.load_dartiq_telemetry_snapshot(uuid, text) to service_role;

create function public.load_scolia_match_snapshot(
  p_match_id uuid, p_leg_id uuid default null, p_turn_id uuid default null
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('match', to_jsonb(m), 'leg', to_jsonb(l),
    'playerIds', (select coalesce(jsonb_agg(mp.player_id order by mp.play_order), '[]')
      from public.match_players mp where mp.match_id = m.id),
    'turns', (select coalesce(jsonb_agg(to_jsonb(t) || jsonb_build_object('throws', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', d.id, 'turn_id', d.turn_id, 'dart_index', d.dart_index,
        'segment', d.segment, 'scored', d.scored, 'scolia_event_id', d.scolia_event_id
      ) order by d.dart_index), '[]') from public.throws d where d.turn_id = t.id
    )) order by t.turn_number), '[]') from public.turns t where t.leg_id = l.id
      -- Normal post-insert settlement only needs the actor's history. Fair ending
      -- always needs the complete field, and initial player selection does too.
      and (p_turn_id is null or m.fair_ending or t.player_id = (
        select player_id from public.turns where id = p_turn_id and leg_id = l.id
      ))))
  from public.matches m
  join lateral (select * from public.legs where match_id = m.id
    and (case when p_leg_id is null then winner_player_id is null else id = p_leg_id end)
    order by leg_number desc limit 1) l on true
  where m.id = p_match_id;
$$;
revoke all on function public.load_scolia_match_snapshot(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.load_scolia_match_snapshot(uuid, uuid, uuid) to service_role;
