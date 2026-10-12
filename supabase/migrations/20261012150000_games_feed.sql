-- The /games page used to download every match (with players and legs) and every game session,
-- then split, search, filter and count them in the browser. These functions return only what the
-- page shows: the live games, keyset-paginated pages of finished games, and per-day counts for the
-- heatmap.
--
-- Semantics match the old client code:
-- * A game is listed only if it has at least one player (the old query used inner joins).
-- * Live: X01 matches without winner, completed_at or ended_early; party games with status active.
-- * Player search: case-insensitive substring of any player's display name, ignoring surrounding
--   whitespace; an empty search matches every game.
-- * Days are calendar days in the viewer's time zone.
-- * Newest first; a match sorts before a party game started at the same instant, then id descending.

create index if not exists matches_created_at_id_idx
  on public.matches (created_at desc, id desc);

create index if not exists game_sessions_created_at_id_idx
  on public.game_sessions (created_at desc, id desc);

-- The search needle, or null when the search is empty. Immutable, so it folds to a constant.
create or replace function public.games_feed_needle(p_search text)
returns text
language sql
immutable
as $$
  select nullif(lower(btrim(coalesce(p_search, ''), E' \t\r\n')), '')
$$;

-- One row per listed match / party game. Each reads a single table with no SET clause, so the
-- planner inlines it into the callers and an index on created_at can serve their ordering.
-- Player checks are scalar subqueries, not EXISTS: as filters they only run for rows read.
create or replace function public.games_feed_match_rows(p_search text, p_time_zone text)
returns table (
  kind text, kind_rank int, id uuid, created_at timestamptz, local_day date, is_live boolean,
  mode text, start_score text, finish text, legs_to_win int,
  winner_player_id uuid, completed_at timestamptz, ended_early boolean, status text
)
language sql
stable
security invoker
as $$
  select
    'match'::text, 1, m.id, m.created_at, (m.created_at at time zone p_time_zone)::date,
    m.winner_player_id is null and m.completed_at is null and not m.ended_early,
    m.mode::text, m.start_score::text, m.finish::text, m.legs_to_win,
    m.winner_player_id, m.completed_at, m.ended_early, null::text
  from public.matches m
  where (
    select true
    from public.match_players mp
    join public.players p on p.id = mp.player_id
    where mp.match_id = m.id
      and (
        public.games_feed_needle(p_search) is null
        or strpos(lower(p.display_name), public.games_feed_needle(p_search)) > 0
      )
    limit 1
  )
$$;

create or replace function public.games_feed_session_rows(p_search text, p_time_zone text)
returns table (
  kind text, kind_rank int, id uuid, created_at timestamptz, local_day date, is_live boolean,
  mode text, start_score text, finish text, legs_to_win int,
  winner_player_id uuid, completed_at timestamptz, ended_early boolean, status text
)
language sql
stable
security invoker
as $$
  select
    'game'::text, 0, g.id, g.created_at, (g.created_at at time zone p_time_zone)::date,
    g.status = 'active',
    g.mode::text, null::text, null::text, null::int,
    g.winner_player_id, g.completed_at, g.ended_early, g.status
  from public.game_sessions g
  where g.status in ('active', 'completed', 'ended_early')
    and (
      select true
      from public.game_session_players gp
      join public.players p on p.id = gp.player_id
      where gp.session_id = g.id
        and (
          public.games_feed_needle(p_search) is null
          or strpos(lower(p.display_name), public.games_feed_needle(p_search)) > 0
        )
      limit 1
    )
$$;

-- Legs with a winner, for a match.
create or replace function public.games_feed_legs_won(p_match_id uuid)
returns int
language sql
stable
security invoker
as $$
  select count(*)::int from public.legs l where l.match_id = p_match_id and l.winner_player_id is not null
$$;

-- A game's players in play order, as JSON.
create or replace function public.games_feed_players(p_kind text, p_id uuid)
returns jsonb
language sql
stable
security invoker
as $$
  select coalesce((
    select jsonb_agg(
      jsonb_build_object('id', p.id, 'display_name', p.display_name, 'avatar_url', p.avatar_url, 'play_order', x.play_order)
      order by x.play_order
    )
    from (
      select mp.player_id, mp.play_order from public.match_players mp where p_kind = 'match' and mp.match_id = p_id
      union all
      select gp.player_id, gp.play_order from public.game_session_players gp where p_kind = 'game' and gp.session_id = p_id
    ) x
    join public.players p on p.id = x.player_id
  ), '[]'::jsonb)
$$;

-- Live X01 matches are found through this index instead of walking every match ever played.
-- (Live party games use game_sessions_active_idx.)
create index if not exists matches_live_created_at_id_idx
  on public.matches (created_at desc, id desc)
  where winner_player_id is null and completed_at is null and ended_early = false;

-- Every live game, newest first. The predicates are literals so the partial indexes apply even
-- through PostgREST, which passes arguments as parameters rather than constants.
create or replace function public.games_live()
returns table (
  kind text, id uuid, created_at timestamptz, mode text, start_score text, finish text,
  legs_to_win int, winner_player_id uuid, completed_at timestamptz, ended_early boolean,
  status text, legs_won int, players jsonb
)
language sql
stable
security invoker
as $$
  with live as (
    select r.*
    from public.games_feed_match_rows(null, 'UTC') r
    where r.winner_player_id is null and r.completed_at is null and r.ended_early = false
    union all
    select r.*
    from public.games_feed_session_rows(null, 'UTC') r
    where r.status = 'active'
  )
  select
    live.kind, live.id, live.created_at, live.mode, live.start_score, live.finish,
    live.legs_to_win, live.winner_player_id, live.completed_at, live.ended_early, live.status,
    case when live.kind = 'match' then public.games_feed_legs_won(live.id) end,
    public.games_feed_players(live.kind, live.id)
  from live
  order by live.created_at desc, live.kind_rank desc, live.id desc
