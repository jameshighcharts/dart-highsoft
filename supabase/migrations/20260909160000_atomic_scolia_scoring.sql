-- Trusted service-only optimistic scoring: TypeScript owns the rules, while
-- one database transaction validates the source revision and commits all effects.
create function public.scolia_accepted_dart(p_throw_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select to_jsonb(d) || jsonb_build_object('turn', to_jsonb(t) || jsonb_build_object(
    'throws', (select coalesce(jsonb_agg(to_jsonb(v) order by v.dart_index),'[]') from public.throws v where v.turn_id=t.id),
    'player', jsonb_build_object('id',p.id,'display_name',p.display_name),
    'leg', to_jsonb(l) || jsonb_build_object('match',to_jsonb(m))))
  from public.throws d join public.turns t on t.id=d.turn_id join public.legs l on l.id=t.leg_id
  join public.matches m on m.id=l.match_id join public.players p on p.id=t.player_id where d.id=p_throw_id;
$$;

create function public.prepare_scolia_x01_throw(p_event_id bigint, p_known_match_id uuid default null, p_known_revision text default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare e public.scolia_events; m public.matches; d public.throws; rev text;
begin
  select * into strict e from public.scolia_events where id=p_event_id;
  select * into d from public.throws where scolia_event_id=e.id;
  if d.id is not null then
    if e.processing_status <> 'processed' then return jsonb_build_object('kind','legacy'); end if;
    return jsonb_build_object('kind','duplicate','matchId',d.match_id,'throwId',d.id,
      'accepted',jsonb_build_object('rows',public.scolia_accepted_dart(d.id),'revision',
        (select revision::text from public.dartiq_source_revisions where match_id=d.match_id)));
  end if;
  if e.processing_status = 'processed' then return jsonb_build_object('kind','ignored','reason','Scolia event already processed'); end if;
  select * into m from public.matches where scolia_board_id=e.board_id and winner_player_id is null
    and completed_at is null and not ended_early and paused_at is null order by created_at desc limit 1;
  -- Party-game and bull-off events retain their established atomic lifecycles.
  if m.id is null or not exists(select 1 from public.legs where match_id=m.id and winner_player_id is null) or m.bull_off->>'phase'='throwing' or exists(
    select 1 from public.game_sessions where scolia_board_id=e.board_id and status='active'
  ) then return jsonb_build_object('kind','legacy'); end if;
  select revision::text into rev from public.dartiq_source_revisions where match_id=m.id;
  return jsonb_build_object('kind','x01','matchId',m.id,'revision',rev) ||
    case when m.id=p_known_match_id and rev=p_known_revision then '{}'::jsonb
    else jsonb_build_object('snapshot',public.load_scolia_match_snapshot(m.id)) end;
end;
$$;

create function public.commit_scolia_x01_throw(p_event_id bigint, p_match_id uuid, p_revision text, p_plan jsonb, p_detected jsonb)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare
  e public.scolia_events; m public.matches; l public.legs; d public.throws; t public.turns;
  rev text; tid uuid := (p_plan#>>'{turn,id}')::uuid; lid uuid := (p_plan#>>'{turn,leg_id}')::uuid;
  pid uuid := (p_plan#>>'{turn,player_id}')::uuid;
  winner uuid := (p_plan->>'winnerId')::uuid; ids uuid[]; wins integer; next_starter uuid;
  dart jsonb := p_plan#>'{turn,throws}'->-1; n integer;
begin
  select * into strict e from public.scolia_events where id=p_event_id for update;
  select * into strict m from public.matches where id=p_match_id for update;
  -- Source triggers take this same revision-row lock. A racing mutation either
  -- precedes the revision check or commits after this transaction; deadlocks are retryable.
  select revision::text into rev from public.dartiq_source_revisions where match_id=m.id for update;
  select * into d from public.throws where scolia_event_id=e.id;
  if d.id is not null then
    if d.match_id<>m.id then raise exception 'Scolia event belongs to another match'; end if;
    -- A legacy writer may have inserted the dart without finishing settlement yet.
    if e.processing_status <> 'processed' then return jsonb_build_object('stale',true); end if;
    return jsonb_build_object('duplicate',true,'accepted',jsonb_build_object('rows',public.scolia_accepted_dart(d.id),'revision',rev), 'match',to_jsonb(m));
  end if;
  if rev is distinct from p_revision or m.scolia_board_id is distinct from e.board_id
    or m.completed_at is not null or m.winner_player_id is not null or m.ended_early or m.paused_at is not null
    or m.bull_off->>'phase'='throwing' then return jsonb_build_object('stale',true); end if;
  if e.processing_status='processed' or e.event_type<>'THROW_DETECTED' then raise exception 'Event is not available for scoring'; end if;
  select * into strict l from public.legs where id=lid and match_id=m.id and winner_player_id is null;
  if not exists(select 1 from public.match_players where match_id=m.id and player_id=pid)
    or (winner is not null and not exists(select 1 from public.match_players where match_id=m.id and player_id=winner))
    then raise exception 'Invalid scoring participant'; end if;
  if (p_plan->>'createTurn')::boolean then
    select coalesce(max(turn_number),0)+1 into n from public.turns where leg_id=l.id;
    if n<>(p_plan#>>'{turn,turn_number}')::int then raise exception 'Invalid turn sequence'; end if;
    insert into public.turns(id,leg_id,player_id,turn_number,total_scored,busted,tiebreak_round)
      values(tid,l.id,pid,n,0,false,(p_plan#>>'{turn,tiebreak_round}')::int);
  end if;
  select * into strict t from public.turns where id=tid and leg_id=l.id and player_id=pid;
  select count(*)+1 into n from public.throws where turn_id=t.id;
  if n>3 or n<>(dart->>'dart_index')::int then raise exception 'Invalid dart sequence'; end if;
  insert into public.throws(id,turn_id,dart_index,segment,scored,scolia_event_id,impact_x_mm,impact_y_mm,angle_horizontal_deg,angle_vertical_deg)
    values((dart->>'id')::uuid,t.id,n,p_detected->>'segment',(p_detected->>'scored')::int,e.id,
      (p_detected->>'impactXmm')::double precision,(p_detected->>'impactYmm')::double precision,
      (p_detected->>'angleHorizontalDeg')::double precision,(p_detected->>'angleVerticalDeg')::double precision) returning * into d;
  if (p_plan->>'completeTurn')::boolean then
    update public.turns set total_scored=(p_plan#>>'{turn,total_scored}')::int,busted=(p_plan#>>'{turn,busted}')::boolean where id=t.id;
  end if;
  if winner is not null then
    update public.legs set winner_player_id=winner where id=l.id;
    select array_agg(player_id order by play_order) into ids from public.match_players where match_id=m.id;
    select count(*) into wins from public.legs where match_id=m.id and winner_player_id=winner;
    if wins>=m.legs_to_win then
      update public.matches set winner_player_id=winner,completed_at=clock_timestamp() where id=m.id returning * into m;
      -- Match completion historically tolerates an Elo failure; retain that contract.
      begin
        if cardinality(ids)=2 then
          perform public.update_elo_ratings(m.id,winner,(select id from unnest(ids) id where id<>winner limit 1),32);
        elsif cardinality(ids)>2 then
          perform public.update_elo_ratings_multiplayer(m.id,ids,array(select case when id=winner then 1 else 2 end from unnest(ids) id),32);
        end if;
      exception when others then raise warning 'Scolia Elo update failed for %: %',m.id,SQLERRM;
      end;
    else
      next_starter := ids[coalesce(array_position(ids,l.starting_player_id),0)%cardinality(ids)+1];
      insert into public.legs(match_id,leg_number,starting_player_id)
        select m.id,count(*)+1,coalesce(next_starter,winner) from public.legs where match_id=m.id;
    end if;
    insert into public.background_jobs(job_type,payload,deduplication_key,run_at)
      values('dartiq_completed_leg',jsonb_build_object('matchId',m.id,'legId',l.id),'dartiq_completed_leg:'||l.id,clock_timestamp())
      on conflict(deduplication_key) do nothing;
  end if;
  insert into public.background_jobs(job_type,payload,deduplication_key,run_at)
    values('dartiq_live_throw',jsonb_build_object('matchId',m.id,'throwId',d.id),'dartiq_live_throw:'||d.id,clock_timestamp())
    on conflict(deduplication_key) do nothing;
  update public.scolia_events set processing_status='processed',processed_at=clock_timestamp(),processing_error=null where id=e.id;
  return jsonb_build_object('match',to_jsonb(m),'accepted',jsonb_build_object(
    'rows',public.scolia_accepted_dart(d.id),'previousRevision',p_revision,
    'revision',(select revision::text from public.dartiq_source_revisions where match_id=m.id)));
end;
$$;

revoke all on function public.scolia_accepted_dart(uuid) from public,anon,authenticated;
revoke all on function public.prepare_scolia_x01_throw(bigint,uuid,text) from public,anon,authenticated;
revoke all on function public.commit_scolia_x01_throw(bigint,uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.scolia_accepted_dart(uuid) to service_role;
grant execute on function public.prepare_scolia_x01_throw(bigint,uuid,text) to service_role;
grant execute on function public.commit_scolia_x01_throw(bigint,uuid,text,jsonb,jsonb) to service_role;

-- Edit/undo recomputation must not overwrite a concurrently committed dart with
-- totals calculated from an older read. The actual correction still uses its
-- existing API; this makes its derived turn updates revision-checked and atomic.
create function public.load_x01_recompute_snapshot(p_leg_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('revision',r.revision::text,'snapshot',public.load_scolia_match_snapshot(l.match_id,l.id))
  from public.legs l join public.dartiq_source_revisions r on r.match_id=l.match_id where l.id=p_leg_id;
$$;
create function public.commit_x01_recompute(p_match_id uuid,p_leg_id uuid,p_revision text,p_updates jsonb) returns boolean
language plpgsql volatile security invoker set search_path = '' as $$
declare rev text; u jsonb;
begin
  perform 1 from public.matches where id=p_match_id for update;
  select revision::text into rev from public.dartiq_source_revisions where match_id=p_match_id for update;
  if rev is distinct from p_revision then return false; end if;
  if not exists(select 1 from public.legs where id=p_leg_id and match_id=p_match_id) then raise exception 'Leg does not belong to match'; end if;
  for u in select value from jsonb_array_elements(p_updates) loop
    update public.turns set total_scored=(u->>'total_scored')::integer,busted=(u->>'busted')::boolean
      where id=(u->>'id')::uuid and leg_id=p_leg_id and tiebreak_round is null;
    if not found then raise exception 'Invalid recomputation turn'; end if;
  end loop;
  return true;
end;
$$;
revoke all on function public.load_x01_recompute_snapshot(uuid) from public,anon,authenticated;
revoke all on function public.commit_x01_recompute(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.load_x01_recompute_snapshot(uuid) to service_role;
grant execute on function public.commit_x01_recompute(uuid,uuid,text,jsonb) to service_role;
