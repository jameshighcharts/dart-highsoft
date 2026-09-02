-- Party game modes (Cricket, Killer, Shanghai, Around the Clock).
--
-- These games are event-sourced: game_throws is the only scoring input and the
-- application derives state by replaying it. The `meta` column on game_throws
-- stores the engine's description of what each dart did (marks, kills,
-- shanghai, finish) so leaderboards can be plain SQL. It is a snapshot of the
-- rules at throw time; if an engine rule changes, historic KPIs keep the old
-- interpretation.

create type public.game_session_mode as enum ('cricket', 'killer', 'shanghai', 'around_the_clock');

create table public.game_sessions (
  id uuid primary key default uuid_generate_v4(),
  mode public.game_session_mode not null,
  config jsonb not null default '{}'::jsonb,
  status text not null default 'active'
    check (status in ('active', 'completed', 'ended_early')),
  winner_player_id uuid references public.players(id),
  scolia_board_id uuid references public.scolia_boards(id) on delete set null,
  ended_early boolean generated always as (status = 'ended_early') stored,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint game_sessions_lifecycle_check check (
    (status = 'active' and completed_at is null and winner_player_id is null)
    or (status <> 'active' and completed_at is not null)
  )
);

create table public.game_session_players (
  session_id uuid not null references public.game_sessions(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete restrict,
  play_order int not null check (play_order >= 0),
  primary key (session_id, player_id),
  unique (session_id, play_order)
);

create table public.game_throws (
  id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references public.game_sessions(id) on delete cascade,
  player_id uuid not null references public.players(id),
  round_number int not null check (round_number >= 1),
  -- Session-wide 0-based turn counter; turn boundaries are stored, not inferred.
  turn_index int not null check (turn_index >= 0),
  dart_index int not null check (dart_index between 1 and 3),
  segment text not null,
  scored int not null check (scored >= 0 and scored <= 60),
  meta jsonb not null default '{}'::jsonb,
  scolia_event_id bigint unique references public.scolia_events(id) on delete set null,
  impact_x_mm numeric,
  impact_y_mm numeric,
  angle_horizontal_deg numeric,
  angle_vertical_deg numeric,
  created_at timestamptz not null default now(),
  unique (session_id, turn_index, dart_index),
  constraint game_throws_impact_x_range check (impact_x_mm is null or impact_x_mm between -250 and 250),
  constraint game_throws_impact_y_range check (impact_y_mm is null or impact_y_mm between -250 and 250),
  constraint game_throws_angle_horizontal_range check (angle_horizontal_deg is null or angle_horizontal_deg between -90 and 90),
  constraint game_throws_angle_vertical_range check (angle_vertical_deg is null or angle_vertical_deg between -90 and 90)
);

alter table public.game_throws replica identity full;

create index game_sessions_active_idx on public.game_sessions (created_at desc) where status = 'active';
create index game_sessions_mode_completed_idx on public.game_sessions (mode, completed_at desc) where status = 'completed';
create unique index game_sessions_one_active_scolia_board_idx
  on public.game_sessions (scolia_board_id)
  where scolia_board_id is not null and status = 'active';
create index game_session_players_player_idx on public.game_session_players (player_id);
create index game_throws_session_order_idx on public.game_throws (session_id, turn_index, dart_index);
create index game_throws_player_session_idx on public.game_throws (player_id, session_id);

-- Undo commands for game darts need to reference the session (mirrors match_id).
alter table public.scolia_commands
  add column game_session_id uuid references public.game_sessions(id) on delete set null;
create index scolia_commands_game_session_created_idx
  on public.scolia_commands (game_session_id, created_at desc);

-- A Scolia board can drive either one active X01 match or one active game
-- session, never both. The partial unique indexes on each table cover the
-- same-table case; this trigger covers the cross-table case. It raises
-- unique_violation (23505) so API routes keep mapping it to HTTP 409.
-- Insert-only is enough: rows never return to active through the app. If you
-- reopen a row by hand (end-or-fix-match skill), check the other table first.
create function public.assert_scolia_board_unclaimed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.scolia_board_id is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext('scolia_board:' || new.scolia_board_id::text));

  if tg_table_name = 'game_sessions' and new.status <> 'active' then
    return new;
  end if;
  if tg_table_name = 'matches'
     and (new.completed_at is not null or new.winner_player_id is not null or new.ended_early) then
    return new;
  end if;

  if exists (
    select 1 from public.matches m
    where m.scolia_board_id = new.scolia_board_id
      and m.completed_at is null
      and m.winner_player_id is null
      and m.ended_early = false
      and (tg_table_name <> 'matches' or m.id <> new.id)
  ) or exists (
    select 1 from public.game_sessions g
    where g.scolia_board_id = new.scolia_board_id
      and g.status = 'active'
      and (tg_table_name <> 'game_sessions' or g.id <> new.id)
  ) then
    raise unique_violation
      using message = 'Scolia board already has an active match or game session',
            constraint = 'scolia_board_single_active_target';
  end if;

  return new;
end;
$$;

create trigger matches_scolia_board_unclaimed
  before insert on public.matches
  for each row execute function public.assert_scolia_board_unclaimed();

create trigger game_sessions_scolia_board_unclaimed
  before insert on public.game_sessions
  for each row execute function public.assert_scolia_board_unclaimed();

