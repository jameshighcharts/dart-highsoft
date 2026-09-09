begin;
insert into public.players (id, display_name, is_test) values
 ('b0120000-0000-4000-8000-000000000001','Buller regression A',false),
 ('b0120000-0000-4000-8000-000000000002','Buller regression B',false),
 ('b0120000-0000-4000-8000-000000000003','Buller regression test',true),
 ('b0120000-0000-4000-8000-000000000004','Buller regression misses',false),
 ('b0120000-0000-4000-8000-000000000005','Buller regression zero',false);
insert into public.matches (id, mode, start_score, finish, legs_to_win, bull_off) values
 ('b0120000-0000-4000-8000-000000000010','x01','301','double_out',1,'{"phase":"complete"}'),
 ('b0120000-0000-4000-8000-000000000011','x01','301','double_out',1,'{"phase":"throwing"}');
insert into public.bull_off_throws (match_id, player_id, round, distance_mm) values
 ('b0120000-0000-4000-8000-000000000010','b0120000-0000-4000-8000-000000000001',1,25.4),
 ('b0120000-0000-4000-8000-000000000010','b0120000-0000-4000-8000-000000000001',2,76.2),
 ('b0120000-0000-4000-8000-000000000010','b0120000-0000-4000-8000-000000000002',1,25.4),
 ('b0120000-0000-4000-8000-000000000010','b0120000-0000-4000-8000-000000000002',2,null),
 ('b0120000-0000-4000-8000-000000000010','b0120000-0000-4000-8000-000000000003',1,0),
 ('b0120000-0000-4000-8000-000000000010','b0120000-0000-4000-8000-000000000004',1,null),
 ('b0120000-0000-4000-8000-000000000010','b0120000-0000-4000-8000-000000000005',1,0),
 ('b0120000-0000-4000-8000-000000000011','b0120000-0000-4000-8000-000000000001',1,0);
do $$
declare r record; ranked uuid[];
begin
  select * into strict r from public.bull_off_leaderboard where player_id='b0120000-0000-4000-8000-000000000001';
  if r.average_inches <> 2 or r.measured_darts <> 2 or r.bull_offs <> 1 then raise exception 'Incorrect averaging/rethrow/completion filter'; end if;
  select * into strict r from public.bull_off_leaderboard where player_id='b0120000-0000-4000-8000-000000000002';
  if r.average_inches <> 1 or r.measured_darts <> 1 or r.misses <> 1 then raise exception 'Misses distorted the average'; end if;
  if exists(select 1 from public.bull_off_leaderboard where player_id in ('b0120000-0000-4000-8000-000000000003','b0120000-0000-4000-8000-000000000004')) then raise exception 'Test/miss-only player ranked'; end if;
  select array_agg(player_id order by average_inches, measured_darts desc, display_name, player_id) into ranked
  from public.bull_off_leaderboard where player_id::text like 'b0120000-%';
  if ranked <> array['b0120000-0000-4000-8000-000000000005','b0120000-0000-4000-8000-000000000002','b0120000-0000-4000-8000-000000000001']::uuid[] then raise exception 'Wrong ascending distance order'; end if;
  if not exists(select 1 from pg_class where oid='public.bull_off_leaderboard'::regclass and reloptions @> array['security_invoker=true']) then raise exception 'View bypasses caller RLS'; end if;
end;
$$;
rollback;
