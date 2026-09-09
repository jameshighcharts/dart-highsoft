-- Versions let the browser order direct broadcasts against delayed WAL events
-- and HTTP snapshots, including edits to an existing dart ID.
create sequence public.live_scoring_revision_seq;
revoke all on sequence public.live_scoring_revision_seq from public,anon,authenticated;
create function public.stamp_live_scoring_revision() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  new.live_revision := nextval('public.live_scoring_revision_seq')::text;
  return new;
end;
$$;
revoke all on function public.stamp_live_scoring_revision() from public,anon,authenticated;
do $$
declare source_table text;
begin
  foreach source_table in array array['matches','legs','turns','throws'] loop
    execute format('alter table public.%I add column live_revision text',source_table);
    execute format('create trigger stamp_live_scoring_revision before insert or update on public.%I
      for each row execute function public.stamp_live_scoring_revision()',source_table);
  end loop;
end;
$$;

-- Matches are already publicly readable under their table RLS. Reuse that
-- access model for receiving, but only the service role may publish scores.
create policy "read live match broadcasts" on realtime.messages for select to anon,authenticated
using (extension='broadcast' and topic=realtime.topic() and exists (
  select 1 from public.matches m where realtime.topic()='live_match_'||m.id::text
));
