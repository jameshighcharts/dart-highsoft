begin;

select plan(1);

insert into public.players (id, display_name, is_test)
values
  ('30000000-0000-0000-0000-000000000011', 'Slack Settings Alice', true),
  ('30000000-0000-0000-0000-000000000012', 'Slack Settings Bob', true);

insert into public.slack_dart_polls (
  id,
  team_id,
  channel_id,
  created_by_slack_user_id,
  scheduled_for,
  time_zone,
  start_score,
  finish,
  legs_to_win
) values (
  '40000000-0000-0000-0000-000000000011',
  'team-test',
  'channel-test',
  'user-test',
  now() + interval '1 hour',
  'Europe/Oslo',
  '301',
  'single_out',
  2
);

insert into public.slack_dart_polls (
  id,
  team_id,
  channel_id,
  created_by_slack_user_id,
  scheduled_for,
  time_zone
) values (
  '40000000-0000-0000-0000-000000000012',
  'team-test',
  'channel-test',
  'user-test',
  now() + interval '2 hours',
  'Europe/Oslo'
);

-- Exercise the same database role as the application, including its grants.
set local role service_role;

do $$
declare
  v_match public.matches%rowtype;
  v_count integer;
  v_players uuid[] := array[
    '30000000-0000-0000-0000-000000000011'::uuid,
    '30000000-0000-0000-0000-000000000012'::uuid
  ];
begin
  if has_function_privilege('anon', 'public.create_slack_x01_match_atomic(uuid,uuid[])', 'execute')
     or has_function_privilege('authenticated', 'public.create_slack_x01_match_atomic(uuid,uuid[])', 'execute') then
    raise exception 'Slack match RPC is exposed to a public client role';
  end if;

  select *
  into v_match
  from public.create_slack_x01_match_atomic(
    '40000000-0000-0000-0000-000000000011',
    array[
      '30000000-0000-0000-0000-000000000011'::uuid,
      '30000000-0000-0000-0000-000000000012'::uuid
    ]
  );

  if v_match.start_score <> '301'
     or v_match.finish <> 'single_out'
     or v_match.legs_to_win <> 2 then
    raise exception 'Slack match RPC ignored the poll settings';
  end if;

  if v_match.source_slack_poll_id is distinct from '40000000-0000-0000-0000-000000000011'::uuid
     or v_match.fair_ending is distinct from false
     or v_match.scolia_board_id is not null then
    raise exception 'Slack match creation changed its source, fair ending, or board assignment';
  end if;

  if (select array_agg(player_id order by play_order)
      from public.match_players where match_id = v_match.id) is distinct from v_players then
    raise exception 'Slack match creation did not preserve the player lineup';
  end if;

  select count(*) into v_count from public.legs
  where match_id = v_match.id and leg_number = 1 and starting_player_id = v_players[1];
  if v_count <> 1 then
    raise exception 'Slack match creation did not create the first leg';
  end if;

  begin
    perform public.create_slack_x01_match_atomic(
      '40000000-0000-0000-0000-000000000011', v_players
    );
    raise exception 'Slack poll created a duplicate match';
  exception when unique_violation then null;
  end;

  begin
    perform public.create_slack_x01_match_atomic(
      '40000000-0000-0000-0000-000000000012', array[v_players[1], v_players[1]]
    );
    raise exception 'Slack match accepted duplicate players';
  exception when invalid_parameter_value then null;
  end;

  begin
    perform public.create_slack_x01_match_atomic(
      '40000000-0000-0000-0000-000000000012',
      array[v_players[1], '30000000-0000-0000-0000-000000000099'::uuid]
    );
    raise exception 'Slack match accepted a missing player';
  exception when no_data_found then null;
  end;

  if exists (select 1 from public.matches
             where source_slack_poll_id = '40000000-0000-0000-0000-000000000012') then
    raise exception 'Rejected Slack match creation left a partial match';
  end if;

  select *
  into v_match
  from public.create_slack_x01_match_atomic(
    '40000000-0000-0000-0000-000000000012',
    array[
      '30000000-0000-0000-0000-000000000011'::uuid,
      '30000000-0000-0000-0000-000000000012'::uuid
    ]
  );

  if v_match.start_score <> '501'
     or v_match.finish <> 'double_out'
     or v_match.legs_to_win <> 1 then
    raise exception 'Slack poll defaults did not produce a one-leg 501 double-out match';
  end if;

  select count(*) into v_count
  from public.slack_dart_polls poll
  join public.background_jobs job on job.id = poll.background_job_id
  where poll.id in (
    '40000000-0000-0000-0000-000000000011',
    '40000000-0000-0000-0000-000000000012'
  )
    and job.job_type = 'slack_dart_poll'
    and job.run_at = poll.scheduled_for
    and job.payload ->> 'pollId' = poll.id::text;
  if v_count <> 2 then
    raise exception 'Slack polls did not enqueue their scheduled finalization jobs';
  end if;

  begin
    insert into public.slack_dart_polls (
      team_id, channel_id, created_by_slack_user_id, scheduled_for, time_zone, legs_to_win
    ) values ('team-test', 'channel-test', 'user-test', now() + interval '3 hours', 'Europe/Oslo', 0);
    raise exception 'Slack poll accepted zero legs to win';
  exception
    when check_violation then null;
  end;
end;
$$;

reset role;

select pass('Slack polls carry their X01 settings into the created match');
select * from finish();

rollback;
