begin;

select plan(1);

insert into public.players (id, display_name)
values
  ('30000000-0000-0000-0000-000000000011', 'Slack Settings Alice'),
  ('30000000-0000-0000-0000-000000000012', 'Slack Settings Bob');

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

do $$
declare
  v_match public.matches%rowtype;
begin
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

select pass('Slack polls carry their X01 settings into the created match');
select * from finish();

rollback;
