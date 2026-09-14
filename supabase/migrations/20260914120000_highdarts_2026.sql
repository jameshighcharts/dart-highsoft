begin;
create table public.highdarts_events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique, name text not null,
  slack_channel_id text, created_at timestamptz not null default now()
);
create table public.highdarts_fixtures (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.highdarts_events(id),
  stage text not null check (stage in ('group','playoff','quarterfinal','semifinal','final','tiebreak')),
  office text check (office in ('bergen','vik','sogndal')),
  fixture_no integer not null check (fixture_no > 0),
  player_a_name text not null, player_b_name text not null,
  player_a_id uuid references public.players(id), player_b_id uuid references public.players(id),
  match_id uuid unique references public.matches(id) on delete set null,
  slack_message_ts text, created_at timestamptz not null default now(),
  check (stage <> 'group' or office is not null),
  check (player_a_id is null or player_b_id is null or player_a_id <> player_b_id),
  unique nulls not distinct (event_id, stage, office, fixture_no)
);
alter table public.matches add column highdarts_fixture_id uuid unique
  references public.highdarts_fixtures(id);
create index highdarts_fixtures_event_idx on public.highdarts_fixtures(event_id);
alter table public.highdarts_events enable row level security;
alter table public.highdarts_fixtures enable row level security;
revoke all on public.highdarts_events, public.highdarts_fixtures from anon, authenticated;
grant select on public.highdarts_events, public.highdarts_fixtures to anon, authenticated;
grant all on public.highdarts_events, public.highdarts_fixtures to service_role;
create policy highdarts_events_read on public.highdarts_events for select to anon, authenticated using (true);
create policy highdarts_fixtures_read on public.highdarts_fixtures for select to anon, authenticated using (true);

create function public.highdarts_normalize_name(p_name text) returns text
language sql immutable strict set search_path = '' as $$
  select regexp_replace(trim(translate(replace(replace(replace(lower(p_name), 'æ', 'ae'), 'œ', 'oe'), 'ß', 'ss'),
    'øåáàâäãéèêëíìîïóòôöõúùûüýÿçñ', 'oaaaaaeeeeiiiiooooouuuuyycn')), '\s+', ' ', 'g');
