-- Let Slack dart polls carry their own X01 settings (start score, finish rule,
-- legs to win) instead of always creating a one-leg 501 double-out match.
-- Existing polls keep the previous defaults.

alter table public.slack_dart_polls
  add column if not exists start_score public.x01_start not null default '501',
  add column if not exists finish public.finish_rule not null default 'double_out',
  add column if not exists legs_to_win integer not null default 1
    check (legs_to_win > 0);

create or replace function public.create_slack_x01_match_atomic(
  p_poll_id uuid,
  p_player_ids uuid[]
)
returns setof public.matches
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_poll public.slack_dart_polls%rowtype;
  v_match public.matches%rowtype;
  v_player_count integer;
begin
  if p_poll_id is null
     or p_player_ids is null
     or cardinality(p_player_ids) < 2
     or array_position(p_player_ids, null) is not null
     or cardinality(p_player_ids) <> (
       select count(distinct player_id)
       from unnest(p_player_ids) as requested(player_id)
     ) then
    raise exception using
      errcode = '22023',
      message = 'invalid_slack_match_players';
  end if;

  select *
  into v_poll
  from public.slack_dart_polls
  where id = p_poll_id;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'slack_poll_not_found';
  end if;

  select count(*)
  into v_player_count
  from public.players as player
  where player.id = any(p_player_ids);

  if v_player_count <> cardinality(p_player_ids) then
    raise exception using
      errcode = 'P0002',
      message = 'player_not_found';
  end if;

  insert into public.matches (
    mode,
    start_score,
    finish,
    legs_to_win,
    fair_ending,
    scolia_board_id,
    source_slack_poll_id
  ) values (
    'x01',
    v_poll.start_score,
    v_poll.finish,
    v_poll.legs_to_win,
    false,
    null,
    p_poll_id
  )
  returning * into v_match;

  insert into public.match_players (match_id, player_id, play_order)
  select v_match.id, requested.player_id, requested.ordinality::integer - 1
  from unnest(p_player_ids) with ordinality as requested(player_id, ordinality);

  insert into public.legs (match_id, leg_number, starting_player_id)
  values (v_match.id, 1, p_player_ids[1]);

  return next v_match;
  return;
end;
$$;

revoke all on function public.create_slack_x01_match_atomic(uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.create_slack_x01_match_atomic(uuid, uuid[])
  to service_role;
