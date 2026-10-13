-- The browser now reaches Supabase only as `authenticated`, with a short-lived token from
-- /api/supabase-token, and pages are static shells anyone can load. The anon key in their
-- JavaScript must therefore open nothing: public.revoke_anon_access() takes every privilege and
-- policy in public (and the realtime policies) away from `anon` and from PUBLIC, leaving
-- `authenticated` (and `service_role`) with what they had. Storage's public avatar policy stays:
-- avatars are public.
--
-- This only defines it. It runs from a later migration, once production is verified to use tokens
-- (Supabase requests carry the member's token and succeed, Realtime joins): revoking earlier, or
-- while a deploy or the signing key is broken, would cut every browser off.

create or replace function public.revoke_anon_access()
returns void
language plpgsql
set search_path = public
as $$
declare
  item record;
begin
  -- Nothing anon could do may be lost to authenticated (20261013140000_authenticated_has_anon_access).
  perform public.grant_authenticated_anon_access();

  -- PUBLIC too: a grant to every role (from the dashboard, say) reaches anon as well. What
  -- authenticated reaches only through PUBLIC is granted to it directly first.
  for item in
    select format('%I.%I', n.nspname, c.relname) as relation, privilege
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as privilege
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and has_table_privilege('authenticated', c.oid, privilege)
  loop
    execute format('grant %s on %s to authenticated', item.privilege, item.relation);
  end loop;
  revoke all on all tables in schema public from anon, public;
  revoke all on all sequences in schema public from anon, public;

  -- Functions are executable by PUBLIC (every role) by default.
  for item in
    select p.oid::regprocedure as routine
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  loop
    -- `routine` covers procedures as well as functions.
    execute format('grant execute on routine %s to authenticated, service_role', item.routine);
    execute format('revoke execute on routine %s from public, anon', item.routine);
  end loop;

  -- A policy for anon, or for every role (`public`), becomes one for authenticated. The service
  -- role bypasses row-level security.
  for item in
    select schemaname, tablename, policyname, roles
    from pg_policies
    where schemaname in ('public', 'realtime')
      and roles && array['anon', 'public']::name[]
  loop
    execute format(
      'alter policy %I on %I.%I to %s',
      item.policyname, item.schemaname, item.tablename,
      (select string_agg(distinct quote_ident(role), ', ')
       from unnest(array_remove(array_remove(item.roles, 'anon'::name), 'public'::name) || array['authenticated']::name[]) as role)
    );
  end loop;

  -- Tables and functions created later by migrations (run as postgres) don't grant anon either.
  -- Execution by PUBLIC is a database-wide default for functions, which a per-schema default can
  -- only add to, so it is revoked database-wide; every function our migrations create is in public.
  alter default privileges in schema public revoke all on tables from anon;
  alter default privileges in schema public revoke all on sequences from anon;
  alter default privileges in schema public revoke all on functions from anon;
  alter default privileges revoke execute on functions from public;
  alter default privileges in schema public grant execute on functions to authenticated, service_role;
end;
$$;

revoke execute on function public.revoke_anon_access() from public, anon, authenticated;
