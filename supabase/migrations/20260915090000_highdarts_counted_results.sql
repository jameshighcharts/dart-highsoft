begin;

alter table public.highdarts_fixtures
  add column counts_for_a boolean not null default true,
  add column counts_for_b boolean not null default true,
  add constraint highdarts_group_counting_only check (stage = 'group' or (counts_for_a and counts_for_b)),
  add constraint highdarts_counting_requires_player check ((counts_for_a or player_a_id is not null) and (counts_for_b or player_b_id is not null));

create function public.set_highdarts_counting_atomic(
  p_event_id uuid, p_player_id uuid, p_excluded_fixture_id uuid, p_expected_excluded_fixture_id uuid,
  p_team_id text, p_slack_user_id text, p_is_admin boolean
) returns void language plpgsql security invoker set search_path = '' as $$
declare
  fixture_count integer;
  office_count integer;
  excluded_ids uuid[];
begin
  perform 1 from public.highdarts_events where id = p_event_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Tournament not found'; end if;
  if not coalesce(p_is_admin, false) and not exists (
    select 1 from public.slack_player_links where team_id = p_team_id and slack_user_id = p_slack_user_id and player_id = p_player_id
  ) then raise exception using errcode = '42501', message = 'You can only choose an excluded result for your own player'; end if;
  if exists (select 1 from public.highdarts_fixtures where event_id = p_event_id and stage = 'final') then
    raise exception using errcode = '55000', message = 'Unlock the finals draw before changing counted results';
  end if;
  select count(*), count(distinct office), array_agg(id) filter (where
    (player_a_id = p_player_id and not counts_for_a) or (player_b_id = p_player_id and not counts_for_b))
  into fixture_count, office_count, excluded_ids
  from public.highdarts_fixtures where event_id = p_event_id and stage = 'group' and p_player_id in (player_a_id, player_b_id);
  if fixture_count <> 6 or office_count <> 1 then
    raise exception using errcode = '22023', message = 'Only a player with six group fixtures in one office can exclude one result';
  end if;
  if p_excluded_fixture_id is not null and not exists (
    select 1 from public.highdarts_fixtures where id = p_excluded_fixture_id and event_id = p_event_id and stage = 'group' and p_player_id in (player_a_id, player_b_id)
  ) then raise exception using errcode = '22023', message = 'Choose one of this player''s group fixtures'; end if;
  if coalesce(cardinality(excluded_ids), 0) > 1 then
    raise exception using errcode = '55000', message = 'Multiple excluded results found. Ask an organiser to review the fixtures';
  end if;
  if excluded_ids[1] is not distinct from p_excluded_fixture_id then return; end if;
  if excluded_ids[1] is distinct from p_expected_excluded_fixture_id then
    raise exception using errcode = '55000', message = 'The excluded result changed. Refresh before choosing again';
  end if;
  update public.highdarts_fixtures set
    counts_for_a = case when player_a_id = p_player_id then id is distinct from p_excluded_fixture_id else counts_for_a end,
    counts_for_b = case when player_b_id = p_player_id then id is distinct from p_excluded_fixture_id else counts_for_b end
  where event_id = p_event_id and stage = 'group' and p_player_id in (player_a_id, player_b_id);
end;
$$;
revoke all on function public.set_highdarts_counting_atomic(uuid,uuid,uuid,uuid,text,text,boolean) from public, anon, authenticated;
grant execute on function public.set_highdarts_counting_atomic(uuid,uuid,uuid,uuid,text,text,boolean) to service_role;

-- Qualification must also fail closed for an older app that does not know about counting choices.
create function public.highdarts_require_counting_choices() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.stage = 'group' then return new; end if;
  perform 1 from public.highdarts_events where id = new.event_id for update;
  if exists (
    select side.player_id from public.highdarts_fixtures f
    cross join lateral (values (f.player_a_id, f.counts_for_a), (f.player_b_id, f.counts_for_b)) as side(player_id, counted)
    where f.event_id = new.event_id and f.stage = 'group' and side.player_id is not null
    group by f.office, side.player_id having count(*) = 6 and count(*) filter (where side.counted) <> 5
  ) then raise exception using errcode = '55000', message = 'Players with six group fixtures must each choose one excluded result before qualification'; end if;
  return new;
end;
$$;
create trigger highdarts_require_counting_choices before insert on public.highdarts_fixtures
  for each row execute function public.highdarts_require_counting_choices();
revoke all on function public.highdarts_require_counting_choices() from public, anon, authenticated;

commit;
