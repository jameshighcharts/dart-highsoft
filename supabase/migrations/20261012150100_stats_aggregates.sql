-- The statistics page used to download every leg and match in history (and, for a selected
-- player, every turn plus all its throws in batches of 200) to compute its numbers in the browser.
-- These functions return exactly the rows those computations read, so the numbers are unchanged:
--   stats_overview()                 the global totals and the first/last match time
--   stats_player_detail(player_id)   one player's turns with their darts nested, the legs and
--                                    matches those turns belong to or the player won, and the
--                                    player's segment and adjacency summaries
-- Every query keeps the old filters: matches ended early are excluded, tiebreak turns are not.

-- Legs, turns and throws carry a NOT NULL match_id (turns and throws through triggers, 0029), and
-- ended_early is NOT NULL, so "rows of matches not ended early" is "all rows minus those of the few
-- matches ended early": two index lookups instead of joining every turn and throw to its match.
create or replace function public.stats_overview()
returns json
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with played as (
    select
      count(*) as total_matches,
      count(*) filter (where m.winner_player_id is not null) as completed_matches,
      min(m.created_at) as first_match_at,
      max(m.created_at) as last_match_at
    from public.matches m
    where m.ended_early = false
  ),
  ended as (
    select m.id from public.matches m where m.ended_early = true
  )
  select json_build_object(
    'total_matches', played.total_matches,
    'completed_matches', played.completed_matches,
    'first_match_at', played.first_match_at,
    'last_match_at', played.last_match_at,
    'total_legs', (select count(*) from public.legs)
      - (select count(*) from public.legs l where l.match_id in (select id from ended)),
    'total_turns', (select count(*) from public.turns)
      - (select count(*) from public.turns t where t.match_id in (select id from ended)),
    'total_throws', (select count(*) from public.throws)
      - (select count(*) from public.throws th where th.match_id in (select id from ended))
  )
  from played;
$$;

-- Turns are [id, leg_id, total_scored, busted, turn_number, created_at, darts] with darts as
-- [dart_index, segment, scored]; legs and matches are arrays in the column order of the old
-- PostgREST selects. Positional arrays keep the payload a fraction of the old row objects.
create or replace function public.stats_player_detail(p_player_id uuid)
returns json
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with player_turns as (
    select t.id, t.leg_id, t.total_scored, t.busted, t.turn_number, t.created_at
    from public.turns t
    join public.legs l on l.id = t.leg_id
    join public.matches m on m.id = l.match_id
    where t.player_id = p_player_id and m.ended_early = false
  ),
  player_legs as (
    select l.id, l.match_id, l.leg_number, l.created_at, l.winner_player_id
    from public.legs l
    join public.matches m on m.id = l.match_id
    where m.ended_early = false
      and (l.id in (select pt.leg_id from player_turns pt) or l.winner_player_id = p_player_id)
  ),
  player_matches as (
    select m.id, m.created_at, m.winner_player_id, m.start_score, m.finish
    from public.matches m
    where m.ended_early = false
      and (m.id in (select pl.match_id from player_legs pl) or m.winner_player_id = p_player_id)
  )
  select json_build_object(
    'turns', (
      select coalesce(json_agg(json_build_array(
        pt.id, pt.leg_id, pt.total_scored, pt.busted, pt.turn_number, pt.created_at,
        (
          select coalesce(json_agg(json_build_array(th.dart_index, th.segment, th.scored) order by th.dart_index), '[]'::json)
          from public.throws th
          where th.turn_id = pt.id
        )
      ) order by pt.created_at, pt.id), '[]'::json)
      from player_turns pt
    ),
    'legs', (
      select coalesce(json_agg(json_build_array(pl.id, pl.match_id, pl.leg_number, pl.created_at, pl.winner_player_id)
        order by pl.created_at, pl.id), '[]'::json)
      from player_legs pl
    ),
    'matches', (
      select coalesce(json_agg(json_build_array(pm.id, pm.created_at, pm.winner_player_id, pm.start_score, pm.finish)
        order by pm.created_at, pm.id), '[]'::json)
      from player_matches pm
    ),
    'segments', (
      select coalesce(json_agg(s), '[]'::json)
      from public.player_segment_summary s
      where s.player_id = p_player_id
    ),
    'adjacency', (
      select coalesce(json_agg(a), '[]'::json)
      from public.player_adjacency_stats a
      where a.player_id = p_player_id
    )
  );
$$;

revoke all on function public.stats_overview() from public;
revoke all on function public.stats_player_detail(uuid) from public;
grant execute on function public.stats_overview() to anon, authenticated, service_role;
grant execute on function public.stats_player_detail(uuid) to anon, authenticated, service_role;
