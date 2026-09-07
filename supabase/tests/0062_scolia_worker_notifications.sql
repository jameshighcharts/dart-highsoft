\set ON_ERROR_STOP on
begin;
\ir ../migrations/0062_scolia_worker_notifications.sql
\ir ../migrations/0062_scolia_worker_notifications.sql

do $$
declare
  target text;
begin
  foreach target in array array['scolia_commands', 'commentary_realtime_sessions', 'commentary_realtime_deliveries']
  loop
    assert exists (
      select 1 from pg_publication_tables where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = target
    ), format('Missing worker notification publication: %s', target);
    assert (select relrowsecurity from pg_class where oid = format('public.%I', target)::regclass),
      format('RLS must remain enabled: %s', target);
    assert not has_table_privilege('anon', format('public.%I', target), 'SELECT'),
      format('Anonymous clients must not read private worker rows: %s', target);
    assert not has_table_privilege('authenticated', format('public.%I', target), 'SELECT'),
      format('Browser clients must not read private worker rows: %s', target);
    assert has_table_privilege('service_role', format('public.%I', target), 'SELECT'),
      format('Worker must retain read access: %s', target);
  end loop;
end;
$$;
rollback;
