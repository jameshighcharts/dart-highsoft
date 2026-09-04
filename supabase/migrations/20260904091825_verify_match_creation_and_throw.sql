-- Production release smoke test. This migration is recorded only if the pause
-- column exists and the real match-write path can create a match and a throw.
-- The successful path removes every row it creates before returning.

do $smoke$
declare
  first_player_id uuid := public.uuid_generate_v4();
  second_player_id uuid := public.uuid_generate_v4();
  created_match public.matches%rowtype;
  first_leg_id uuid;
  first_turn_id uuid;
  created_throw_id uuid;
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'matches'
      and column_name = 'paused_at'
      and data_type = 'timestamp with time zone'
  ) then
    raise exception 'matches.paused_at is missing or has the wrong type';
  end if;

  insert into public.players (id, display_name)
  values
    (first_player_id, '__production_match_smoke_' || first_player_id::text),
    (second_player_id, '__production_match_smoke_' || second_player_id::text);

  select *
  into created_match
  from public.create_x01_match_atomic(
    '501',
    'double_out',
    1,
    false,
    array[first_player_id, second_player_id],
    null
  );

  select id
  into strict first_leg_id
  from public.legs
  where match_id = created_match.id
    and leg_number = 1;

  insert into public.turns (
    leg_id,
    player_id,
    turn_number,
    total_scored,
    busted
  ) values (
    first_leg_id,
    first_player_id,
    1,
    0,
    false
  )
  returning id into first_turn_id;

  insert into public.throws (turn_id, dart_index, segment, scored)
  values (first_turn_id, 1, 'S20', 20)
  returning id into created_throw_id;

  if created_match.paused_at is not null then
    raise exception 'new match unexpectedly started paused';
  end if;

  if not exists (
    select 1
    from public.throws thrown
    where thrown.id = created_throw_id
      and thrown.match_id = created_match.id
      and thrown.scored = 20
  ) then
    raise exception 'match smoke throw was not linked to its match';
  end if;

  delete from public.matches
  where id = created_match.id;

  delete from public.players
  where id in (first_player_id, second_player_id);
end
$smoke$;
