begin;

select plan(15);

select ok(
  not has_function_privilege('anon', 'public.revoke_anon_access()', 'execute')
    and not has_function_privilege('authenticated', 'public.revoke_anon_access()', 'execute'),
  'clients cannot call the revoke function'
);
select ok(has_table_privilege('anon', 'public.players', 'SELECT'), 'defining it revokes nothing yet');

-- A table granted to every role, as the dashboard could do.
create table public.public_grant_probe (id int);
revoke all on public.public_grant_probe from anon, authenticated;
grant select on public.public_grant_probe to public;

-- What authenticated could do before, to compare after.
create temp table authenticated_before as
select c.oid, privilege
from pg_class c join pg_namespace n on n.oid = c.relnamespace
cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as privilege
where n.nspname = 'public' and c.relkind in ('r', 'v', 'm') and has_table_privilege('authenticated', c.oid, privilege);

select public.revoke_anon_access();

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as privilege
   where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f') and has_table_privilege('anon', c.oid, privilege)),
  0,
  'anon has no privilege on any table or view'
);
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'S'
     and case when c.relkind = 'S' then has_sequence_privilege('anon', c.oid, 'USAGE') else false end),
  0,
  'anon has no sequence'
);
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')),
  0,
  'anon can call no function'
);
select is(
  (select count(*)::int from pg_policies
   where schemaname in ('public', 'realtime') and roles && array['anon', 'public']::name[]),
  0,
  'no policy lets anon (or every role) in'
);
select is(
  (select count(*)::int from authenticated_before b
   where not has_table_privilege('authenticated', b.oid, b.privilege)),
  0,
  'authenticated keeps every table privilege it had'
);
select ok(
  has_function_privilege('authenticated', 'public.games_feed_needle(text)', 'execute')
    and has_function_privilege('service_role', 'public.games_feed_needle(text)', 'execute'),
  'authenticated and the service role can still call functions'
);
select is(
  (select roles from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = 'read live match broadcasts'),
  array['authenticated']::name[],
  'live match broadcasts are for signed-in members only'
);
select ok(not has_table_privilege('anon', 'public.public_grant_probe', 'SELECT'), 'a grant to every role no longer reaches anon');
select ok(has_table_privilege('authenticated', 'public.public_grant_probe', 'SELECT'), 'but authenticated keeps it');

-- Objects created afterwards don't grant anon.
create table public.after_revoke_probe (id int);
create function public.after_revoke_probe_fn() returns int language sql as $$ select 1 $$;
select ok(not has_table_privilege('anon', 'public.after_revoke_probe', 'SELECT'), 'a new table grants anon nothing');
select ok(not has_function_privilege('anon', 'public.after_revoke_probe_fn()', 'execute'), 'a new function is not callable by anon');
select ok(has_function_privilege('authenticated', 'public.after_revoke_probe_fn()', 'execute'), 'a new function is callable by authenticated');

-- Running it again changes nothing.
select lives_ok($$ select public.revoke_anon_access() $$, 'running the revoke again is harmless');

select * from finish();
rollback;
