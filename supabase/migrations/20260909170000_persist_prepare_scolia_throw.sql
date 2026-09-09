-- Persist the recoverable raw event and read revision-checked scoring state in
-- one request. Never overwrite the original payload when hardware retries it.
create function public.persist_and_prepare_scolia_throw(
  p_event jsonb, p_known_match_id uuid default null, p_known_revision text default null
) returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare e public.scolia_events; prepared jsonb;
begin
  if p_event->>'event_type' is distinct from 'THROW_DETECTED' then
    raise exception 'Expected THROW_DETECTED event';
  end if;
  insert into public.scolia_events(board_id,message_id,event_type,payload,occurred_at,received_at)
    values((p_event->>'board_id')::uuid,p_event->>'message_id',p_event->>'event_type',
      p_event->'payload',(p_event->>'occurred_at')::timestamptz,(p_event->>'received_at')::timestamptz)
    on conflict(board_id,message_id) do nothing returning * into e;
  if e.id is null then
    select * into strict e from public.scolia_events
      where board_id=(p_event->>'board_id')::uuid and message_id=p_event->>'message_id';
  end if;
  if e.processing_status not in ('processed','ignored') then
    -- Keep the raw event durable even if preparation fails. The caller then
    -- retries preparation through its existing recoverable ingestion path.
    begin
      prepared := public.prepare_scolia_x01_throw(e.id,p_known_match_id,p_known_revision);
    exception when others then prepared := null;
    end;
  end if;
  return jsonb_build_object('event',to_jsonb(e),'prepared',prepared);
end;
$$;
revoke all on function public.persist_and_prepare_scolia_throw(jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.persist_and_prepare_scolia_throw(jsonb,uuid,text) to service_role;
