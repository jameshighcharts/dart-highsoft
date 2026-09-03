lock table public.matches, public.game_sessions in share row exclusive mode;

do $$
declare
  v_conflicting_boards text;
begin
  select string_agg(conflicts.board_id::text, ', ' order by conflicts.board_id::text)
  into v_conflicting_boards
  from (
    select distinct m.scolia_board_id as board_id
    from public.matches m
    join public.game_sessions g on g.scolia_board_id = m.scolia_board_id
    where m.scolia_board_id is not null
      and m.completed_at is null
      and m.winner_player_id is null
      and m.ended_early = false
      and g.status = 'active'
  ) conflicts;

  if v_conflicting_boards is not null then
    raise exception using
      errcode = '23505',
      message = 'Existing Scolia board conflicts must be resolved before migration: ' || v_conflicting_boards,
      constraint = 'scolia_board_single_active_target';
  end if;
end;
$$;

drop trigger if exists matches_scolia_board_unclaimed on public.matches;
drop trigger if exists game_sessions_scolia_board_unclaimed on public.game_sessions;
drop function if exists public.assert_scolia_board_unclaimed();

create function public.assert_scolia_board_unclaimed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_board_id uuid;
  v_active boolean;
begin
  if tg_table_name = 'matches' then
    v_board_id := new.scolia_board_id;
    v_active := new.completed_at is null
      and new.winner_player_id is null
      and new.ended_early = false;
  elsif tg_table_name = 'game_sessions' then
    v_board_id := new.scolia_board_id;
    v_active := new.status = 'active';
  else
    raise exception using
      errcode = '55000',
      message = 'unsupported_scolia_target_table';
  end if;

  if v_board_id is null or not v_active then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext('scolia_board:' || v_board_id::text));

  if exists (
    select 1
    from public.matches m
    where m.scolia_board_id = v_board_id
      and m.completed_at is null
      and m.winner_player_id is null
      and m.ended_early = false
      and (tg_table_name <> 'matches' or m.id <> new.id)
  ) or exists (
    select 1
    from public.game_sessions g
    where g.scolia_board_id = v_board_id
      and g.status = 'active'
      and (tg_table_name <> 'game_sessions' or g.id <> new.id)
  ) then
    raise unique_violation using
      message = 'Scolia board already has an active match or game session',
      constraint = 'scolia_board_single_active_target';
  end if;

  return new;
end;
$$;

create trigger matches_scolia_board_unclaimed
  before insert or update of scolia_board_id, completed_at, winner_player_id, ended_early
  on public.matches
  for each row execute function public.assert_scolia_board_unclaimed();

create trigger game_sessions_scolia_board_unclaimed
  before insert or update of scolia_board_id, status
  on public.game_sessions
  for each row execute function public.assert_scolia_board_unclaimed();

create function public.create_game_session_atomic(
  p_mode public.game_session_mode,
  p_config jsonb,
  p_player_ids uuid[],
  p_scolia_board_id uuid default null
)
returns setof public.game_sessions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session public.game_sessions%rowtype;
  v_player_count integer;
begin
  if p_player_ids is null
     or cardinality(p_player_ids) = 0
     or array_position(p_player_ids, null) is not null
     or cardinality(p_player_ids) <> (
       select count(distinct player_id)
       from unnest(p_player_ids) as requested(player_id)
     ) then
    raise exception using
      errcode = '22023',
      message = 'invalid_game_players';
  end if;

  select count(*)
  into v_player_count
  from public.players p
  where p.id = any(p_player_ids);

  if v_player_count <> cardinality(p_player_ids) then
    raise exception using
      errcode = 'P0002',
      message = 'player_not_found';
  end if;

  insert into public.game_sessions (mode, config, scolia_board_id)
  values (p_mode, p_config, p_scolia_board_id)
  returning * into v_session;

  insert into public.game_session_players (session_id, player_id, play_order)
  select v_session.id, requested.player_id, requested.ordinality::integer - 1
  from unnest(p_player_ids) with ordinality as requested(player_id, ordinality);

  return next v_session;
  return;
end;
$$;

