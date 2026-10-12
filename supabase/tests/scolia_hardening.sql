-- Disposable regression for 20261012120000_scolia_hardening. Everything is rolled back.
begin;

insert into public.players (id, display_name) values
  ('31000000-0000-0000-0000-000000000001', 'Hardening Alice'),
  ('31000000-0000-0000-0000-000000000002', 'Hardening Bob');
insert into public.scolia_boards (id, serial_number, name) values
  ('3b000000-0000-0000-0000-000000000001', 'HARDENING-BOARD-1', 'Hardening Board 1');

do $$
declare
  board constant uuid := '3b000000-0000-0000-0000-000000000001';
  alice constant uuid := '31000000-0000-0000-0000-000000000001';
  bob constant uuid := '31000000-0000-0000-0000-000000000002';
  fn text;
  g public.game_sessions;
  t public.game_throws;
  res jsonb;
  prepared jsonb;
  first_event bigint;
  second_event bigint;
  takeout_event bigint;
  failed boolean;
begin
  -- Lock waits on the per-dart path are bounded.
  foreach fn in array array[
    'public.persist_and_commit_scolia_throw(jsonb,uuid,text,jsonb,jsonb)',
    'public.persist_and_commit_scolia_throw_v2(jsonb,uuid,text,jsonb,jsonb)',
    'public.persist_and_prepare_scolia_throw(jsonb,uuid,text)',
    'public.commit_scolia_x01_throw(bigint,uuid,text,jsonb,jsonb)',
    'public.update_bull_off_atomic(uuid,integer,jsonb,bigint)',
    'public.append_scolia_game_throw_atomic(bigint,uuid,uuid,uuid,integer,integer,integer,text,integer,jsonb,numeric,numeric,numeric,numeric,boolean,uuid)',
    'public.finalize_game_session_atomic(uuid,uuid,uuid)'
  ] loop
    assert (select 'lock_timeout=5s' = any(proconfig) from pg_proc where oid = fn::regprocedure),
      format('%s must bound lock waits', fn);
  end loop;
  assert not has_function_privilege('anon', 'public.persist_and_commit_scolia_throw_v2(jsonb,uuid,text,jsonb,jsonb)', 'execute'),
    'Clients must not call the worker RPCs';
  assert not has_function_privilege('authenticated', 'public.prune_scolia_history(integer)', 'execute'),
    'Clients must not run retention';

  select * into g from public.create_game_session_atomic('shanghai', '{"rounds":7,"startNumber":1}'::jsonb,
    array[alice, bob], board);

  -- Old RPC keeps old behaviour (an older worker must not receive the new shape).
  res := public.persist_and_commit_scolia_throw(jsonb_build_object('board_id', board, 'message_id', 'h-1',
    'event_type', 'THROW_DETECTED', 'payload', '{"sector":"S1","bounceout":false}'::jsonb,
    'occurred_at', null, 'received_at', now()));
  first_event := (res#>>'{event,id}')::bigint;
  assert res#>>'{prepared,kind}' = 'legacy', 'v1 persist must keep party games on the legacy path';
  assert public.prepare_scolia_x01_throw(first_event)->>'kind' = 'legacy', 'v1 prepare must be unchanged';

  -- New RPC prepares the whole game in the same round trip.
  prepared := public.prepare_scolia_throw(first_event);
  assert prepared->>'kind' = 'game' and (prepared->>'sessionId')::uuid = g.id, 'v2 must prepare the active game';
  assert jsonb_array_length(prepared#>'{snapshot,players}') = 2, 'snapshot carries the players in play order';
  assert prepared#>>'{snapshot,players,0,display_name}' = 'Hardening Alice', 'snapshot carries display names';
  assert prepared#>>'{snapshot,session,mode}' = 'shanghai', 'snapshot carries the session';
  assert prepared->'takeoutSinceLastThrow' = 'null'::jsonb, 'no previous dart means no takeout comparison';

  -- Append + settle in one transaction.
  select * into strict t from public.append_scolia_game_throw_atomic(first_event, g.id, null, alice, 1, 0, 1, 'S1', 1, '{}'::jsonb);
  assert t.scolia_event_id = first_event, 'append stores the Scolia event id';
  assert (select processing_status from public.scolia_events where id = first_event) = 'processed', 'append settles the event';

  -- A retry after a lost response is handed back as a stale snapshot, not a second dart.
  failed := false;
  begin
    perform public.append_scolia_game_throw_atomic(first_event, g.id, t.id, alice, 1, 0, 2, 'S1', 1, '{}'::jsonb);
  exception when sqlstate '40001' then failed := true;
  end;
  assert failed, 'a settled event must not append again';
  assert (select count(*) from public.game_throws where session_id = g.id) = 1, 'retry must not insert';
  assert public.prepare_scolia_throw(first_event)->>'kind' = 'legacy', 'an already recorded game dart keeps the settle path';

  -- Takeout between darts is reported for the next dart.
  insert into public.scolia_events(board_id, message_id, event_type, payload, processing_status)
    values (board, 'h-takeout', 'TAKEOUT_FINISHED', '{}', 'ignored') returning id into takeout_event;
  res := public.persist_and_commit_scolia_throw_v2(jsonb_build_object('board_id', board, 'message_id', 'h-2',
    'event_type', 'THROW_DETECTED', 'payload', '{"sector":"S1","bounceout":false}'::jsonb,
    'occurred_at', null, 'received_at', now()));
  second_event := (res#>>'{event,id}')::bigint;
  assert res#>>'{prepared,kind}' = 'game', 'v2 persist prepares the game';
  assert (res#>>'{prepared,takeoutSinceLastThrow}')::boolean, 'takeout after the previous dart is seen';
  assert jsonb_array_length(res#>'{prepared,snapshot,throws}') = 1, 'snapshot carries recorded darts';

end;
$$;

-- Retention: old settled noise goes, anything a dart or a round boundary depends on stays.
do $$
declare
  board constant uuid := '3b000000-0000-0000-0000-000000000001';
  -- A board whose every takeout is old: its latest one must survive.
  quiet_board constant uuid := '3b000000-0000-0000-0000-000000000002';
  old_at constant timestamptz := now() - interval '40 days';
  noise bigint;
  pending_old bigint;
  latest_takeout bigint;
  older_takeout bigint;
  fresh bigint;
  referenced bigint;
  sid uuid;
  result jsonb;
begin
  update public.scolia_retention_state set events_pruned_through = 0;
  insert into public.scolia_boards (id, serial_number, name) values (quiet_board, 'HARDENING-BOARD-2', 'Hardening Board 2');
  insert into public.scolia_events(board_id, message_id, event_type, payload, received_at, processing_status)
    values (quiet_board, 'r-old-takeout', 'TAKEOUT_FINISHED', '{}', old_at - interval '1 day', 'ignored') returning id into older_takeout;
  insert into public.scolia_events(board_id, message_id, event_type, payload, received_at, processing_status)
    values (board, 'r-noise', 'SBC_STATUS_CHANGED', '{}', old_at, 'ignored') returning id into noise;
  insert into public.scolia_events(board_id, message_id, event_type, payload, received_at, processing_status)
    values (board, 'r-pending', 'THROW_DETECTED', '{}', old_at, 'pending') returning id into pending_old;
  insert into public.scolia_events(board_id, message_id, event_type, payload, received_at, processing_status)
    values (board, 'r-referenced', 'THROW_DETECTED', '{}', old_at, 'processed') returning id into referenced;
  insert into public.game_throws(session_id, player_id, round_number, turn_index, dart_index, segment, scored, scolia_event_id)
    select g.id, gsp.player_id, 1, 99, 1, 'S1', 1, referenced
    from public.game_sessions g join public.game_session_players gsp on gsp.session_id = g.id
    where g.scolia_board_id = board limit 1;
  insert into public.scolia_events(board_id, message_id, event_type, payload, received_at, processing_status)
    values (quiet_board, 'r-latest-takeout', 'TAKEOUT_FINISHED', '{}', old_at + interval '1 day', 'ignored') returning id into latest_takeout;
  insert into public.scolia_events(board_id, message_id, event_type, payload, received_at, processing_status)
    values (board, 'r-fresh', 'SBC_STATUS_CHANGED', '{}', now(), 'ignored') returning id into fresh;

  insert into public.matches (id, mode, start_score, finish, legs_to_win)
    values ('32000000-0000-0000-0000-000000000002', 'x01', '501', 'double_out', 1);
  insert into public.commentary_realtime_sessions(match_id, client_instance_id, openai_call_id, persona_id, voice, last_seen_at)
    values ('32000000-0000-0000-0000-000000000002', gen_random_uuid(), 'hardening-call', 'chad', 'alloy', now() - interval '2 hours')
    returning id into sid;

  result := public.prune_scolia_history();

  assert not exists(select 1 from public.scolia_events where id = noise), 'old settled noise is deleted';
  assert not exists(select 1 from public.scolia_events where id = older_takeout), 'superseded old takeouts are deleted';
  assert exists(select 1 from public.scolia_events where id = pending_old), 'unsettled events are kept';
  assert exists(select 1 from public.game_throws where scolia_event_id = referenced), 'fixture: a dart references the event';
  assert exists(select 1 from public.scolia_events where id = referenced), 'events a dart references are kept';
  assert exists(select 1 from public.scolia_events where id = latest_takeout), 'the latest takeout per board is kept';
  assert exists(select 1 from public.scolia_events where id = fresh), 'recent events are kept';
  assert (select events_pruned_through from public.scolia_retention_state) < fresh, 'the watermark never passes young rows';
  assert (select status from public.commentary_realtime_sessions where id = sid) = 'closed',
    'abandoned listeners are closed';

  -- A second run rescans nothing behind the watermark and stays idempotent.
  result := public.prune_scolia_history();
  assert (result->>'events')::int = 0, 'second run has nothing left to delete';
end;
$$;

-- X01 through both persist versions: speculative commit, and a failing plan that falls back.
do $$
declare
  a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); board uuid:=gen_random_uuid(); m uuid; l uuid;
  rev text; plan jsonb; res jsonb; fn text;
begin
  insert into public.players(id,display_name,is_test) values(a,'Hardening X01 A',true),(b,'Hardening X01 B',true);
  insert into public.scolia_boards(id,serial_number,name) values(board,board::text,'Hardening x01');
  select id into m from public.create_x01_match_atomic('301','double_out',1,false,array[a,b]);
  update public.matches set scolia_board_id=board where id=m;
  select id into l from public.legs where match_id=m;
  foreach fn in array array['persist_and_commit_scolia_throw','persist_and_commit_scolia_throw_v2'] loop
    -- Cold: no plan, so the event is persisted and prepared with a full snapshot.
    execute format('select public.%I($1)', fn) into res using jsonb_build_object('board_id',board,'message_id',fn||'-cold',
      'event_type','THROW_DETECTED','payload','{"sector":"T20","bounceout":false}'::jsonb,'occurred_at',null,'received_at',now());
    assert res#>>'{prepared,kind}'='x01' and res#>'{prepared,snapshot}' is not null, fn||': cold prepare';
    rev:=res#>>'{prepared,revision}';
    -- Warm: a valid speculative plan commits in the same call.
    plan:=jsonb_build_object('createTurn',not exists(select 1 from public.turns where leg_id=l),'completeTurn',false,'winnerId',null,
      'turn',jsonb_build_object('id',coalesce((select id from public.turns where leg_id=l),gen_random_uuid()),'leg_id',l,'player_id',a,
        'turn_number',1,'total_scored',0,'busted',false,'tiebreak_round',null,
        'throws',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'dart_index',(select count(*)+1 from public.throws t join public.turns u on u.id=t.turn_id where u.leg_id=l)))));
    execute format('select public.%I($1,$2,$3,$4,$5)', fn) into res using jsonb_build_object('board_id',board,'message_id',fn||'-warm',
      'event_type','THROW_DETECTED','payload','{"sector":"T20","bounceout":false}'::jsonb,'occurred_at',null,'received_at',now()),
      m, rev, plan, '{"segment":"T20","scored":60}'::jsonb;
    assert res ? 'committed' and res#>>'{event,processing_status}'='processed', fn||': speculative commit';
    -- Stale: a wrong revision is logged and falls back to a fresh preparation.
    execute format('select public.%I($1,$2,$3,$4,$5)', fn) into res using jsonb_build_object('board_id',board,'message_id',fn||'-stale',
      'event_type','THROW_DETECTED','payload','{"sector":"T20","bounceout":false}'::jsonb,'occurred_at',null,'received_at',now()),
      m, 'not-a-revision', plan, '{"segment":"T20","scored":60}'::jsonb;
    assert not res ? 'committed' and res#>>'{prepared,kind}'='x01' and res#>'{prepared,snapshot}' is not null, fn||': stale plan falls back';
  end loop;
end;
$$;

rollback;