-- Browser clients read; only the service role writes (same as migration 0026).
alter table public.game_sessions enable row level security;
alter table public.game_session_players enable row level security;
alter table public.game_throws enable row level security;

create policy "public read game sessions" on public.game_sessions
  for select to anon, authenticated using (true);
create policy "public read game session players" on public.game_session_players
  for select to anon, authenticated using (true);
create policy "public read game throws" on public.game_throws
  for select to anon, authenticated using (true);

revoke all on public.game_sessions from anon, authenticated;
revoke all on public.game_session_players from anon, authenticated;
revoke all on public.game_throws from anon, authenticated;
grant select on public.game_sessions to anon, authenticated;
grant select on public.game_session_players to anon, authenticated;
grant select on public.game_throws to anon, authenticated;

alter publication supabase_realtime add table public.game_sessions;
alter publication supabase_realtime add table public.game_throws;

-- ---------------------------------------------------------------------------
-- Leaderboards. Completed games only; test players excluded like migration 0023.
-- ---------------------------------------------------------------------------

create view public.game_mode_leaderboard as
select
  gsp.player_id,
  p.display_name,
  gs.mode,
  count(*)::int as games_played,
  count(*) filter (where gs.winner_player_id = gsp.player_id)::int as wins,
  round(
    100.0 * count(*) filter (where gs.winner_player_id = gsp.player_id) / greatest(count(*), 1),
    1
  ) as win_rate,
  max(gs.completed_at) as last_played_at
from public.game_session_players gsp
join public.game_sessions gs on gs.id = gsp.session_id
join public.players p on p.id = gsp.player_id
where gs.status = 'completed'
  and p.display_name not ilike '%test%'
group by gsp.player_id, p.display_name, gs.mode;

alter view public.game_mode_leaderboard set (security_invoker = true);

create view public.cricket_leaderboard as
with per_game as (
  select
    gt.session_id,
    gt.player_id,
    sum(coalesce((gt.meta->>'marks')::int, 0)) as marks,
    count(distinct gt.turn_index) as turns,
    sum(coalesce((gt.meta->>'pointsScored')::int, 0)) as points
  from public.game_throws gt
  join public.game_sessions gs on gs.id = gt.session_id
  where gs.status = 'completed' and gs.mode = 'cricket'
  group by gt.session_id, gt.player_id
)
select
  lb.player_id,
  lb.display_name,
  lb.games_played,
  lb.wins,
  lb.win_rate,
  lb.last_played_at,
  round(sum(pg.marks)::numeric / greatest(sum(pg.turns), 1), 2) as marks_per_round,
  round(avg(pg.points), 1) as avg_points
from public.game_mode_leaderboard lb
join per_game pg on pg.player_id = lb.player_id
where lb.mode = 'cricket'
group by lb.player_id, lb.display_name, lb.games_played, lb.wins, lb.win_rate, lb.last_played_at;

alter view public.cricket_leaderboard set (security_invoker = true);

create view public.killer_leaderboard as
with kills as (
  select gt.player_id, count(*) filter (where (gt.meta->>'kill')::boolean) as kills
  from public.game_throws gt
  join public.game_sessions gs on gs.id = gt.session_id
  where gs.status = 'completed' and gs.mode = 'killer'
  group by gt.player_id
),
eliminated as (
  select (gt.meta->>'eliminatedPlayerId')::uuid as player_id, count(*) as times_eliminated
  from public.game_throws gt
  join public.game_sessions gs on gs.id = gt.session_id
  where gs.status = 'completed' and gs.mode = 'killer'
    and gt.meta->>'eliminatedPlayerId' is not null
  group by 1
)
select
  lb.player_id,
  lb.display_name,
  lb.games_played,
  lb.wins,
  lb.win_rate,
  lb.last_played_at,
  coalesce(k.kills, 0)::int as kills,
  coalesce(e.times_eliminated, 0)::int as times_eliminated
from public.game_mode_leaderboard lb
left join kills k on k.player_id = lb.player_id
left join eliminated e on e.player_id = lb.player_id
where lb.mode = 'killer';

alter view public.killer_leaderboard set (security_invoker = true);

create view public.shanghai_leaderboard as
with per_game as (
  select
    gt.session_id,
    gt.player_id,
    sum(coalesce((gt.meta->>'pointsScored')::int, 0)) as total,
    bool_or(coalesce((gt.meta->>'shanghai')::boolean, false)) as shanghai
  from public.game_throws gt
  join public.game_sessions gs on gs.id = gt.session_id
  where gs.status = 'completed' and gs.mode = 'shanghai'
  group by gt.session_id, gt.player_id
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

create view public.around_the_clock_leaderboard as
with per_game as (
  select
    gt.session_id,
    gt.player_id,
    count(*) as darts,
    bool_or(coalesce((gt.meta->>'finished')::boolean, false)) as finished
  from public.game_throws gt
  join public.game_sessions gs on gs.id = gt.session_id
  where gs.status = 'completed' and gs.mode = 'around_the_clock'
  group by gt.session_id, gt.player_id
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

grant select on public.game_mode_leaderboard to anon, authenticated;
grant select on public.cricket_leaderboard to anon, authenticated;
grant select on public.killer_leaderboard to anon, authenticated;
grant select on public.shanghai_leaderboard to anon, authenticated;
grant select on public.around_the_clock_leaderboard to anon, authenticated;
