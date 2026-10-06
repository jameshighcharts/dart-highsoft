begin;

alter table public.highdarts_fixtures add column reported_result jsonb;
alter table public.highdarts_fixtures add constraint highdarts_reported_result_valid check (
  reported_result is null or coalesce(
    stage = 'group' and match_id is null and player_a_id is not null and player_b_id is not null
    and reported_result @> '{"accepted":true}'::jsonb
    and reported_result->>'winner_player_id' in (player_a_id::text, player_b_id::text)
    and reported_result->>'playedOn' ~ '^\d{4}-\d{2}-\d{2}$'
    and jsonb_typeof(reported_result->'legs') = 'array'
    and jsonb_array_length(reported_result->'legs') = 3
    and jsonb_typeof(reported_result->'estimatedAverages') = 'array'
    and jsonb_array_length(reported_result->'estimatedAverages') = 2
    and reported_result->'estimatedAverages' @> jsonb_build_array(
      jsonb_build_object('player_id', player_a_id), jsonb_build_object('player_id', player_b_id)),
    false
  )
);
comment on column public.highdarts_fixtures.reported_result is
  'Accepted tournament-only screenshot results. Three darts per visit; no scoring rows or Elo. Cannot coexist with a linked app match.';

drop function public.highdarts_snapshot();
create function public.highdarts_snapshot() returns jsonb
language sql stable security invoker set search_path = '' as $$
select jsonb_build_object(
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

drop function public.lock_highdarts_draw_atomic(jsonb,jsonb);
create function public.lock_highdarts_draw_atomic(p_expected jsonb,p_games jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare eid uuid; game jsonb;
begin
  select id into strict eid from public.highdarts_events where slug='highdarts-2026' for update;
  if exists(select 1 from public.highdarts_fixtures where event_id=eid and stage='final') then
    raise exception using errcode='55000',message='The draw is already locked'; end if;
  if public.highdarts_snapshot() is distinct from p_expected then
    raise exception using errcode='55000',message='Results changed. Refresh and review the draw again'; end if;
  if exists(select 1 from public.highdarts_fixtures f left join public.matches m on m.id=f.match_id
    where f.event_id=eid and f.stage='group' and f.reported_result is null and (m.completed_at is null or m.winner_player_id is null or m.ended_early)) then
    raise exception using errcode='55000',message='Complete the group games and tie-breaks first'; end if;
  if jsonb_array_length(p_games)<>11 then raise exception using errcode='22023',message='Expected eleven finals fixtures'; end if;
  for game in select value from jsonb_array_elements(p_games) loop
    if game->>'stage' not in ('playoff','quarterfinal','semifinal','final') then raise exception using errcode='22023',message='Invalid finals stage'; end if;
    insert into public.highdarts_fixtures(event_id,stage,fixture_no,player_a_name,player_b_name,player_a_id,player_b_id)
      values(eid,game->>'stage',(game->>'position')::integer,game->>'player_a_name',game->>'player_b_name',(game->>'player_a_id')::uuid,(game->>'player_b_id')::uuid);
  end loop;
  if (select count(*) from public.highdarts_fixtures where event_id=eid and stage='playoff')<>4
    or (select count(*) from public.highdarts_fixtures where event_id=eid and stage='quarterfinal')<>4
    or (select count(*) from public.highdarts_fixtures where event_id=eid and stage='semifinal')<>2
    or (select count(*) from public.highdarts_fixtures where event_id=eid and stage='final')<>1 then
    raise exception using errcode='22023',message='Invalid round sizes'; end if;
  update public.highdarts_fixtures f set next_fixture_id=n.id,next_slot=case when f.stage='playoff' then 'b' when f.fixture_no%2=1 then 'a' else 'b' end
    from public.highdarts_fixtures n where f.event_id=eid and n.event_id=eid and
      n.stage=case f.stage when 'playoff' then 'quarterfinal' when 'quarterfinal' then 'semifinal' when 'semifinal' then 'final' end
      and n.fixture_no=case when f.stage='playoff' then f.fixture_no else (f.fixture_no+1)/2 end;
end;
$$;


revoke all on function public.lock_highdarts_draw_atomic(jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.lock_highdarts_draw_atomic(jsonb,jsonb) to service_role;

commit;