$$;

-- One page of finished games (won, completed or ended early), newest first: a match sorts before a
-- party game started at the same instant, then id descending. Pages are keyset-paginated: pass the
-- last row of the previous page as p_before_* to get the next one (none for the first page).
--
-- PostgREST passes arguments as parameters, so every filter is written as a range on created_at
-- (or a row comparison on (created_at, id)) that the created_at indexes can use whatever the
-- values: no "p_x is null or ..." branches.
create or replace function public.games_feed(
  p_search text default null,
  p_day date default null,
  p_time_zone text default 'UTC',
  p_limit int default 20,
  p_before_created_at timestamptz default null,
  p_before_kind text default null,
  p_before_id uuid default null
)
returns table (
  kind text, id uuid, created_at timestamptz, mode text, start_score text, finish text,
  legs_to_win int, winner_player_id uuid, completed_at timestamptz, ended_early boolean,
  status text, legs_won int, players jsonb
)
language sql
stable
security invoker
-- No SET clause (every name is qualified), so the function inlines into the caller's query.
as $$
  -- Each kind is read newest first from its own index and cut at the page size before merging,
  -- so a page reads about p_limit rows of each table instead of every game.
  with page as (
    (
      select r.*
      from public.games_feed_match_rows(p_search, p_time_zone) r
      where not (r.winner_player_id is null and r.completed_at is null and r.ended_early = false)
        and r.created_at >= coalesce(p_day::timestamp at time zone p_time_zone, '-infinity')
        and r.created_at < coalesce((p_day + 1)::timestamp at time zone p_time_zone, 'infinity')
        -- After a match cursor: same instant with a smaller id, or older. After a party game
        -- cursor: strictly older (matches at that instant came first).
        and (r.created_at, r.id) < (
          coalesce(p_before_created_at, 'infinity'),
          case when p_before_kind = 'match' then p_before_id else '00000000-0000-0000-0000-000000000000'::uuid end
        )
      order by r.created_at desc, r.id desc
      limit p_limit
    )
    union all
    (
      select r.*
      from public.games_feed_session_rows(p_search, p_time_zone) r
      where r.status in ('completed', 'ended_early')
        and r.created_at >= coalesce(p_day::timestamp at time zone p_time_zone, '-infinity')
        and r.created_at < coalesce((p_day + 1)::timestamp at time zone p_time_zone, 'infinity')
        -- After a party game cursor: same instant with a smaller id, or older. After a match
        -- cursor: that instant or older (timestamps have microsecond precision).
        and (r.created_at, r.id) < (
          case when p_before_kind = 'match' then p_before_created_at + interval '1 microsecond'
               else coalesce(p_before_created_at, 'infinity') end,
          case when p_before_kind = 'game' then p_before_id else '00000000-0000-0000-0000-000000000000'::uuid end
        )
      order by r.created_at desc, r.id desc
      limit p_limit
    )
    order by created_at desc, kind_rank desc, id desc
    limit p_limit
  )
  select
    page.kind, page.id, page.created_at, page.mode, page.start_score, page.finish,
    page.legs_to_win, page.winner_player_id, page.completed_at, page.ended_early, page.status,
    case when page.kind = 'match' then public.games_feed_legs_won(page.id) end,
    public.games_feed_players(page.kind, page.id)
  from page
  order by page.created_at desc, page.kind_rank desc, page.id desc
$$;

-- Games started per day (live and finished) from p_from on, for the activity heatmap.
create or replace function public.games_activity(
  p_from date,
  p_search text default null,
  p_time_zone text default 'UTC'
)
returns table (day date, games int)
language sql
stable
security invoker
as $$
  with started as (
    -- local_day >= p_from, in a form the created_at indexes can use.
    select r.local_day from public.games_feed_match_rows(p_search, p_time_zone) r
    where r.created_at >= (p_from::timestamp at time zone p_time_zone)
    union all
    select r.local_day from public.games_feed_session_rows(p_search, p_time_zone) r
    where r.created_at >= (p_from::timestamp at time zone p_time_zone)
  )
  select local_day, count(*)::int from started group by local_day order by local_day
$$;

-- games_feed and games_activity run as the caller, so the caller needs the helpers too;
-- RLS on the underlying tables still applies.
grant execute on function public.games_feed_needle(text) to anon, authenticated;
grant execute on function public.games_feed_match_rows(text, text) to anon, authenticated;
grant execute on function public.games_feed_session_rows(text, text) to anon, authenticated;
grant execute on function public.games_feed_legs_won(uuid) to anon, authenticated;
grant execute on function public.games_feed_players(text, uuid) to anon, authenticated;
grant execute on function public.games_live() to anon, authenticated;
grant execute on function public.games_feed(text, date, text, int, timestamptz, text, uuid) to anon, authenticated;
grant execute on function public.games_activity(date, text, text) to anon, authenticated;
