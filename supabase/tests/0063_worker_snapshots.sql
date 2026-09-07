begin;

do $$
declare
  a uuid := 'd0630000-0000-0000-0000-000000000001';
  b uuid := 'd0630000-0000-0000-0000-000000000002';
  m uuid;
  l uuid;
  ta uuid;
  tb uuid;
  dart uuid;
  snapshot jsonb;
  revision text;
  source_table text;
begin
  insert into public.players(id, display_name, is_test) values (a, 'Snapshot A', true), (b, 'Snapshot B', true);
  select id into m from public.create_x01_match_atomic('301', 'double_out', 1, false, array[a,b]);
  select id into l from public.legs where match_id = m;
  insert into public.turns(leg_id, player_id, turn_number, total_scored) values (l,a,1,0) returning id into ta;
  insert into public.turns(leg_id, player_id, turn_number, total_scored) values (l,b,2,0) returning id into tb;
  insert into public.throws(turn_id, dart_index, segment, scored) values (ta,1,'S20',20) returning id into dart;

  snapshot := public.load_scolia_match_snapshot(m);
  assert jsonb_array_length(snapshot->'turns') = 2, 'Initial snapshot must include both players';
  assert snapshot#>>'{playerIds,0}' = a::text, 'Player order must be stable';
  snapshot := public.load_scolia_match_snapshot(m,l,ta);
  assert jsonb_array_length(snapshot->'turns') = 1, 'Ordinary settlement must only load actor history';
  assert snapshot#>>'{turns,0,throws,0,segment}' = 'S20', 'Snapshot must contain canonical darts';
  assert public.load_scolia_match_snapshot(m, gen_random_uuid()) is null, 'Wrong leg must not resolve';

  snapshot := public.load_dartiq_telemetry_snapshot(m);
  revision := snapshot->>'revision';
  assert snapshot#>>array['data','turnsByLeg',l::text,'0','throws','0','segment'] = 'S20';
  assert jsonb_array_length(snapshot->'players') = 2, 'Frozen evidence missing';
  snapshot := public.load_dartiq_telemetry_snapshot(m,revision);
  assert snapshot = jsonb_build_object('revision', revision, 'unchanged', true), 'Unchanged response must omit history';

  update public.throws set segment = 'S5', scored = 5 where id = dart;
  snapshot := public.load_dartiq_telemetry_snapshot(m,revision);
  assert snapshot->>'revision' <> revision, 'Correction must invalidate snapshot';
  assert snapshot#>>array['data','turnsByLeg',l::text,'0','throws','0','segment'] = 'S5';
  revision := snapshot->>'revision';
  delete from public.throws where id = dart;
  snapshot := public.load_dartiq_telemetry_snapshot(m,revision);
  assert snapshot->>'revision' <> revision, 'Undo must invalidate snapshot';

  revision := snapshot->>'revision';
  update public.matches set fair_ending = true where id = m;
  assert public.load_dartiq_telemetry_snapshot(m,revision)->>'revision' <> revision, 'Configuration must invalidate snapshot';
  snapshot := public.load_scolia_match_snapshot(m,l,ta);
  assert jsonb_array_length(snapshot->'turns') = 2, 'Fair ending needs the full field';

  foreach source_table in array array['match_players','legs','turns','dartiq_population_evidence','dartiq_player_evidence'] loop
    revision := public.load_dartiq_telemetry_snapshot(m)->>'revision';
    case source_table
      when 'match_players' then update public.match_players set play_order = 3 where match_id = m and player_id = a;
      when 'legs' then update public.legs set starting_player_id = b where id = l;
      when 'turns' then update public.turns set busted = true where id = ta;
      when 'dartiq_population_evidence' then update public.dartiq_population_evidence set content_hash = 'changed' where match_id = m;
      when 'dartiq_player_evidence' then update public.dartiq_player_evidence set content_hash = 'changed' where match_id = m;
    end case;
    assert public.load_dartiq_telemetry_snapshot(m,revision)->>'revision' <> revision,
      'Source mutation must invalidate snapshot: ' || source_table;
  end loop;
  insert into public.throws(turn_id,dart_index,segment,scored) values(ta,1,'S1',1);
  revision := public.load_dartiq_telemetry_snapshot(m)->>'revision';
  delete from public.turns where id = ta;
  snapshot := public.load_dartiq_telemetry_snapshot(m,revision);
  assert snapshot->>'revision' <> revision, 'Cascade deletion must invalidate snapshot';
  assert jsonb_array_length(snapshot#>array['data','turnsByLeg',l::text]) = 1;
  revision := snapshot->>'revision';
  delete from public.matches where id = m;
  assert public.load_dartiq_telemetry_snapshot(m,revision) is null, 'Deleted match must never return unchanged';
  assert not exists(select 1 from public.dartiq_source_revisions where match_id = m);
end;
$$;

do $$
declare signature text;
begin
  foreach signature in array array[
    'public.load_dartiq_telemetry_snapshot(uuid,text)', 'public.load_scolia_match_snapshot(uuid,uuid,uuid)'
  ] loop
    assert not has_function_privilege('anon', signature, 'EXECUTE');
    assert not has_function_privilege('authenticated', signature, 'EXECUTE');
    assert has_function_privilege('service_role', signature, 'EXECUTE');
  end loop;
  assert not has_table_privilege('anon', 'public.dartiq_source_revisions', 'SELECT');
  assert not has_table_privilege('authenticated', 'public.dartiq_source_revisions', 'UPDATE');
  assert (select relrowsecurity from pg_class where oid = 'public.dartiq_source_revisions'::regclass);
end;
$$;

rollback;
