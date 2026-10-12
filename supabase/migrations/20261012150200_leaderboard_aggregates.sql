-- Leaderboards read aggregates instead of raw history.
--
-- The home leaderboard downloaded every match_players row (to count games played and wins), every
-- match of the last 60 days (to count matches per day) and a week of multiplayer Elo rows (for the
-- weekly climber). PostgREST caps responses at max_rows (1000), so with a long history the counts
-- were computed from an arbitrary subset. These objects return exactly what the page shows; the
-- client keeps its old raw queries as a fallback until this migration is deployed.

-- Games played and wins per player over decided matches (ended-early and undecided ones excluded).
create view public.player_match_records as
select
  mp.player_id,
  count(*)::integer as games_played,
  (count(*) filter (where m.winner_player_id = mp.player_id))::integer as wins
from public.match_players mp
join public.matches m on m.id = mp.match_id
where m.ended_early = false
  and m.winner_player_id is not null
group by mp.player_id;

alter view public.player_match_records set (security_invoker = true);
grant select on public.player_match_records to anon, authenticated;

-- Matches (not ended early) created in each window [p_starts[i], p_ends[i]). The client computes the
-- windows from its own local-day boundaries, so the counts match its bucketing exactly.
create index if not exists idx_matches_created_at_not_ended
  on public.matches (created_at)
  where ended_early = false;

create or replace function public.count_matches_in_windows(p_starts timestamptz[], p_ends timestamptz[])
returns integer[]
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if coalesce(array_length(p_starts, 1), 0) <> coalesce(array_length(p_ends, 1), 0) then
    raise exception 'p_starts and p_ends must have the same length' using errcode = '22023';
  end if;
  if coalesce(array_length(p_starts, 1), 0) > 400 then
    raise exception 'At most 400 windows can be counted at once' using errcode = '22023';
  end if;

  return coalesce((
    select array_agg(coalesce(counts.matches, 0) order by w.ord)
    from unnest(p_starts, p_ends) with ordinality as w(starts_at, ends_at, ord)
    left join lateral (
      select count(*)::integer as matches
      from public.matches m
      where m.ended_early = false
        and m.created_at >= w.starts_at
        and m.created_at < w.ends_at
    ) counts on true
  ), '{}'::integer[]);
end;
$$;

revoke all on function public.count_matches_in_windows(timestamptz[], timestamptz[]) from public;
grant execute on function public.count_matches_in_windows(timestamptz[], timestamptz[]) to anon, authenticated;

-- Each player's multiplayer Elo movement since p_since: the summed change and the rating history
-- (the first rating before, then every rating after, oldest first). Players are ordered by their
-- first rating in the window, the order the client used to break ties.
create or replace function public.get_multi_elo_climbs(p_since timestamptz)
returns table (player_id uuid, rating_change integer, rating_history integer[])
language sql
stable
security invoker
set search_path = ''
as $$
  select
    e.player_id,
    sum(e.rating_change)::integer as rating_change,
    array[(array_agg(e.rating_before order by e.created_at, e.id))[1]]
      || array_agg(e.rating_after order by e.created_at, e.id) as rating_history
  from public.elo_ratings_multi e
  where e.created_at >= p_since
  group by e.player_id
  order by min(e.created_at), e.player_id;
$$;

revoke all on function public.get_multi_elo_climbs(timestamptz) from public;
grant execute on function public.get_multi_elo_climbs(timestamptz) to anon, authenticated;

-- Top round scores walk this index in score order and stop after the first ten that qualify,
-- instead of sorting every turn.
create index if not exists idx_turns_top_scores
  on public.turns (total_scored desc)
  where busted = false;

-- A player's turns in a leg, newest first: the winner's final turn (checkouts) is one index probe.
-- No INCLUDE columns: covering id and total_scored made no measurable read difference, and every
-- turn update on the live scoring path would have to rewrite them.
create index if not exists idx_turns_leg_player_turn
  on public.turns (leg_id, player_id, turn_number desc)
  where tiebreak_round is null;

-- Same rows and columns as before. The winner's final non-tiebreak turn is now looked up once per
-- leg instead of re-computing max(turn_number) for every turn the winner threw.
create or replace view public.checkout_leaderboard as
select
  t.id as turn_id,
  t.player_id,
  p.display_name,
  t.total_scored as score,
  greatest(1::bigint, (
    select count(*)
    from public.throws th
    where th.turn_id = t.id
      and th.segment is not null
      and th.segment <> ''::text
      and th.segment !~~* 'miss%'::text
  )) as darts_used,
  l.created_at as date,
  m.finish
from public.legs l
join public.matches m on l.match_id = m.id
join public.players p on p.id = l.winner_player_id
cross join lateral (
  select last_turn.id, last_turn.player_id, last_turn.total_scored
  from public.turns last_turn
  where last_turn.leg_id = l.id
    and last_turn.player_id = l.winner_player_id
    and last_turn.tiebreak_round is null
  order by last_turn.turn_number desc
  limit 1
) t
where (m.ended_early = false or m.ended_early is null)
  and p.is_active = true
  and p.is_test = false
  and t.total_scored > 0;

-- CREATE OR REPLACE VIEW resets security_invoker (see CLAUDE.md).
alter view public.checkout_leaderboard set (security_invoker = true);