$$;
insert into public.highdarts_events(slug, name) values ('highdarts-2026', 'Highdarts 2026');
insert into public.highdarts_fixtures(event_id, stage, office, fixture_no, player_a_name, player_b_name)
select e.id, 'group', s.office, s.n, s.a, s.b from public.highdarts_events e cross join (values
  ('bergen', 1, 'Ferdinand Berntsen', 'Aleksander Walle'),
  ('bergen', 2, 'Nicolas Silvester', 'Guro'),
  ('bergen', 3, 'Babar Shah', 'James Haugen'),
  ('bergen', 4, 'Havard Gundersen', 'Stian Totland'),
  ('bergen', 5, 'James Haugen', 'Havard Gundersen'),
  ('bergen', 6, 'Nikita Myklebust', 'Aleksander Walle'),
  ('bergen', 7, 'Babar Shah', 'Ferdinand Berntsen'),
  ('bergen', 8, 'Havard Gundersen', 'Ken-Havard Lieng'),
  ('bergen', 9, 'Nicolas Silvester', 'Babar Shah'),
  ('bergen', 10, 'Havard Gundersen', 'Nikita Myklebust'),
  ('bergen', 11, 'Kseniia Hadzhun', 'Alicja Pankowiecka'),
  ('bergen', 12, 'Babar Shah', 'Guro'),
  ('bergen', 13, 'Aleksander Walle', 'Kseniia Hadzhun'),
  ('bergen', 14, 'Guro', 'Aleksander Walle'),
  ('bergen', 15, 'Ferdinand Berntsen', 'Kseniia Hadzhun'),
  ('bergen', 16, 'Guro', 'Havard Gundersen'),
  ('bergen', 17, 'Babar Shah', 'Alicja Pankowiecka'),
  ('bergen', 18, 'Nicolas Silvester', 'Nikita Myklebust'),
  ('bergen', 19, 'Nicolas Silvester', 'Alicja Pankowiecka'),
  ('bergen', 20, 'Stian Totland', 'Alicja Pankowiecka'),
  ('bergen', 21, 'Stian Totland', 'Ferdinand Berntsen'),
  ('bergen', 22, 'James Haugen', 'Stian Totland'),
  ('bergen', 23, 'James Haugen', 'Kseniia Hadzhun'),
  ('bergen', 24, 'Aleksander Walle', 'Ken-Havard Lieng'),
  ('bergen', 25, 'Guro', 'James Haugen'),
  ('bergen', 26, 'Ken-Havard Lieng', 'Alicja Pankowiecka'),
  ('bergen', 27, 'Nikita Myklebust', 'Ferdinand Berntsen'),
  ('bergen', 28, 'Nicolas Silvester', 'Ken-Havard Lieng'),
  ('bergen', 29, 'Kseniia Hadzhun', 'Ken-Havard Lieng'),
  ('bergen', 30, 'Stian Totland', 'Nikita Myklebust'),
  ('sogndal', 1, 'Sindre Jensen', 'Jon Skjerdal'),
  ('sogndal', 2, 'Jon Skjerdal', 'Jorgen Tistel'),
  ('sogndal', 3, 'Jon Skjerdal', 'Mykhailo Pelykh'),
  ('sogndal', 4, 'Sindre Jensen', 'Mykhailo Pelykh'),
  ('sogndal', 5, 'Johan Flo', 'Mykhailo Pelykh'),
  ('sogndal', 6, 'Johan Flo', 'Sindre Jensen'),
  ('sogndal', 7, 'Sindre Jensen', 'Jorgen Tistel'),
  ('sogndal', 8, 'Jorgen Tistel', 'Johan Flo'),
  ('sogndal', 9, 'Jorgen Tistel', 'Sindre Jensen'),
  ('sogndal', 10, 'Mykhailo Pelykh', 'Jorgen Tistel'),
  ('sogndal', 11, 'Mykhailo Pelykh', 'Sindre Jensen'),
  ('sogndal', 12, 'Johan Flo', 'Jon Skjerdal'),
  ('sogndal', 13, 'Jon Skjerdal', 'Johan Flo'),
  ('vik', 1, 'Helga Brudevoll', 'Pawel Kubica'),
  ('vik', 2, 'Silje Tverberg', 'Anne Hauge'),
  ('vik', 3, 'Linda Sven', 'Joakim Rudolfsen'),
  ('vik', 4, 'Elida Espeland', 'Bengt Abelsen Ohlen'),
  ('vik', 5, 'Helga Brudevoll', 'Sigrid Lundeland'),
  ('vik', 6, 'Elise Fosse', 'Gjertrud'),
  ('vik', 7, 'Askele Johansson', 'Gjertrud'),
  ('vik', 8, 'Bengt Abelsen Ohlen', 'Sigrid Lundeland'),
  ('vik', 9, 'Andreas Tistel', 'Gjertrud'),
  ('vik', 10, 'Pawel Kubica', 'Silje Tverberg'),
  ('vik', 11, 'Joakim Rudolfsen', 'Gjertrud'),
  ('vik', 12, 'Elise Fosse', 'Anne Hauge'),
  ('vik', 13, 'Joakim Rudolfsen', 'Elise Fosse'),
  ('vik', 14, 'Joakim Rudolfsen', 'Sigrid Lundeland'),
  ('vik', 15, 'Elida Espeland', 'Silje Tverberg'),
  ('vik', 16, 'Bengt Abelsen Ohlen', 'Andreas Tistel'),
  ('vik', 17, 'Helga Brudevoll', 'Andreas Tistel'),
  ('vik', 18, 'Anne Hauge', 'Gjertrud'),
  ('vik', 19, 'Askele Johansson', 'Andreas Tistel'),
  ('vik', 20, 'Pawel Kubica', 'Elise Fosse'),
  ('vik', 21, 'Bengt Abelsen Ohlen', 'Anne Hauge'),
  ('vik', 22, 'Linda Sven', 'Pawel Kubica'),
  ('vik', 23, 'Linda Sven', 'Gjertrud'),
  ('vik', 24, 'Sigrid Lundeland', 'Anne Hauge'),
  ('vik', 25, 'Elida Espeland', 'Sigrid Lundeland'),
  ('vik', 26, 'Elida Espeland', 'Joakim Rudolfsen'),
  ('vik', 27, 'Pawel Kubica', 'Andreas Tistel'),
  ('vik', 28, 'Linda Sven', 'Askele Johansson'),
  ('vik', 29, 'Askele Johansson', 'Helga Brudevoll'),
  ('vik', 30, 'Linda Sven', 'Silje Tverberg'),
  ('vik', 31, 'Helga Brudevoll', 'Bengt Abelsen Ohlen'),
  ('vik', 32, 'Elida Espeland', 'Elise Fosse'),
  ('vik', 33, 'Askele Johansson', 'Silje Tverberg')
) s(office,n,a,b) where e.slug = 'highdarts-2026';
-- Only exact, unique normalized names/nicknames resolve. Partial names stay for an admin.
with names as (
  select distinct player_a_name as name from public.highdarts_fixtures
  union select distinct player_b_name from public.highdarts_fixtures
), resolved as (
  select n.name, (array_agg(p.id))[1] as id from names n join public.players p on p.is_active
  and exists (select 1 from unnest(array[p.display_name] || coalesce(p.nicknames, '{}'::text[])) alias
    where public.highdarts_normalize_name(alias) = public.highdarts_normalize_name(n.name))
  group by n.name having count(*) = 1
)
update public.highdarts_fixtures f set
  player_a_id = (select id from resolved where name = f.player_a_name),
  player_b_id = case when (select id from resolved where name = f.player_a_name) = (select id from resolved where name = f.player_b_name) then null else (select id from resolved where name = f.player_b_name) end;

