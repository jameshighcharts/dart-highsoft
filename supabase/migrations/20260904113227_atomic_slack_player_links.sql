-- Keep player creation and Slack identity changes inside one transaction.

create function public.claim_slack_player_atomic(
  p_team_id text,
  p_slack_user_id text,
  p_player_id uuid default null,
  p_display_name text default null
)
returns table (player_id uuid, created boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_team_id text := btrim(p_team_id);
  v_slack_user_id text := btrim(p_slack_user_id);
  v_display_name text := nullif(btrim(p_display_name), '');
  v_player public.players%rowtype;
  v_created boolean := false;
begin
  if v_team_id is null or v_team_id = ''
     or v_slack_user_id is null or v_slack_user_id = '' then
    raise exception using errcode = '22023', message = 'invalid_slack_identity';
  end if;

  if (p_player_id is null) = (v_display_name is null) then
    raise exception using errcode = '22023', message = 'provide_player_id_or_display_name';
  end if;

  if v_display_name is not null and char_length(v_display_name) > 80 then
    raise exception using errcode = '22023', message = 'invalid_player_display_name';
  end if;

  -- Identity writes are infrequent. A team-scoped lock gives every writer the
  -- same lock order and lets unique constraints remain the final safeguard.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('slack-player-links:' || v_team_id, 0)
  );

  if exists (
    select 1
    from public.slack_player_links as link
    where link.team_id = v_team_id
      and link.slack_user_id = v_slack_user_id
  ) then
    raise exception using errcode = '23505', message = 'slack_user_already_linked';
  end if;

  if p_player_id is not null then
    select player.*
    into v_player
    from public.players as player
    where player.id = p_player_id
      and player.is_active = true
      and player.is_test = false
    for update;

    if not found then
      raise exception using errcode = 'P0002', message = 'claimable_player_not_found';
    end if;

    if exists (
      select 1
      from public.slack_player_links as link
      where link.team_id = v_team_id
        and link.player_id = v_player.id
    ) then
      raise exception using errcode = '23505', message = 'player_already_linked';
    end if;
  else
    insert into public.players (display_name)
    values (v_display_name)
    returning * into v_player;
    v_created := true;
  end if;

  insert into public.slack_player_links (team_id, slack_user_id, player_id)
  values (v_team_id, v_slack_user_id, v_player.id);

  return query select v_player.id, v_created;
end;
$$;

create function public.set_slack_player_link_atomic(
  p_team_id text,
  p_player_id uuid,
  p_slack_user_id text default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_team_id text := btrim(p_team_id);
  v_slack_user_id text := nullif(btrim(p_slack_user_id), '');
begin
  if v_team_id is null or v_team_id = '' or p_player_id is null then
    raise exception using errcode = '22023', message = 'invalid_slack_link';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('slack-player-links:' || v_team_id, 0)
  );

  perform 1
    from public.players as player
    where player.id = p_player_id
    for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'player_not_found';
  end if;

  delete from public.slack_player_links as link
  where link.team_id = v_team_id
    and (
      link.player_id = p_player_id
      or (v_slack_user_id is not null and link.slack_user_id = v_slack_user_id)
    );

  if v_slack_user_id is not null then
    insert into public.slack_player_links (team_id, slack_user_id, player_id)
    values (v_team_id, v_slack_user_id, p_player_id);
  end if;
end;
$$;

revoke all on function public.claim_slack_player_atomic(text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.claim_slack_player_atomic(text, text, uuid, text)
  to service_role;

revoke all on function public.set_slack_player_link_atomic(text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.set_slack_player_link_atomic(text, uuid, text)
  to service_role;
