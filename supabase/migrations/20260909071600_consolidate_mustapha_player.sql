do $$
declare
  v_keep constant uuid := '235e5b43-716e-45f3-afef-7127083a78f4';
  v_imported constant uuid := '832d8ba4-013c-4241-a243-81c97e958f73';
  v_link public.slack_player_links%rowtype;
  v_reference record;
  v_used boolean;
begin
  -- These rows belong to the confirmed production duplicate. Other databases skip it.
  if not exists (select 1 from public.players where id = v_keep)
     and not exists (select 1 from public.players where id = v_imported) then
    return;
  end if;
  if not exists (select 1 from public.players where id = v_keep and display_name = 'mufasa')
     or not exists (select 1 from public.players where id = v_imported and display_name = 'Mustapha') then
    raise exception 'Mustapha consolidation requires the reviewed player records';
  end if;

  select * into strict v_link from public.slack_player_links where player_id = v_imported;
  if v_link.slack_user_id <> 'U080V6ULA' or exists (
    select 1 from public.slack_player_links where player_id = v_keep
  ) then
    raise exception 'Mustapha Slack identities changed since review';
  end if;
  perform public.set_slack_player_link_atomic(v_link.team_id, v_keep, v_link.slack_user_id);
  perform 1 from public.players where id in (v_keep, v_imported) order by id for update;

  -- Refuse to hide an imported record that has acquired history since review.
  for v_reference in
    select c.conrelid::regclass as relation, a.attname as column_name
    from pg_catalog.pg_constraint c
    cross join lateral unnest(c.conkey, c.confkey) as keys(local_key, foreign_key)
    join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = keys.local_key
    join pg_catalog.pg_attribute target on target.attrelid = c.confrelid and target.attnum = keys.foreign_key
    where c.contype = 'f' and c.confrelid = 'public.players'::regclass
      and target.attname = 'id' and c.conrelid <> 'public.slack_player_links'::regclass
  loop
    execute format('select exists (select 1 from %s where %I = $1)', v_reference.relation, v_reference.column_name)
      into v_used using v_imported;
    if v_used then
      raise exception 'Imported Mustapha has history in %, review before consolidation', v_reference.relation;
    end if;
  end loop;

  update public.players
  set display_name = 'Mustapha (imported duplicate)', is_active = false
  where id = v_imported;

  update public.players p
  set display_name = 'Mustapha',
      nicknames = array(
        select nickname from (
          select distinct on (lower(nickname)) nickname, position
          from unnest(p.nicknames || (select nicknames from public.players where id = v_imported) || array['mufasa'])
            with ordinality as names(nickname, position)
          order by lower(nickname), position
        ) deduplicated order by position
      )
  where p.id = v_keep;
end;
$$;
