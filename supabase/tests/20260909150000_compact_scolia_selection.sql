begin;
do $$
declare
  ids uuid[];
  m uuid;
  l uuid;
  latest uuid;
  compact jsonb;
  full_snapshot jsonb;
  expected jsonb;
begin
  select array_agg(gen_random_uuid()) into ids from generate_series(1,7);
  insert into public.players(id, display_name, is_test)
    select id, 'Compact selection ' || n, true from unnest(ids) with ordinality as p(id,n);
  select id into m from public.create_x01_match_atomic('301','double_out',1,false,ids);
  select id into l from public.legs where match_id = m;
  compact := public.load_scolia_match_selection(m);
  assert compact->'turns' = '[]'::jsonb and (compact->>'turnCount')::int = 0;
  insert into public.turns(leg_id,player_id,turn_number,total_scored,busted)
    select l, ids[(n-1)%7+1], n, 0, false from generate_series(1,140) n;
  insert into public.throws(turn_id,dart_index,segment,scored)
    select t.id, n, 'Miss', 0 from public.turns t cross join generate_series(1,3) n where t.leg_id = l;
  select id into latest from public.turns where leg_id = l and turn_number = 140;
  compact := public.load_scolia_match_selection(m);
  full_snapshot := public.load_scolia_match_snapshot(m);
  assert (compact->>'turnCount')::int = 140;
  assert jsonb_array_length(compact->'turns') = 1, 'Normal selection must not grow with visit history';
  assert compact#>>'{turns,0,id}' = latest::text;
  assert compact#>>'{turns,0,throw_count}' = '3';
  assert compact#>'{turns,0,throws}' = '[]'::jsonb;
  assert octet_length(compact::text) < octet_length(full_snapshot::text) / 10, 'Long-leg selection should be substantially smaller';
  raise notice 'Normal selection: % bytes versus % bytes raw', octet_length(compact::text), octet_length(full_snapshot::text);

  -- Current raw counts/sums remain authoritative through corrections and undo.
  update public.throws set segment = 'T20', scored = 60 where turn_id = latest and dart_index = 1;
  delete from public.throws where turn_id = latest and dart_index = 3;
  compact := public.load_scolia_match_selection(m);
  assert compact#>>'{turns,0,throw_count}' = '2';
  assert compact#>>'{turns,0,throws_total}' = '60';
  assert public.load_scolia_match_selection(m,gen_random_uuid()) is null;

  update public.matches set fair_ending = true where id = m;
  update public.turns set tiebreak_round = 1 where id = latest;
  compact := public.load_scolia_match_selection(m,l);
  full_snapshot := public.load_scolia_match_snapshot(m,l);
  select jsonb_agg((t - 'throws') || jsonb_build_object('throws','[]'::jsonb,
    'throw_count',jsonb_array_length(t->'throws'),
    'throws_total',(select coalesce(sum((d->>'scored')::int),0) from jsonb_array_elements(t->'throws') d))
    order by (t->>'turn_number')::int) into expected
  from (select jsonb_build_object('id',v->'id','leg_id',v->'leg_id','player_id',v->'player_id',
    'turn_number',v->'turn_number','total_scored',v->'total_scored','busted',v->'busted',
    'tiebreak_round',v->'tiebreak_round','throws',v->'throws') t
    from jsonb_array_elements(full_snapshot->'turns') v) rows;
  assert compact->'turns' = expected, 'Fair ending and tiebreak inputs must equal the raw snapshot summaries';
  raise notice 'Fair-ending selection: % bytes versus % bytes raw', octet_length(compact::text), octet_length(full_snapshot::text);
  assert not has_function_privilege('anon','public.load_scolia_match_selection(uuid,uuid)','EXECUTE');
  assert not has_function_privilege('authenticated','public.load_scolia_match_selection(uuid,uuid)','EXECUTE');
  assert has_function_privilege('service_role','public.load_scolia_match_selection(uuid,uuid)','EXECUTE');
end;
$$;
rollback;
