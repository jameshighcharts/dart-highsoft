begin;

select plan(4);

select is(
  (select roles from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = 'members receive on match channels'),
  array['authenticated']::name[],
  'only signed-in members receive on match channels'
);
select is(
  (select roles from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = 'members send on match channels'),
  array['authenticated']::name[],
  'only signed-in members send on match channels'
);

select set_config('realtime.topic', 'dart_match_00000000-0000-0000-0000-000000000001', true);
select ok(
  (select bool_and(qual ~ 'dart_match_' and qual ~ 'presence') from pg_policies where policyname = 'members receive on match channels'),
  'the receive policy is scoped to match channels and their broadcast and presence messages'
);
select ok(
  (select with_check ~ 'dart_match_' from pg_policies where policyname = 'members send on match channels'),
  'the send policy is scoped to match channels'
);

select * from finish();
rollback;
