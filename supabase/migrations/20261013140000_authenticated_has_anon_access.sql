-- Signed-in browsers reach Supabase as `authenticated`, with a token from /api/supabase-token
-- (src/lib/server/supabaseToken.ts), instead of with the anon key every visitor's JavaScript holds.
-- A token must never have less access than the key it replaces, so `authenticated` gets everything
-- `anon` has in public: table, view, sequence and function privileges, and every row-level security
-- policy. Supabase's default privileges already grant both roles together; this covers anything
-- granted to anon alone, here or in the dashboard. Removing anon's access is a later migration.

create or replace function public.grant_authenticated_anon_access()
returns void
language plpgsql
set search_path = public
as $$
declare
  item record;
begin
  for item in
    select format('%I.%I', n.nspname, c.relname) as relation, privilege
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as privilege
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and has_table_privilege('anon', c.oid, privilege)
      and not has_table_privilege('authenticated', c.oid, privilege)
  loop
    execute format('grant %s on %s to authenticated', item.privilege, item.relation);
  end loop;

  for item in
    select format('%I.%I', n.nspname, c.relname) as sequence, privilege
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join unnest(array['USAGE', 'SELECT', 'UPDATE']) as privilege
    where n.nspname = 'public'
      and c.relkind = 'S'
      and case when c.relkind = 'S'
        then has_sequence_privilege('anon', c.oid, privilege) and not has_sequence_privilege('authenticated', c.oid, privilege)
        else false end
  loop
    execute format('grant %s on sequence %s to authenticated', item.privilege, item.sequence);
  end loop;

  for item in
    select p.oid::regprocedure as routine
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and has_function_privilege('anon', p.oid, 'EXECUTE')
      and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
  loop
    execute format('grant execute on routine %s to authenticated', item.routine);
  end loop;

  -- Policies for `public` apply to every role already.
  for item in
    select schemaname, tablename, policyname, roles
    from pg_policies
    where schemaname = 'public'
      and roles @> array['anon']::name[]
      and not roles && array['authenticated', 'public']::name[]
  loop
    execute format(
      'alter policy %I on %I.%I to %s',
      item.policyname, item.schemaname, item.tablename,
      (select string_agg(quote_ident(role), ', ') from unnest(item.roles || array['authenticated']::name[]) as role)
    );
  end loop;
end;
$$;

revoke execute on function public.grant_authenticated_anon_access() from public, anon, authenticated;

select public.grant_authenticated_anon_access();
