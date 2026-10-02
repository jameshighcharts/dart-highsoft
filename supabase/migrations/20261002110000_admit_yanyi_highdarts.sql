do $$
declare
  eid uuid;
  yanyi constant uuid := '8e40f0ea-0122-4021-a4fa-ea60e82cb937';
  sindre constant uuid := '13bf0418-ba32-4680-a63c-9a2f223bac3d';
  jorgen constant uuid := '37aeaf03-f543-438d-85b3-6aba9c4c06d0';
  jon constant uuid := '36ae9837-7aa9-4db1-84a7-3958bb34ddf9';
  johan constant uuid := 'c31193ac-886d-452f-afe7-a8f2bc60c229';
  mykhailo constant uuid := 'c0a76e57-f57b-4402-b569-e466b506382c';
  replacement public.highdarts_fixtures%rowtype;
  existing_count integer;
  expected record;
begin
  select id into eid from public.highdarts_events where slug = 'highdarts-2026' for update;
  if eid is null or not exists (select 1 from public.players where id in (yanyi,sindre,jorgen,jon,johan,mykhailo)) then
    raise notice 'No production Highdarts identities in this database; no admission needed';
    return;
  end if;
  if (select count(*) from public.players where id in (yanyi,sindre,jorgen,jon,johan,mykhailo) and is_active and not is_test) <> 6 then
    raise exception 'Yanyi admission requires all six reviewed, active player identities';
  end if;
  perform 1 from public.highdarts_fixtures where event_id = eid for update;
  select count(*) into existing_count from public.highdarts_fixtures
    where event_id=eid and stage='group' and office='sogndal';
  if existing_count not in (13,17) then raise exception 'Unexpected Sogndal fixture count'; end if;

  if existing_count = 13 then
    if exists (select 1 from public.highdarts_fixtures where event_id=eid and stage <> 'group') then
      raise exception 'Qualification has started; review the draw before admitting Yanyi';
    end if;
    if exists (select 1 from public.highdarts_fixtures where event_id=eid and yanyi in (player_a_id,player_b_id)) then
      raise exception 'Yanyi already has fixtures; review before admitting';
    end if;
    select * into replacement from public.highdarts_fixtures
      where event_id=eid and stage='group' and office='sogndal' and fixture_no in (7,9)
        and ((player_a_id=sindre and player_b_id=jorgen) or (player_a_id=jorgen and player_b_id=sindre))
        and match_id is null and slack_message_ts is null and counts_for_a and counts_for_b
      order by fixture_no desc limit 1;
    if replacement.id is null then
      raise exception 'No unclaimed, counted Sindre–Jorgen repeat remains; played results and exclusions preserved';
    end if;
    update public.highdarts_fixtures set
      player_a_id=case when player_a_id=sindre then yanyi else player_a_id end,
      player_a_name=case when player_a_id=sindre then 'Yanyi' else player_a_name end,
      player_b_id=case when player_b_id=sindre then yanyi else player_b_id end,
      player_b_name=case when player_b_id=sindre then 'Yanyi' else player_b_name end
      where id=replacement.id;
    insert into public.highdarts_fixtures(event_id,stage,office,fixture_no,player_a_name,player_b_name,player_a_id,player_b_id)
      values (eid,'group','sogndal',14,'Yanyi','Sindre Jensen',yanyi,sindre),
        (eid,'group','sogndal',15,'Yanyi','Jon Skjerdal',yanyi,jon),
        (eid,'group','sogndal',16,'Yanyi','Johan Flo',yanyi,johan),
        (eid,'group','sogndal',17,'Yanyi','Mykhailo Pelykh',yanyi,mykhailo);
  end if;

  -- Check the complete target, including retries, without resetting any counting choices.
  for expected in select * from (values (yanyi,5),(jorgen,5),(sindre,6),(jon,6),(johan,6),(mykhailo,6)) as v(pid,n) loop
    if (select count(*) from public.highdarts_fixtures where event_id=eid and stage='group'
      and office='sogndal' and expected.pid in (player_a_id,player_b_id)) <> expected.n then
      raise exception 'Admission would change the agreed fixture counts';
    end if;
  end loop;
  if (select array_agg(fixture_no order by fixture_no) from public.highdarts_fixtures where event_id=eid and stage='group' and office='sogndal')
      is distinct from array(select generate_series(1,17)) then raise exception 'Unexpected Sogndal fixture numbering'; end if;
  for expected in select * from (values (14,sindre),(15,jon),(16,johan),(17,mykhailo)) as v(n,pid) loop
    if not exists (select 1 from public.highdarts_fixtures where event_id=eid and stage='group' and office='sogndal'
      and fixture_no=expected.n and player_a_id=yanyi and player_b_id=expected.pid) then
      raise exception 'Unexpected Yanyi opponent; admission rolled back';
    end if;
  end loop;
  if (select count(*) from public.highdarts_fixtures where event_id=eid and stage='group' and office='sogndal'
    and fixture_no in (7,9) and yanyi in (player_a_id,player_b_id) and jorgen in (player_a_id,player_b_id)) <> 1 then
    raise exception 'Expected exactly one Yanyi–Jorgen replacement';
  end if;
end;
$$;
