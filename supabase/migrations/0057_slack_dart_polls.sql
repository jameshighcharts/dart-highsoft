-- Slack-driven dart polls and private, stable Slack-to-player identity links.

create table if not exists public.slack_dart_polls (
  id uuid primary key default uuid_generate_v4(),
  team_id text not null,
  channel_id text not null,
  message_ts text,
  created_by_slack_user_id text not null,
  scheduled_for timestamptz not null,
  time_zone text not null,
  status text not null default 'open'
    check (status in ('open', 'finalizing', 'completed', 'cancelled')),
  match_id uuid unique references public.matches(id) on delete set null,
  failure_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists slack_dart_polls_message_unique
  on public.slack_dart_polls (team_id, channel_id, message_ts)
  where message_ts is not null;

create unique index if not exists slack_dart_polls_open_request_unique
  on public.slack_dart_polls (
    team_id,
    channel_id,
    created_by_slack_user_id,
    scheduled_for
  )
  where status in ('open', 'finalizing');

create table if not exists public.slack_dart_votes (
  poll_id uuid not null references public.slack_dart_polls(id) on delete cascade,
  slack_user_id text not null,
  display_name text not null,
  choice boolean not null,
  updated_at timestamptz not null default now(),
  primary key (poll_id, slack_user_id)
);

create table if not exists public.slack_player_links (
  team_id text not null,
  slack_user_id text not null,
  player_id uuid not null references public.players(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (team_id, slack_user_id),
  unique (team_id, player_id)
);

alter table public.matches
  add column if not exists source_slack_poll_id uuid
    references public.slack_dart_polls(id) on delete set null;

create unique index if not exists matches_source_slack_poll_unique
  on public.matches (source_slack_poll_id)
  where source_slack_poll_id is not null;

alter table public.slack_dart_polls enable row level security;
alter table public.slack_dart_votes enable row level security;
alter table public.slack_player_links enable row level security;

revoke all on table public.slack_dart_polls from anon, authenticated;
revoke all on table public.slack_dart_votes from anon, authenticated;
revoke all on table public.slack_player_links from anon, authenticated;

create function public.create_slack_x01_match_atomic(
  p_poll_id uuid,
  p_player_ids uuid[]
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

  if not exists (
    select 1 from public.slack_dart_polls where id = p_poll_id
  ) then
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
    '501',
    'double_out',
    1,
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