create function public.create_x01_match_atomic(
  p_start_score public.x01_start,
  p_finish public.finish_rule,
  p_legs_to_win integer,
  p_fair_ending boolean,
  p_player_ids uuid[],
  p_scolia_board_id uuid default null
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
    raise exception using
      errcode = '22023',
      message = 'invalid_match_players';
  end if;

  select count(*)
  into v_player_count
  from public.players p
  where p.id = any(p_player_ids);

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
    scolia_board_id
  ) values (
    'x01',
    p_start_score,
    p_finish,
    p_legs_to_win,
    p_fair_ending,
    p_scolia_board_id
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

create function public.append_game_throw_atomic(
  p_session_id uuid,
  p_expected_last_throw_id uuid,
  p_player_id uuid,
  p_round_number integer,
  p_turn_index integer,
  p_dart_index integer,
  p_segment text,
  p_scored integer,
  p_meta jsonb,
  p_scolia_event_id bigint default null,
  p_impact_x_mm numeric default null,
  p_impact_y_mm numeric default null,
  p_angle_horizontal_deg numeric default null,
  p_angle_vertical_deg numeric default null,
  p_finalize boolean default false,
  p_winner_player_id uuid default null
)
returns setof public.game_throws
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session public.game_sessions%rowtype;
  v_tail public.game_throws%rowtype;
  v_throw public.game_throws%rowtype;
  v_invalid_sequence boolean;
begin
  if p_player_id is null
     or p_round_number is null
     or p_turn_index is null
     or p_dart_index is null
     or p_segment is null
     or p_scored is null then
    raise exception using
      errcode = '22023',
      message = 'invalid_game_throw';
  end if;

  select g.*
  into v_session
  from public.game_sessions g
  where g.id = p_session_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'game_not_found';
  end if;

  if v_session.status <> 'active' then
    raise exception using
      errcode = '55000',
      message = 'game_not_active';
  end if;

  select gt.*
  into v_tail
  from public.game_throws gt
  where gt.session_id = p_session_id
  order by gt.turn_index desc, gt.dart_index desc
  limit 1;

  if v_tail.id is distinct from p_expected_last_throw_id then
    raise exception using
      errcode = '40001',
      message = 'stale_game_snapshot';
  end if;

  select exists (
    select 1
    from (
      select
        gt.player_id,
        gt.round_number,
        gt.turn_index,
        gt.dart_index,
        row_number() over (order by gt.turn_index, gt.dart_index) as position,
        lag(gt.player_id) over (order by gt.turn_index, gt.dart_index) as previous_player_id,
        lag(gt.round_number) over (order by gt.turn_index, gt.dart_index) as previous_round_number,
        lag(gt.turn_index) over (order by gt.turn_index, gt.dart_index) as previous_turn_index,
        lag(gt.dart_index) over (order by gt.turn_index, gt.dart_index) as previous_dart_index
      from public.game_throws gt
      where gt.session_id = p_session_id
    ) ordered
    where (
      ordered.position = 1
      and (
        ordered.round_number <> 1
        or ordered.turn_index <> 0
        or ordered.dart_index <> 1
      )
    ) or (
      ordered.position > 1
      and not (
        (
          ordered.turn_index = ordered.previous_turn_index
          and ordered.dart_index = ordered.previous_dart_index + 1
          and ordered.round_number = ordered.previous_round_number
          and ordered.player_id = ordered.previous_player_id
        ) or (
          ordered.turn_index = ordered.previous_turn_index + 1
          and ordered.dart_index = 1
          and ordered.round_number between ordered.previous_round_number and ordered.previous_round_number + 1
        )
      )
    )
  ) into v_invalid_sequence;

  if v_invalid_sequence then
    raise check_violation using
      message = 'invalid_game_throw_sequence',
      constraint = 'game_throws_contiguous_sequence';
  end if;

  if not exists (
    select 1
    from public.game_session_players gsp
    where gsp.session_id = p_session_id
      and gsp.player_id = p_player_id
  ) then
    raise check_violation using
      message = 'invalid_game_throw_player',
      constraint = 'game_throws_session_player';
  end if;

  if v_tail.id is null then
    if p_round_number <> 1 or p_turn_index <> 0 or p_dart_index <> 1 then
      raise check_violation using
        message = 'invalid_game_throw_sequence',
        constraint = 'game_throws_contiguous_sequence';
    end if;
  elsif not (
    (
      p_turn_index = v_tail.turn_index
      and v_tail.dart_index < 3
      and p_dart_index = v_tail.dart_index + 1
      and p_round_number = v_tail.round_number
      and p_player_id = v_tail.player_id
    ) or (
      p_turn_index = v_tail.turn_index + 1
      and p_dart_index = 1
      and p_round_number between v_tail.round_number and v_tail.round_number + 1
    )
  ) then
    raise check_violation using
      message = 'invalid_game_throw_sequence',
      constraint = 'game_throws_contiguous_sequence';
  end if;

  if coalesce(p_finalize, false) is false and p_winner_player_id is not null then
    raise exception using
      errcode = '22023',
      message = 'invalid_game_winner';
  end if;

  if coalesce(p_finalize, false) and p_winner_player_id is null then
    raise exception using
      errcode = '22023',
      message = 'invalid_game_winner';
  end if;

  if p_winner_player_id is not null and not exists (
    select 1
    from public.game_session_players gsp
    where gsp.session_id = p_session_id
      and gsp.player_id = p_winner_player_id
  ) then
    raise check_violation using
      message = 'invalid_game_winner',
      constraint = 'game_sessions_winner_is_player';
  end if;

  insert into public.game_throws (
    session_id,
    player_id,
    round_number,
    turn_index,
    dart_index,
    segment,
    scored,
    meta,
    scolia_event_id,
    impact_x_mm,
    impact_y_mm,
    angle_horizontal_deg,
    angle_vertical_deg
  ) values (
    p_session_id,
    p_player_id,
    p_round_number,
    p_turn_index,
    p_dart_index,
    p_segment,
    p_scored,
    coalesce(p_meta, '{}'::jsonb),
    p_scolia_event_id,
    p_impact_x_mm,
    p_impact_y_mm,
    p_angle_horizontal_deg,
    p_angle_vertical_deg
  )
  returning * into v_throw;

  if coalesce(p_finalize, false) then
    update public.game_sessions
    set status = 'completed',
        winner_player_id = p_winner_player_id,
        completed_at = now()
    where id = p_session_id;
  end if;

  return next v_throw;
  return;
end;
$$;

create function public.undo_last_game_throw_atomic(
  p_session_id uuid,
  p_expected_last_throw_id uuid,
  p_reopen boolean default false
)
returns table (
  id uuid,
  session_id uuid,
  player_id uuid,
  round_number integer,
  turn_index integer,
  dart_index integer,
  segment text,
  scored integer,
  meta jsonb,
  scolia_event_id bigint,
  impact_x_mm numeric,
  impact_y_mm numeric,
  angle_horizontal_deg numeric,
  angle_vertical_deg numeric,
  created_at timestamptz,
  reopened boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session public.game_sessions%rowtype;
  v_tail public.game_throws%rowtype;
  v_deleted public.game_throws%rowtype;
  v_reopened boolean := false;
begin
  if p_reopen is null then
    raise exception using
      errcode = '22023',
      message = 'invalid_game_reopen';
  end if;

  select g.*
  into v_session
  from public.game_sessions g
  where g.id = p_session_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'game_not_found';
  end if;

  if v_session.status = 'ended_early' then
    raise exception using
      errcode = '55000',
      message = 'game_not_active';
  end if;

  if (v_session.status = 'completed') is distinct from p_reopen then
    raise exception using
      errcode = '40001',
      message = 'stale_game_snapshot';
  end if;

  select gt.*
  into v_tail
  from public.game_throws gt
  where gt.session_id = p_session_id
  order by gt.turn_index desc, gt.dart_index desc
  limit 1;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'game_throw_not_found';
  end if;

  if v_tail.id is distinct from p_expected_last_throw_id then
    raise exception using
      errcode = '40001',
      message = 'stale_game_snapshot';
  end if;

  delete from public.game_throws gt
  where gt.id = v_tail.id
  returning gt.* into v_deleted;

  if p_reopen then
    update public.game_sessions
    set status = 'active',
        winner_player_id = null,
        completed_at = null
    where game_sessions.id = p_session_id;
    v_reopened := true;
  end if;

  return query
  select
    v_deleted.id,
    v_deleted.session_id,
    v_deleted.player_id,
    v_deleted.round_number,
    v_deleted.turn_index,
    v_deleted.dart_index,
    v_deleted.segment,
    v_deleted.scored,
    v_deleted.meta,
    v_deleted.scolia_event_id,
    v_deleted.impact_x_mm,
    v_deleted.impact_y_mm,
    v_deleted.angle_horizontal_deg,
    v_deleted.angle_vertical_deg,
    v_deleted.created_at,
    v_reopened;
end;
$$;

create function public.finalize_game_session_atomic(
  p_session_id uuid,
  p_expected_last_throw_id uuid,
  p_winner_player_id uuid default null
)
returns setof public.game_sessions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session public.game_sessions%rowtype;
  v_tail_id uuid;
begin
  if p_winner_player_id is null then
    raise exception using
      errcode = '22023',
      message = 'invalid_game_winner';
  end if;

  select g.*
  into v_session
  from public.game_sessions g
  where g.id = p_session_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'game_not_found';
  end if;

  select gt.id
  into v_tail_id
  from public.game_throws gt
  where gt.session_id = p_session_id
  order by gt.turn_index desc, gt.dart_index desc
  limit 1;

  if v_tail_id is distinct from p_expected_last_throw_id then
    raise exception using
      errcode = '40001',
      message = 'stale_game_snapshot';
  end if;

  if v_tail_id is null then
    raise check_violation using
      message = 'invalid_game_throw_sequence',
      constraint = 'game_throws_contiguous_sequence';
  end if;

  if p_winner_player_id is not null and not exists (
    select 1
    from public.game_session_players gsp
    where gsp.session_id = p_session_id
      and gsp.player_id = p_winner_player_id
  ) then
    raise check_violation using
      message = 'invalid_game_winner',
      constraint = 'game_sessions_winner_is_player';
  end if;

  if v_session.status = 'completed' then
    if v_session.winner_player_id is distinct from p_winner_player_id then
      raise exception using
        errcode = '40001',
        message = 'stale_game_snapshot';
    end if;
    return next v_session;
    return;
  end if;

  if v_session.status <> 'active' then
    raise exception using
      errcode = '55000',
      message = 'game_not_active';
  end if;

  update public.game_sessions g
  set status = 'completed',
      winner_player_id = p_winner_player_id,
      completed_at = now()
  where g.id = p_session_id
  returning g.* into v_session;

  return next v_session;
  return;
end;
$$;

revoke all on function public.create_game_session_atomic(public.game_session_mode, jsonb, uuid[], uuid)
  from public, anon, authenticated;
revoke all on function public.create_x01_match_atomic(public.x01_start, public.finish_rule, integer, boolean, uuid[], uuid)
  from public, anon, authenticated;
revoke all on function public.append_game_throw_atomic(uuid, uuid, uuid, integer, integer, integer, text, integer, jsonb, bigint, numeric, numeric, numeric, numeric, boolean, uuid)
  from public, anon, authenticated;
revoke all on function public.undo_last_game_throw_atomic(uuid, uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.finalize_game_session_atomic(uuid, uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.create_game_session_atomic(public.game_session_mode, jsonb, uuid[], uuid)
  to service_role;
grant execute on function public.create_x01_match_atomic(public.x01_start, public.finish_rule, integer, boolean, uuid[], uuid)
  to service_role;
grant execute on function public.append_game_throw_atomic(uuid, uuid, uuid, integer, integer, integer, text, integer, jsonb, bigint, numeric, numeric, numeric, numeric, boolean, uuid)
  to service_role;
grant execute on function public.undo_last_game_throw_atomic(uuid, uuid, boolean)
  to service_role;
grant execute on function public.finalize_game_session_atomic(uuid, uuid, uuid)
  to service_role;

create or replace view public.shanghai_leaderboard as
with per_game as (
  select
    gsp.session_id,
    gsp.player_id,
    coalesce(sum(coalesce((gt.meta->>'pointsScored')::int, 0)), 0) as total,
    coalesce(bool_or(coalesce((gt.meta->>'shanghai')::boolean, false)), false) as shanghai
  from public.game_session_players gsp
  join public.game_sessions gs on gs.id = gsp.session_id
  left join public.game_throws gt
    on gt.session_id = gsp.session_id
   and gt.player_id = gsp.player_id
  where gs.status = 'completed' and gs.mode = 'shanghai'
  group by gsp.session_id, gsp.player_id
)
select
  lb.player_id,
  lb.display_name,
  lb.games_played,
  lb.wins,
  lb.win_rate,
  lb.last_played_at,
  max(pg.total)::int as best_total,
  round(avg(pg.total), 1) as avg_total,
  count(*) filter (where pg.shanghai)::int as shanghais
from public.game_mode_leaderboard lb
join per_game pg on pg.player_id = lb.player_id
where lb.mode = 'shanghai'
group by lb.player_id, lb.display_name, lb.games_played, lb.wins, lb.win_rate, lb.last_played_at;

alter view public.shanghai_leaderboard set (security_invoker = true);

create or replace view public.around_the_clock_leaderboard as
with per_game as (
  select
    gsp.session_id,
    gsp.player_id,
    count(gt.id) as darts,
    coalesce(bool_or(coalesce((gt.meta->>'finished')::boolean, false)), false) as finished
  from public.game_session_players gsp
  join public.game_sessions gs on gs.id = gsp.session_id
  left join public.game_throws gt
    on gt.session_id = gsp.session_id
   and gt.player_id = gsp.player_id
  where gs.status = 'completed' and gs.mode = 'around_the_clock'
  group by gsp.session_id, gsp.player_id
)
select
  lb.player_id,
  lb.display_name,
  lb.games_played,
  lb.wins,
  lb.win_rate,
  lb.last_played_at,
  min(pg.darts) filter (where pg.finished)::int as fewest_darts,
  round(avg(pg.darts) filter (where pg.finished), 1) as avg_darts,
  count(*) filter (where pg.finished)::int as completions
from public.game_mode_leaderboard lb
join per_game pg on pg.player_id = lb.player_id
where lb.mode = 'around_the_clock'
group by lb.player_id, lb.display_name, lb.games_played, lb.wins, lb.win_rate, lb.last_played_at;

alter view public.around_the_clock_leaderboard set (security_invoker = true);

grant select on public.shanghai_leaderboard to anon, authenticated;
grant select on public.around_the_clock_leaderboard to anon, authenticated;
