begin;

select plan(6);

select is(
  (select count(*)::int
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as privilege
   where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and has_table_privilege('anon', c.oid, privilege) and not has_table_privilege('authenticated', c.oid, privilege)),
  0,
  'authenticated has every table and view privilege anon has'
);

select is(
  (select count(*)::int
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')
     and not has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  0,
  'authenticated can call every function anon can'
);

select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and roles @> array['anon']::name[] and not roles && array['authenticated', 'public']::name[]),
  0,
  'every policy that lets anon in lets authenticated in'
);

select ok(
  not has_function_privilege('anon', 'public.grant_authenticated_anon_access()', 'execute')
    and not has_function_privilege('authenticated', 'public.grant_authenticated_anon_access()', 'execute'),
  'clients cannot call the grant function'
);

-- A policy for anon alone, as the dashboard could create, is extended by the migration's logic.
create table public.anon_only_probe (id int);
alter table public.anon_only_probe enable row level security;
grant select on public.anon_only_probe to anon;
revoke all on public.anon_only_probe from authenticated;
create policy "anon reads" on public.anon_only_probe for select to anon using (true);

select public.grant_authenticated_anon_access();

select ok(has_table_privilege('authenticated', 'public.anon_only_probe', 'SELECT'), 'an anon-only grant is extended to authenticated');
select is(
  (select roles from pg_policies where tablename = 'anon_only_probe'),
  array['anon', 'authenticated']::name[],
  'an anon-only policy is extended to authenticated'
);

select * from finish();
rollback;
