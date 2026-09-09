-- A cached TypeScript plan is speculative until the existing commit RPC checks
-- the database revision under lock. Raw events survive stale/failed plans.
create function public.persist_and_commit_scolia_throw(
  p_event jsonb, p_known_match_id uuid default null, p_known_revision text default null,
  p_plan jsonb default null, p_detected jsonb default null
) returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare e public.scolia_events; committed jsonb; prepared jsonb;
begin
  if p_plan is null or p_known_match_id is null or p_known_revision is null then
    return public.persist_and_prepare_scolia_throw(p_event,p_known_match_id,p_known_revision);
  end if;
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
    if e.payload = p_event->'payload' and e.event_type = 'THROW_DETECTED' then
      begin
        committed := public.commit_scolia_x01_throw(e.id,p_known_match_id,p_known_revision,p_plan,p_detected);
      exception when others then committed := null;
      end;
      if committed ? 'accepted' and not coalesce((committed->>'duplicate')::boolean,false) then
        select * into strict e from public.scolia_events where id=e.id;
        return jsonb_build_object('event',to_jsonb(e),'prepared',null,'committed',committed);
      end if;
    end if;
    begin
      prepared := public.prepare_scolia_x01_throw(e.id,null,null);
    exception when others then prepared := null;
    end;
  end if;
  return jsonb_build_object('event',to_jsonb(e),'prepared',prepared);
end;
$$;
revoke all on function public.persist_and_commit_scolia_throw(jsonb,uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.persist_and_commit_scolia_throw(jsonb,uuid,text,jsonb,jsonb) to service_role;
