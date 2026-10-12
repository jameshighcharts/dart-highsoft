begin;

create table public.highdarts_final_absences (
  event_id uuid not null references public.highdarts_events(id),
  player_id uuid not null references public.players(id),
  primary key (event_id, player_id)
);
alter table public.highdarts_final_absences enable row level security;
revoke all on public.highdarts_final_absences from public, anon, authenticated;
grant all on public.highdarts_final_absences to service_role;

create function public.guard_highdarts_final_absence() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.event_id is distinct from old.event_id then
    raise exception using errcode='22023', message='An absence belongs to one event';
  end if;
  perform 1 from public.highdarts_events where id = coalesce(new.event_id, old.event_id) for update;
  if exists (select 1 from public.highdarts_fixtures
    where event_id = coalesce(new.event_id, old.event_id) and stage <> 'group') then
    raise exception using errcode='55000', message='Qualification has already started';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.guard_highdarts_final_absence() from public, anon, authenticated;
grant execute on function public.guard_highdarts_final_absence() to service_role;
create trigger highdarts_final_absence_guard before insert or update or delete
on public.highdarts_final_absences for each row execute function public.guard_highdarts_final_absence();

create function public.guard_highdarts_absent_finalist() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.stage = 'group' then return new; end if;
  perform 1 from public.highdarts_events where id = new.event_id for update;
  if exists (select 1 from public.highdarts_final_absences a
    where a.event_id = new.event_id and a.player_id in (new.player_a_id, new.player_b_id)) then
    raise exception using errcode='55000', message='A player is not attending HS Week';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_highdarts_absent_finalist() from public, anon, authenticated;
grant execute on function public.guard_highdarts_absent_finalist() to service_role;
create trigger highdarts_absent_finalist_guard before insert or update
on public.highdarts_fixtures for each row execute function public.guard_highdarts_absent_finalist();

drop function public.highdarts_snapshot();
create function public.highdarts_snapshot() returns jsonb
language sql stable security invoker set search_path = '' as $$
select jsonb_build_object(
  'absentPlayerIds', coalesce((select jsonb_agg(a.player_id order by a.player_id)
    from public.highdarts_final_absences a join public.highdarts_events e on e.id = a.event_id
    where e.slug = 'highdarts-2026'), '[]'::jsonb),
  'fixtures', coalesce((select jsonb_agg(to_jsonb(f) - 'slack_message_ts' - 'reported_result'
    || case when f.reported_result is null then '{}'::jsonb else jsonb_build_object('reportedResult', f.reported_result) end
    || jsonb_build_object('match',
    (select jsonb_build_object('id',m.id,'winner_player_id',m.winner_player_id,'completed_at',m.completed_at,
      'ended_early',m.ended_early,'paused_at',m.paused_at,'legs',coalesce((select jsonb_agg(jsonb_build_object(
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

revoke all on function public.highdarts_snapshot() from public, anon, authenticated;
grant execute on function public.highdarts_snapshot() to service_role;

do $$
declare eid uuid; identity_count integer;
  absent_ids uuid[] := array['f416c614-c8b9-4f85-988e-17926044b09d', 'd1da69a2-35b8-4174-b584-bcb8f8fe5fc4']::uuid[];
begin
  select count(*) into identity_count from public.players where id = any(absent_ids);
  if identity_count = 0 then return; end if;
  if identity_count <> 2 then raise exception 'Expected both reviewed Bergen players'; end if;
  select id into strict eid from public.highdarts_events where slug = 'highdarts-2026' for update;
  if exists (select 1 from unnest(absent_ids) as absent(player_id) where not exists (
    select 1 from public.highdarts_fixtures f where f.event_id=eid and f.stage='group' and f.office='bergen'
      and absent.player_id in (f.player_a_id, f.player_b_id))) then
    raise exception 'Reviewed players must both belong to the Bergen group';
  end if;
  insert into public.highdarts_final_absences(event_id, player_id)
    select eid, id from unnest(absent_ids) id;
end;
$$;

commit;
