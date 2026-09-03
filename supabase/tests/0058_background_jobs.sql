begin;

select plan(1);

insert into public.players (id, display_name)
values
  ('30000000-0000-0000-0000-000000000001', 'Slack Queue Alice'),
  ('30000000-0000-0000-0000-000000000002', 'Slack Queue Bob');

insert into public.slack_dart_polls (
  id,
  team_id,
  channel_id,
  created_by_slack_user_id,
  scheduled_for,
  time_zone
) values (
  '40000000-0000-0000-0000-000000000001',
  'team-test',
  'channel-test',
  'user-test',
  now() + interval '1 hour',
  'Europe/Oslo'
);

do $$
declare
  v_job_id uuid;
  v_match public.matches%rowtype;
begin
  select background_job_id
  into v_job_id
  from public.slack_dart_polls
  where id = '40000000-0000-0000-0000-000000000001';

  if v_job_id is null or not exists (
    select 1
    from public.background_jobs as job
    where job.id = v_job_id
      and job.job_type = 'slack_dart_poll'
      and job.payload = '{"pollId":"40000000-0000-0000-0000-000000000001"}'::jsonb
      and job.status = 'pending'
  ) then
    raise exception 'Slack poll insert did not atomically enqueue its background job';
  end if;

  select *
  into v_match
  from public.create_slack_x01_match_atomic(
    '40000000-0000-0000-0000-000000000001',
    array[
      '30000000-0000-0000-0000-000000000001'::uuid,
      '30000000-0000-0000-0000-000000000002'::uuid
    ]
  );

  if v_match.source_slack_poll_id <> '40000000-0000-0000-0000-000000000001'
     or v_match.start_score <> '501'
     or v_match.finish <> 'double_out'
     or (
       select count(*)
       from public.match_players as match_player
       where match_player.match_id = v_match.id
     ) <> 2
     or not exists (
       select 1
       from public.legs as leg
       where leg.match_id = v_match.id
         and leg.leg_number = 1
         and leg.starting_player_id = '30000000-0000-0000-0000-000000000001'
     ) then
    raise exception 'Slack match RPC did not create the expected match atomically';
  end if;

  begin
    perform *
    from public.create_slack_x01_match_atomic(
      '40000000-0000-0000-0000-000000000001',
      array[
        '30000000-0000-0000-0000-000000000001'::uuid,
        '30000000-0000-0000-0000-000000000002'::uuid
      ]
    );
    raise exception 'Duplicate Slack poll unexpectedly created a second match';
  exception
    when unique_violation then null;
  end;

  if has_table_privilege('anon', 'public.background_jobs', 'select')
     or has_table_privilege('authenticated', 'public.background_jobs', 'select')
     or has_function_privilege(
       'anon',
       'public.create_slack_x01_match_atomic(uuid,uuid[])',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'public.create_slack_x01_match_atomic(uuid,uuid[])',
       'execute'
     )
     or not has_function_privilege(
       'service_role',
       'public.create_slack_x01_match_atomic(uuid,uuid[])',
       'execute'
     ) then
    raise exception 'Slack job table or RPC privileges are incorrect';
  end if;
end;
$$;

select pass('Slack poll jobs and match creation stay atomic and private');
select * from finish();

rollback;
