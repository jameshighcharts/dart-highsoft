begin;

select plan(1);

insert into public.players (id, display_name)
values
  ('10000000-0000-0000-0000-000000000001', 'Integrity Alice'),
  ('10000000-0000-0000-0000-000000000002', 'Integrity Bob');

insert into public.scolia_boards (id, serial_number, name)
values
  ('b0000000-0000-0000-0000-000000000001', 'INTEGRITY-BOARD-1', 'Integrity Board 1'),
  ('b0000000-0000-0000-0000-000000000002', 'INTEGRITY-BOARD-2', 'Integrity Board 2');

do $$
declare
  v_game public.game_sessions%rowtype;
  v_match public.matches%rowtype;
  v_throw public.game_throws%rowtype;
  v_constraint text;
  v_reopened boolean;
  v_count integer;
  v_avg numeric;
begin
  select *
  into v_game
  from public.create_game_session_atomic(
    'shanghai',
    '{"rounds":7,"startNumber":1}'::jsonb,
    array[
      '10000000-0000-0000-0000-000000000001'::uuid,
      '10000000-0000-0000-0000-000000000002'::uuid
    ],
    'b0000000-0000-0000-0000-000000000001'
  );

  if (
    select count(*)
    from public.game_session_players gsp
    where gsp.session_id = v_game.id
  ) <> 2 then
    raise exception 'create_game_session_atomic did not seat every player';
  end if;

  insert into public.matches (
    id,
    mode,
    start_score,
    finish,
    legs_to_win,
    scolia_board_id
  ) values (
    '20000000-0000-0000-0000-000000000001',
    'x01',
    '501',
    'double_out',
    1,
    'b0000000-0000-0000-0000-000000000002'
  );

  begin
    perform *
    from public.create_game_session_atomic(
      'cricket',
      '{}'::jsonb,
      array[
        '10000000-0000-0000-0000-000000000001'::uuid,
        '10000000-0000-0000-0000-000000000002'::uuid
      ],
      'b0000000-0000-0000-0000-000000000002'
    );
    raise exception 'game creation unexpectedly claimed an active match board';
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if sqlerrm <> 'Scolia board already has an active match or game session'
         or v_constraint <> 'scolia_board_single_active_target' then
        raise;
      end if;
  end;

  select *
  into v_match
  from public.create_x01_match_atomic(
    '501',
    'double_out',
    3,
    false,
    array[
      '10000000-0000-0000-0000-000000000002'::uuid,
      '10000000-0000-0000-0000-000000000001'::uuid
    ]
  );

  if (
    select count(*)
    from public.match_players mp
    where mp.match_id = v_match.id
  ) <> 2 or not exists (
    select 1
    from public.legs l
    where l.match_id = v_match.id
      and l.leg_number = 1
      and l.starting_player_id = '10000000-0000-0000-0000-000000000002'
  ) then
    raise exception 'create_x01_match_atomic did not create seats and first leg';
  end if;

  select *
  into v_throw
  from public.append_game_throw_atomic(
    v_game.id,
    null,
    '10000000-0000-0000-0000-000000000001',
    1,
    0,
    1,
    'S1',
    1,
    '{"pointsScored":1,"shanghai":false}'::jsonb,
    p_finalize => true,
    p_winner_player_id => '10000000-0000-0000-0000-000000000001'
  );

  perform *
  from public.create_game_session_atomic(
    'cricket',
    '{}'::jsonb,
    array[
      '10000000-0000-0000-0000-000000000001'::uuid,
      '10000000-0000-0000-0000-000000000002'::uuid
    ],
    'b0000000-0000-0000-0000-000000000001'
  );

  begin
    perform *
    from public.undo_last_game_throw_atomic(v_game.id, v_throw.id, true);
    raise exception 'undo unexpectedly reopened a game onto an occupied board';
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if sqlerrm <> 'Scolia board already has an active match or game session'
         or v_constraint <> 'scolia_board_single_active_target' then
        raise;
      end if;
  end;

  if not exists (
    select 1
    from public.game_sessions gs
    where gs.id = v_game.id
      and gs.status = 'completed'
  ) or not exists (
    select 1
    from public.game_throws gt
    where gt.id = v_throw.id
  ) then
    raise exception 'failed reopen did not roll back the throw deletion';
  end if;

  select *
  into v_game
  from public.create_game_session_atomic(
    'shanghai',
    '{"rounds":7,"startNumber":1}'::jsonb,
    array[
      '10000000-0000-0000-0000-000000000001'::uuid,
      '10000000-0000-0000-0000-000000000002'::uuid
    ]
  );

  select *
  into v_throw
  from public.append_game_throw_atomic(
    v_game.id,
    null,
    '10000000-0000-0000-0000-000000000001',
    1,
    0,
    1,
    'S1',
    1,
    '{"pointsScored":1,"shanghai":false}'::jsonb
  );

  begin
    perform *
    from public.append_game_throw_atomic(
      v_game.id,
      null,
      '10000000-0000-0000-0000-000000000001',
      1,
      0,
      2,
      'S1',
      1,
      '{}'::jsonb
    );
    raise exception 'append unexpectedly accepted a stale tail';
  exception
    when sqlstate '40001' then
      if sqlerrm <> 'stale_game_snapshot' then
        raise;
      end if;
  end;

  begin
    perform *
    from public.append_game_throw_atomic(
      v_game.id,
      v_throw.id,
      '10000000-0000-0000-0000-000000000002',
      1,
      2,
      1,
      'S1',
      1,
      '{}'::jsonb
    );
    raise exception 'append unexpectedly accepted a non-contiguous turn';
  exception
    when check_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if sqlerrm <> 'invalid_game_throw_sequence'
         or v_constraint <> 'game_throws_contiguous_sequence' then
        raise;
      end if;
  end;

  perform *
  from public.finalize_game_session_atomic(
    v_game.id,
    v_throw.id,
    '10000000-0000-0000-0000-000000000001'
  );
  perform *
  from public.finalize_game_session_atomic(
    v_game.id,
    v_throw.id,
    '10000000-0000-0000-0000-000000000001'
  );

  select result.reopened
  into v_reopened
  from public.undo_last_game_throw_atomic(v_game.id, v_throw.id, true) result;

  if not v_reopened
     or not exists (
       select 1
       from public.game_sessions gs
       where gs.id = v_game.id
         and gs.status = 'active'
     )
     or exists (
       select 1
       from public.game_throws gt
       where gt.session_id = v_game.id
     ) then
    raise exception 'undo did not atomically delete and reopen';
  end if;

  select *
  into v_game
  from public.create_game_session_atomic(
    'shanghai',
    '{"rounds":7,"startNumber":1}'::jsonb,
    array[
      '10000000-0000-0000-0000-000000000001'::uuid,
      '10000000-0000-0000-0000-000000000002'::uuid
    ]
  );

  perform *
  from public.append_game_throw_atomic(
    v_game.id,
    null,
    '10000000-0000-0000-0000-000000000001',
    1,
    0,
    1,
    'S1',
    1,
    '{"pointsScored":1,"shanghai":false}'::jsonb,
    p_finalize => true,
    p_winner_player_id => '10000000-0000-0000-0000-000000000001'
  );

  select count(*), max(sl.avg_total)
  into v_count, v_avg
  from public.shanghai_leaderboard sl
  where sl.player_id = '10000000-0000-0000-0000-000000000002';

  if v_count <> 1 or v_avg <> 0 then
    raise exception 'Shanghai leaderboard omitted a zero-throw participant';
  end if;

  select *
  into v_game
  from public.create_game_session_atomic(
    'around_the_clock',
    '{"includeBull":false,"bullRequirement":"any","skipOnDoubleTreble":false,"fairFinish":false}'::jsonb,
    array[
      '10000000-0000-0000-0000-000000000001'::uuid,
      '10000000-0000-0000-0000-000000000002'::uuid
    ]
  );

  perform *
  from public.append_game_throw_atomic(
    v_game.id,
    null,
    '10000000-0000-0000-0000-000000000001',
    1,
    0,
    1,
    'S1',
    1,
    '{"finished":true}'::jsonb,
    p_finalize => true,
    p_winner_player_id => '10000000-0000-0000-0000-000000000001'
  );

  if not exists (
    select 1
    from public.around_the_clock_leaderboard acl
    where acl.player_id = '10000000-0000-0000-0000-000000000002'
      and acl.completions = 0
      and acl.fewest_darts is null
      and acl.avg_darts is null
  ) then
    raise exception 'Around the Clock leaderboard omitted a zero-throw participant';
  end if;

  if exists (
    select 1
    from unnest(array[
      'public.create_game_session_atomic(public.game_session_mode,jsonb,uuid[],uuid)'::regprocedure,
      'public.create_x01_match_atomic(public.x01_start,public.finish_rule,integer,boolean,uuid[],uuid,uuid)'::regprocedure,
      'public.append_game_throw_atomic(uuid,uuid,uuid,integer,integer,integer,text,integer,jsonb,bigint,numeric,numeric,numeric,numeric,boolean,uuid)'::regprocedure,
      'public.undo_last_game_throw_atomic(uuid,uuid,boolean)'::regprocedure,
      'public.finalize_game_session_atomic(uuid,uuid,uuid)'::regprocedure
    ]) as mutation_rpc(function_oid)
    where has_function_privilege('anon', mutation_rpc.function_oid, 'execute')
       or has_function_privilege('authenticated', mutation_rpc.function_oid, 'execute')
       or not has_function_privilege('service_role', mutation_rpc.function_oid, 'execute')
  ) then
    raise exception 'game mutation RPC privileges are incorrect';
  end if;

  if exists (
    select 1
    from pg_proc p
    where p.oid = any(array[
      'public.create_game_session_atomic(public.game_session_mode,jsonb,uuid[],uuid)'::regprocedure,
      'public.create_x01_match_atomic(public.x01_start,public.finish_rule,integer,boolean,uuid[],uuid,uuid)'::regprocedure,
      'public.append_game_throw_atomic(uuid,uuid,uuid,integer,integer,integer,text,integer,jsonb,bigint,numeric,numeric,numeric,numeric,boolean,uuid)'::regprocedure,
      'public.undo_last_game_throw_atomic(uuid,uuid,boolean)'::regprocedure,
      'public.finalize_game_session_atomic(uuid,uuid,uuid)'::regprocedure
    ]::oid[])
      and p.prosecdef
  ) then
    raise exception 'game mutation RPCs must use security invoker';
  end if;

  if exists (
    select 1
    from pg_class c
    where c.oid = any(array[
      'public.shanghai_leaderboard'::regclass,
      'public.around_the_clock_leaderboard'::regclass
    ]::oid[])
      and not coalesce(c.reloptions, '{}'::text[]) @> array['security_invoker=true']
  ) then
    raise exception 'leaderboard views must use security_invoker';
  end if;
end;
$$;

select pass('game session integrity migration');
select * from finish();

rollback;