create function public.link_highdarts_match_atomic(p_match_id uuid, p_fixture_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare m public.matches%rowtype; f public.highdarts_fixtures%rowtype; ids uuid[];
begin
  select * into m from public.matches where id = p_match_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Match not found'; end if;
  select * into f from public.highdarts_fixtures where id = p_fixture_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Fixture not found'; end if;
  if f.match_id is not null or m.highdarts_fixture_id is not null then
    raise exception using errcode = '23505', message = 'This fixture or match is already linked';
  end if;
  if f.stage <> 'group' or f.player_a_id is null or f.player_b_id is null then
    raise exception using errcode = '22023', message = 'Fixture players must be linked before starting';
  end if;
  select array_agg(player_id order by player_id) into ids from public.match_players where match_id = m.id;
  if cardinality(ids) <> 2 or not (f.player_a_id = any(ids) and f.player_b_id = any(ids)) then
    raise exception using errcode = '22023', message = 'Match players do not match the fixture';
  end if;
  if m.mode <> 'x01' or m.tournament_match_id is not null or m.completed_at is not null
    or m.winner_player_id is not null or m.ended_early or exists (
      select 1 from public.throws d join public.turns t on t.id = d.turn_id
      join public.legs l on l.id = t.leg_id where l.match_id = m.id
    ) or exists (select 1 from public.legs where match_id = m.id and (leg_number > 1 or winner_player_id is not null)) then
    raise exception using errcode = '55000', message = 'Scoring has started. Start a new match from the Bengt page.';
  end if;
  update public.matches set highdarts_fixture_id = f.id, start_score = '301', finish = 'single_out',
    legs_to_win = 2, fair_ending = false where id = m.id;
  update public.highdarts_fixtures set match_id = m.id where id = f.id;
end;
$$;
create function public.create_highdarts_match_atomic(p_fixture_id uuid, p_player_ids uuid[],
  p_start_score public.x01_start, p_finish public.finish_rule, p_legs_to_win integer,
  p_fair_ending boolean, p_closest_to_bull boolean default false, p_scolia_board_id uuid default null)
returns setof public.matches language plpgsql security invoker set search_path = '' as $$
declare m public.matches%rowtype;
begin
  if p_start_score is distinct from '301'::public.x01_start or p_finish is distinct from 'single_out'::public.finish_rule
    or p_legs_to_win is distinct from 2 or p_fair_ending is distinct from false then
    raise exception using errcode = '22023', message = 'Highdarts group matches require 301 / single out / first to 2, fair ending off';
  end if;
  if p_closest_to_bull then
    select * into strict m from public.create_bull_off_match_atomic(p_start_score,p_finish,p_legs_to_win,p_fair_ending,p_player_ids,p_scolia_board_id);
  else
    select * into strict m from public.create_x01_match_atomic(p_start_score,p_finish,p_legs_to_win,p_fair_ending,p_player_ids,p_scolia_board_id);
  end if;
  perform public.link_highdarts_match_atomic(m.id, p_fixture_id);
  return query select * from public.matches where id = m.id;
end;
$$;
revoke all on function public.link_highdarts_match_atomic(uuid,uuid),
  public.create_highdarts_match_atomic(uuid,uuid[],public.x01_start,public.finish_rule,integer,boolean,boolean,uuid)
  from public, anon, authenticated;
grant execute on function public.link_highdarts_match_atomic(uuid,uuid),
  public.create_highdarts_match_atomic(uuid,uuid[],public.x01_start,public.finish_rule,integer,boolean,boolean,uuid) to service_role;

create function public.map_highdarts_player_atomic(p_fixture_id uuid, p_side text, p_player_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare f public.highdarts_fixtures%rowtype; sheet_name text;
begin
  if p_side not in ('a','b') then raise exception using errcode='22023', message='Invalid fixture side'; end if;
  select * into f from public.highdarts_fixtures where id=p_fixture_id;
  if not found then raise exception using errcode='P0002', message='Fixture not found'; end if;
  if f.match_id is not null then raise exception using errcode='55000', message='Fixture is already claimed'; end if;
  if not exists (select 1 from public.players where id=p_player_id and is_active) then
    raise exception using errcode='22023', message='Active player not found';
  end if;
  sheet_name := case when p_side='a' then f.player_a_name else f.player_b_name end;
  -- Lock in a stable order before updating all occurrences of this sheet name.
  perform 1 from public.highdarts_fixtures where event_id=f.event_id and office is not distinct from f.office
    and match_id is null and (player_a_name=sheet_name or player_b_name=sheet_name) order by id for update;
  if exists (select 1 from public.highdarts_fixtures where id=p_fixture_id and match_id is not null) then
    raise exception using errcode='55000', message='Fixture was claimed while mapping';
  end if;
  update public.highdarts_fixtures set
    player_a_id=case when player_a_name=sheet_name then p_player_id else player_a_id end,
    player_b_id=case when player_b_name=sheet_name then p_player_id else player_b_id end
  where event_id=f.event_id and office is not distinct from f.office and match_id is null
    and (player_a_name=sheet_name or player_b_name=sheet_name);
end;
$$;
revoke all on function public.map_highdarts_player_atomic(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.map_highdarts_player_atomic(uuid,text,uuid) to service_role;

-- All scoring inserts take the same row lock as pre-start tagging. A concurrent
-- first dart either precedes tagging (which rejects it), or sees the new settings.
create function public.highdarts_lock_scoring_match() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.matches m join public.legs l on l.match_id = m.id
    join public.turns t on t.leg_id = l.id where t.id = new.turn_id for update of m;
  return new;
end;
$$;
create trigger highdarts_lock_scoring_match before insert on public.throws
  for each row execute function public.highdarts_lock_scoring_match();

create function public.highdarts_guard_match() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.highdarts_fixture_id is not null and exists (
    select 1 from public.highdarts_fixtures f where f.id = new.highdarts_fixture_id and f.stage = 'group'
  ) and (new.start_score <> '301' or new.finish <> 'single_out' or new.legs_to_win <> 2 or new.fair_ending) then
    raise exception using errcode = '22023', message = 'Settings are locked by Highdarts 2026 rules';
  end if;
  return new;
end;
$$;
create trigger highdarts_guard_match before update on public.matches for each row execute function public.highdarts_guard_match();
create function public.highdarts_guard_lineup() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare mid uuid;
begin
  if tg_op = 'UPDATE' and new.player_id = old.player_id and new.match_id = old.match_id then return new; end if;
  mid := case when tg_op = 'DELETE' then old.match_id else new.match_id end;
  perform 1 from public.matches where id = mid for update;
  if tg_op = 'UPDATE' and old.match_id <> new.match_id and exists (select 1 from public.matches where id = old.match_id and highdarts_fixture_id is not null) then
    raise exception using errcode = '55000', message = 'Highdarts fixture players cannot be moved';
  end if;
  if exists (select 1 from public.matches where id = mid and highdarts_fixture_id is not null) then
    raise exception using errcode = '55000', message = 'Highdarts fixture players cannot be changed';
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;
create trigger highdarts_guard_lineup before insert or update or delete on public.match_players
  for each row execute function public.highdarts_guard_lineup();

-- Both links must agree at commit, after the atomic RPC has updated each side.
create function public.highdarts_check_link() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if exists (select 1 from public.matches m where m.highdarts_fixture_id is not null and not exists (
      select 1 from public.highdarts_fixtures f where f.id=m.highdarts_fixture_id and f.match_id=m.id))
    or exists (select 1 from public.highdarts_fixtures f where f.match_id is not null and not exists (
      select 1 from public.matches m where m.id=f.match_id and m.highdarts_fixture_id=f.id)) then
    raise exception using errcode = '23514', message = 'Highdarts fixture and match links must agree';
  end if;
  return null;
end;
$$;
create constraint trigger highdarts_match_link after insert or update of highdarts_fixture_id on public.matches
  deferrable initially deferred for each row when (new.highdarts_fixture_id is not null)
  execute function public.highdarts_check_link();
create constraint trigger highdarts_fixture_link after insert or update on public.highdarts_fixtures
  deferrable initially deferred for each row execute function public.highdarts_check_link();

-- Completion and enqueue commit together, including Scolia and early endings.
create function public.enqueue_highdarts_result() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.highdarts_fixture_id is not null and (new.completed_at is not null or new.ended_early)
    and old.completed_at is null and not old.ended_early then
    insert into public.background_jobs(job_type,payload,run_at,deduplication_key)
    values ('highdarts_result',jsonb_build_object('fixtureId',new.highdarts_fixture_id),now(),
      'highdarts_result:' || new.highdarts_fixture_id::text) on conflict (deduplication_key) do nothing;
  end if;
  return new;
end;
$$;
create trigger enqueue_highdarts_result after update on public.matches for each row execute function public.enqueue_highdarts_result();

-- One statement-consistent JSON result avoids PostgREST's per-table row cap.
create function public.highdarts_snapshot() returns jsonb
language sql stable security invoker set search_path = '' as $$
select jsonb_build_object(
  'fixtures', coalesce((select jsonb_agg(to_jsonb(f) - 'slack_message_ts' || jsonb_build_object('match',
    (select jsonb_build_object('id',m.id,'winner_player_id',m.winner_player_id,'completed_at',m.completed_at,
      'ended_early',m.ended_early,'legs',coalesce((select jsonb_agg(jsonb_build_object(
        'winner_player_id',l.winner_player_id,'turns',coalesce((select jsonb_agg(jsonb_build_object(
          'player_id',t.player_id,'total_scored',t.total_scored,'busted',t.busted,'tiebreak_round',t.tiebreak_round,
          'darts_thrown',(select count(*) from public.throws d where d.turn_id = t.id)) order by t.turn_number)
          from public.turns t where t.leg_id = l.id), '[]'::jsonb)))
        from public.legs l where l.match_id = m.id),'[]'::jsonb))
      from public.matches m where m.id = f.match_id)) order by f.office, f.fixture_no)
    from public.highdarts_fixtures f join public.highdarts_events e on e.id=f.event_id where e.slug='highdarts-2026'), '[]'::jsonb),
  'players',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'display_name',p.display_name,'avatar_url',p.avatar_url))
    from public.players p where exists (select 1 from public.highdarts_fixtures f where p.id in (f.player_a_id,f.player_b_id))), '[]'::jsonb)
);
$$;
revoke all on function public.highdarts_snapshot() from public,anon,authenticated;
grant execute on function public.highdarts_snapshot() to service_role;
commit;
