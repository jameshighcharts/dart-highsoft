-- Wake the service-role worker without exposing private commands or call IDs.
-- Durable tables and periodic reconciliation remain authoritative.
do $$
declare
  target text;
begin
  foreach target in array array['scolia_commands', 'commentary_realtime_sessions', 'commentary_realtime_deliveries']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = target
    ) then
      execute format('alter publication supabase_realtime add table public.%I', target);
    end if;
  end loop;
end;
$$;
