create function public.sync_slack_player_names(p_team_id text, p_names jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  if nullif(btrim(p_team_id), '') is null or jsonb_typeof(p_names) is distinct from 'array' then
    raise exception 'Invalid Slack name sync input';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_names) as n(slack_user_id text, display_name text)
    where nullif(btrim(n.slack_user_id), '') is null
       or nullif(btrim(n.display_name), '') is null or char_length(n.display_name) > 80
  ) or exists (
    select 1 from jsonb_to_recordset(p_names) as n(slack_user_id text, display_name text)
    group by n.slack_user_id having count(*) > 1
  ) then
    raise exception 'Invalid or duplicate Slack name';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('slack-player-links:' || p_team_id, 0)
  );

  update public.players as p
  set display_name = n.display_name,
      nicknames = case when exists (
        select 1 from unnest(p.nicknames) as nickname
        where lower(nickname) = lower(p.display_name)
      ) then p.nicknames else array_append(p.nicknames, p.display_name) end
  from public.slack_player_links as l,
       jsonb_to_recordset(p_names) as n(slack_user_id text, display_name text)
  where l.team_id = p_team_id and l.slack_user_id = n.slack_user_id
    and p.id = l.player_id and not p.is_test
    and p.display_name is distinct from n.display_name;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.sync_slack_player_names(text, jsonb) from public, anon, authenticated;
grant execute on function public.sync_slack_player_names(text, jsonb) to service_role;
