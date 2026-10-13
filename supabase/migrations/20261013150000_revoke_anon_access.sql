-- The browser now reaches Supabase only as `authenticated`, with a short-lived token from
-- /api/supabase-token, and pages are static shells anyone can load. The anon key in their
-- JavaScript must therefore open nothing: this takes every privilege and policy in public (and the
-- realtime broadcast policy) away from `anon` and from PUBLIC, leaving `authenticated` (and
-- `service_role`) with what they had. Storage's public avatar policy stays: avatars are public.
--
-- It runs 15 minutes after this migration, from a scheduled job: migrations deploy alongside the
-- frontend, and until the new frontend is live, browsers still use the anon key.

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

  revoke all on all tables in schema public from anon;
  revoke all on all sequences in schema public from anon;

  -- Functions are executable by PUBLIC (every role) by default.
  for item in
    select p.oid::regprocedure as routine
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  loop
    execute format('grant execute on function %s to authenticated, service_role', item.routine);
    execute format('revoke execute on function %s from public, anon', item.routine);
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

create or replace function public.revoke_anon_access_when_due(due timestamptz)
returns void
language plpgsql
set search_path = public
as $$
begin
  if clock_timestamp() < due then
    return;
  end if;
  perform public.revoke_anon_access();
  perform cron.unschedule('revoke-anon-access');
end;
$$;

revoke execute on function public.revoke_anon_access_when_due(timestamptz) from public, anon, authenticated;

select cron.unschedule('revoke-anon-access')
where exists (select 1 from cron.job where jobname = 'revoke-anon-access');

select cron.schedule(
  'revoke-anon-access',
  '* * * * *',
  format('select public.revoke_anon_access_when_due(%L::timestamptz)', now() + interval '15 minutes')
);
