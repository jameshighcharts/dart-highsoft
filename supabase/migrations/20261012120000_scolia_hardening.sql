-- Scolia hot-path hardening.
--
-- 1. Lock waits on the per-dart path give up after 5s instead of queueing behind a
--    stuck transaction. Function-level statement_timeout is not used: Postgres arms
--    that timer when the outer statement starts, so a SET clause cannot shorten it.
-- 2. Party-game darts get a two-round-trip path (persist+prepare, then append+settle),
--    exposed under new names so an older worker keeps the exact old behaviour.
-- 3. Swallowed speculative-commit/prepare failures are logged as warnings.
-- 4. Highdarts scoring takes a shared event lock, so boards no longer commit one at a time.
-- 5. Revision bumps read match_id from the row instead of joining.
-- 6. Hourly bounded retention for Scolia events/commands and commentary deliveries/sessions.

-- ---------------------------------------------------------------------------
-- Preparation: one implementation, old behaviour (x01 only) and new behaviour (+games).
-- ---------------------------------------------------------------------------

-- Everything the TypeScript game engines need to replay a session, in one read.
create function public.load_scolia_game_snapshot(p_session_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'session', (
      select jsonb_build_object('id', g.id, 'mode', g.mode, 'config', g.config, 'status', g.status,
        'winner_player_id', g.winner_player_id, 'scolia_board_id', g.scolia_board_id,
        'created_at', g.created_at, 'completed_at', g.completed_at)
      from public.game_sessions g where g.id = p_session_id),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object('player_id', gsp.player_id, 'play_order', gsp.play_order,
        'display_name', coalesce(p.display_name, 'Unknown')) order by gsp.play_order)
      from public.game_session_players gsp left join public.players p on p.id = gsp.player_id
      where gsp.session_id = p_session_id), '[]'::jsonb),
    'throws', coalesce((
      select jsonb_agg(to_jsonb(gt) order by gt.turn_index, gt.dart_index)
      from (
        select id, session_id, player_id, round_number, turn_index, dart_index, segment, scored, meta,
          scolia_event_id, impact_x_mm, impact_y_mm, angle_horizontal_deg, angle_vertical_deg, created_at
        from public.game_throws where session_id = p_session_id
      ) gt), '[]'::jsonb));
$$;

-- Mirrors hasTakeoutSinceEvent(board, lastThrowEvent, beforeEvent): null when the last
-- dart has no Scolia event on this board, otherwise whether a takeout finished in between.
create function public.scolia_takeout_since_last_game_throw(p_session_id uuid, p_board_id uuid, p_before_event_id bigint)
returns boolean language plpgsql stable security invoker set search_path = '' as $$
declare v_last bigint;
begin
  select scolia_event_id into v_last from public.game_throws
    where session_id = p_session_id order by turn_index desc, dart_index desc limit 1;
  if v_last is null or not exists(select 1 from public.scolia_events where id = v_last and board_id = p_board_id) then
    return null;
  end if;
  return exists(select 1 from public.scolia_events where board_id = p_board_id
    and event_type = 'TAKEOUT_FINISHED' and id > v_last and id < p_before_event_id);
end;
$$;

-- Based on prepare_scolia_x01_throw (20260909160000). With p_with_games, an active party
-- game that owns the board (newest occupant wins, as in findActiveScoliaBoardOccupant)
-- is prepared in full; already-recorded game/bull-off darts keep the legacy settle path.
create function public.prepare_scolia_throw_internal(
  p_event_id bigint, p_known_match_id uuid, p_known_revision text, p_with_games boolean
) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare e public.scolia_events; m public.matches; d public.throws; g public.game_sessions; rev text;
begin
  select * into strict e from public.scolia_events where id=p_event_id;
  select * into d from public.throws where scolia_event_id=e.id;
  if d.id is not null then
    if e.processing_status <> 'processed' then return jsonb_build_object('kind','legacy'); end if;
    return jsonb_build_object('kind','duplicate','matchId',d.match_id,'throwId',d.id,
      'accepted',jsonb_build_object('rows',public.scolia_accepted_dart(d.id),'revision',
        (select revision::text from public.dartiq_source_revisions where match_id=d.match_id)));
  end if;
  if p_with_games and (
    exists(select 1 from public.game_throws where scolia_event_id=e.id)
    or exists(select 1 from public.bull_off_events where event_id=e.id)
  ) then return jsonb_build_object('kind','legacy'); end if;
  if e.processing_status = 'processed' then return jsonb_build_object('kind','ignored','reason','Scolia event already processed'); end if;
  select * into m from public.matches where scolia_board_id=e.board_id and winner_player_id is null
    and completed_at is null and not ended_early and paused_at is null order by created_at desc limit 1;
  if p_with_games then
    select * into g from public.game_sessions where scolia_board_id=e.board_id and status='active'
      order by created_at desc limit 1;
  end if;
  -- A dart held back by an outage must never land in a match or game that began after it was
  -- thrown (same rule as the worker's recoveryAbandonReason).
  if e.received_at is not null and e.received_at < greatest(m.created_at, g.created_at) then
    return jsonb_build_object('kind','ignored','reason','Thrown before the current match or game started');
  end if;
  if p_with_games then
    if g.id is not null and (m.id is null or g.created_at > m.created_at) then
      return jsonb_build_object('kind','game','sessionId',g.id,
        'snapshot',public.load_scolia_game_snapshot(g.id),
        'takeoutSinceLastThrow',public.scolia_takeout_since_last_game_throw(g.id,e.board_id,e.id));
    end if;
  end if;
  -- Bull-off events (and a board with both a newer match and an older game) retain
  -- their established lifecycles.
  if m.id is null or not exists(select 1 from public.legs where match_id=m.id and winner_player_id is null) or m.bull_off->>'phase'='throwing' or exists(
    select 1 from public.game_sessions where scolia_board_id=e.board_id and status='active'
  ) then return jsonb_build_object('kind','legacy'); end if;
  select revision::text into rev from public.dartiq_source_revisions where match_id=m.id;
  return jsonb_build_object('kind','x01','matchId',m.id,'revision',rev) ||
    case when m.id=p_known_match_id and rev=p_known_revision then '{}'::jsonb
    else jsonb_build_object('snapshot',public.load_scolia_match_snapshot(m.id)) end;
end;
$$;

create or replace function public.prepare_scolia_x01_throw(p_event_id bigint, p_known_match_id uuid default null, p_known_revision text default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select public.prepare_scolia_throw_internal(p_event_id, p_known_match_id, p_known_revision, false);
$$;

create function public.prepare_scolia_throw(p_event_id bigint, p_known_match_id uuid default null, p_known_revision text default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select public.prepare_scolia_throw_internal(p_event_id, p_known_match_id, p_known_revision, true);
$$;

-- ---------------------------------------------------------------------------
-- Persist: based on 20260909170000 / 20260909180000, with logged fallbacks.
-- ---------------------------------------------------------------------------

create function public.persist_scolia_throw_event(p_event jsonb)
returns public.scolia_events language plpgsql volatile security invoker set search_path = '' as $$
declare e public.scolia_events;
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
  return e;
end;
$$;

create function public.persist_and_commit_scolia_throw_internal(
  p_event jsonb, p_known_match_id uuid, p_known_revision text, p_plan jsonb, p_detected jsonb, p_with_games boolean
) returns jsonb language plpgsql volatile security invoker set search_path = '' set lock_timeout = '5s' as $$
declare e public.scolia_events; committed jsonb; prepared jsonb; speculative boolean;
begin
  e := public.persist_scolia_throw_event(p_event);
  if e.processing_status not in ('processed','ignored') then
    -- A cached TypeScript plan is speculative until the commit RPC checks the
    -- database revision under lock. Raw events survive stale/failed plans.
    speculative := p_plan is not null and p_known_match_id is not null and p_known_revision is not null;
    if speculative and e.payload = p_event->'payload' and e.event_type = 'THROW_DETECTED' then
      begin
        committed := public.commit_scolia_x01_throw(e.id,p_known_match_id,p_known_revision,p_plan,p_detected);
      exception when others then
        raise warning 'Scolia speculative commit failed for event %: % (SQLSTATE %)', e.id, SQLERRM, SQLSTATE;
        committed := null;
      end;
      if committed ? 'accepted' and not coalesce((committed->>'duplicate')::boolean,false) then
        select * into strict e from public.scolia_events where id=e.id;
        return jsonb_build_object('event',to_jsonb(e),'prepared',null,'committed',committed);
      end if;
    end if;
    -- Keep the raw event durable even if preparation fails; the caller retries
    -- preparation through its recoverable ingestion path.
    begin
      prepared := public.prepare_scolia_throw_internal(e.id,
        case when speculative then null else p_known_match_id end,
        case when speculative then null else p_known_revision end, p_with_games);
    exception when others then
      raise warning 'Scolia prepare failed for event %: % (SQLSTATE %)', e.id, SQLERRM, SQLSTATE;
      prepared := null;
    end;
  end if;
  return jsonb_build_object('event',to_jsonb(e),'prepared',prepared);
end;
$$;

create or replace function public.persist_and_prepare_scolia_throw(
  p_event jsonb, p_known_match_id uuid default null, p_known_revision text default null
) returns jsonb language sql volatile security invoker set search_path = '' set lock_timeout = '5s' as $$
  select public.persist_and_commit_scolia_throw_internal(p_event, p_known_match_id, p_known_revision, null, null, false);
$$;

create or replace function public.persist_and_commit_scolia_throw(
  p_event jsonb, p_known_match_id uuid default null, p_known_revision text default null,
  p_plan jsonb default null, p_detected jsonb default null
) returns jsonb language sql volatile security invoker set search_path = '' set lock_timeout = '5s' as $$
  select public.persist_and_commit_scolia_throw_internal(p_event, p_known_match_id, p_known_revision, p_plan, p_detected, false);
$$;

create function public.persist_and_commit_scolia_throw_v2(
  p_event jsonb, p_known_match_id uuid default null, p_known_revision text default null,
  p_plan jsonb default null, p_detected jsonb default null
) returns jsonb language sql volatile security invoker set search_path = '' set lock_timeout = '5s' as $$
  select public.persist_and_commit_scolia_throw_internal(p_event, p_known_match_id, p_known_revision, p_plan, p_detected, true);
$$;

-- ---------------------------------------------------------------------------
-- Party-game append that also settles the Scolia event in the same transaction.
-- ---------------------------------------------------------------------------

create function public.append_scolia_game_throw_atomic(
  p_event_id bigint,
  p_session_id uuid,
  p_expected_last_throw_id uuid,
  p_player_id uuid,
  p_round_number integer,
  p_turn_index integer,
  p_dart_index integer,
  p_segment text,
  p_scored integer,
  p_meta jsonb,
  p_impact_x_mm numeric default null,
  p_impact_y_mm numeric default null,
  p_angle_horizontal_deg numeric default null,
  p_angle_vertical_deg numeric default null,
  p_finalize boolean default false,
  p_winner_player_id uuid default null
)
returns setof public.game_throws
language plpgsql volatile security invoker set search_path = '' set lock_timeout = '5s'
as $$
declare v_event public.scolia_events; v_throw public.game_throws;
begin
  select * into v_event from public.scolia_events where id = p_event_id for update;
  if not found or v_event.event_type <> 'THROW_DETECTED' then
    raise exception using errcode = '22023', message = 'invalid_scolia_event';
  end if;
  -- Already settled (e.g. a retry after a lost response): let the caller re-read.
  if v_event.processing_status in ('processed', 'ignored') then
    raise exception using errcode = '40001', message = 'stale_game_snapshot';
  end if;
  select * into strict v_throw from public.append_game_throw_atomic(
    p_session_id, p_expected_last_throw_id, p_player_id, p_round_number, p_turn_index, p_dart_index,
    p_segment, p_scored, p_meta, p_event_id, p_impact_x_mm, p_impact_y_mm, p_angle_horizontal_deg,
    p_angle_vertical_deg, p_finalize, p_winner_player_id);
  update public.scolia_events
    set processing_status = 'processed', processed_at = clock_timestamp(), processing_error = null
    where id = p_event_id;
  return next v_throw;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lock-wait bounds on the remaining per-dart mutations.
-- ---------------------------------------------------------------------------

alter function public.commit_scolia_x01_throw(bigint,uuid,text,jsonb,jsonb) set lock_timeout = '5s';
alter function public.update_bull_off_atomic(uuid,integer,jsonb,bigint) set lock_timeout = '5s';
alter function public.append_game_throw_atomic(uuid,uuid,uuid,integer,integer,integer,text,integer,jsonb,bigint,numeric,numeric,numeric,numeric,boolean,uuid)
  set lock_timeout = '5s';
alter function public.finalize_game_session_atomic(uuid,uuid,uuid) set lock_timeout = '5s';

revoke all on function public.load_scolia_game_snapshot(uuid) from public, anon, authenticated;
revoke all on function public.scolia_takeout_since_last_game_throw(uuid,uuid,bigint) from public, anon, authenticated;
revoke all on function public.prepare_scolia_throw_internal(bigint,uuid,text,boolean) from public, anon, authenticated;
revoke all on function public.prepare_scolia_throw(bigint,uuid,text) from public, anon, authenticated;
revoke all on function public.persist_scolia_throw_event(jsonb) from public, anon, authenticated;
revoke all on function public.persist_and_commit_scolia_throw_internal(jsonb,uuid,text,jsonb,jsonb,boolean) from public, anon, authenticated;
revoke all on function public.persist_and_commit_scolia_throw_v2(jsonb,uuid,text,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.append_scolia_game_throw_atomic(bigint,uuid,uuid,uuid,integer,integer,integer,text,integer,jsonb,numeric,numeric,numeric,numeric,boolean,uuid)
  from public, anon, authenticated;
grant execute on function public.load_scolia_game_snapshot(uuid) to service_role;
grant execute on function public.scolia_takeout_since_last_game_throw(uuid,uuid,bigint) to service_role;
grant execute on function public.prepare_scolia_throw_internal(bigint,uuid,text,boolean) to service_role;
grant execute on function public.prepare_scolia_throw(bigint,uuid,text) to service_role;
grant execute on function public.persist_scolia_throw_event(jsonb) to service_role;
grant execute on function public.persist_and_commit_scolia_throw_internal(jsonb,uuid,text,jsonb,jsonb,boolean) to service_role;
grant execute on function public.persist_and_commit_scolia_throw_v2(jsonb,uuid,text,jsonb,jsonb) to service_role;
grant execute on function public.append_scolia_game_throw_atomic(bigint,uuid,uuid,uuid,integer,integer,integer,text,integer,jsonb,numeric,numeric,numeric,numeric,boolean,uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- Highdarts: scoring only needs to exclude draw lock/unlock (which take FOR UPDATE
-- on the event row), not other boards scoring the same event. Based on 20260914163000.
-- ---------------------------------------------------------------------------

create or replace function public.highdarts_guard_draw_scores() returns trigger
language plpgsql security invoker set search_path='' as $$
declare mid uuid; entity jsonb; eid uuid; fixture_stage text;
begin
  entity:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  -- This guard can fire before the match_id stamping triggers; fall back to the parent row.
  -- A wrong caller-supplied match_id is rejected by those triggers in the same statement.
  mid:=(entity->>'match_id')::uuid;
  if mid is null and tg_table_name='turns' then
    select match_id into mid from public.legs where id=(entity->>'leg_id')::uuid;
  elsif mid is null and tg_table_name='throws' then
    select match_id into mid from public.turns where id=(entity->>'turn_id')::uuid;
  end if;
  select f.event_id,f.stage into eid,fixture_stage from public.matches m join public.highdarts_fixtures f on f.id=m.highdarts_fixture_id where m.id=mid;
  if eid is not null then
    -- FOR UPDATE, not FOR SHARE: highdarts_guard_match upgrades to FOR UPDATE on the same row when
    -- a dart completes a match, and two shared holders upgrading would deadlock.
    perform 1 from public.highdarts_events where id=eid for update;
    if fixture_stage in ('group','tiebreak') and exists(select 1 from public.highdarts_fixtures where event_id=eid and stage='final') then
      raise exception using errcode='55000',message='Unlock the finals draw before correcting group scoring'; end if;
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Revision bumps: every tracked table carries match_id (matches uses id). Based on 0063.
-- ---------------------------------------------------------------------------

create or replace function public.bump_dartiq_source_revision() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  old_match uuid;
  new_match uuid;
  source_match uuid;
begin
  -- Both sides matter when a row is reparented; parent triggers cover cascades.
  if TG_TABLE_NAME = 'matches' then
    if TG_OP <> 'INSERT' then old_match := OLD.id; end if;
    if TG_OP <> 'DELETE' then new_match := NEW.id; end if;
  else
    if TG_OP <> 'INSERT' then old_match := OLD.match_id; end if;
    if TG_OP <> 'DELETE' then new_match := NEW.match_id; end if;
    -- Rows written before match_id existed on turns/throws (0029 backfilled them).
    if TG_TABLE_NAME = 'turns' then
      if TG_OP <> 'INSERT' and old_match is null then select match_id into old_match from public.legs where id = OLD.leg_id; end if;
      if TG_OP <> 'DELETE' and new_match is null then select match_id into new_match from public.legs where id = NEW.leg_id; end if;
    elsif TG_TABLE_NAME = 'throws' then
      if TG_OP <> 'INSERT' and old_match is null then select match_id into old_match from public.turns where id = OLD.turn_id; end if;
      if TG_OP <> 'DELETE' and new_match is null then select match_id into new_match from public.turns where id = NEW.turn_id; end if;
    end if;
  end if;
  for source_match in select distinct id from unnest(array[old_match, new_match]) id where id is not null order by id loop
    insert into public.dartiq_source_revisions(match_id, revision)
    select id, nextval('public.dartiq_source_revision_seq') from public.matches where id = source_match
    on conflict (match_id) do update set revision = excluded.revision;
  end loop;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Retention. Runs hourly with a bounded amount of work per run.
-- ---------------------------------------------------------------------------

create table public.scolia_retention_state (
  id boolean primary key default true check (id),
  events_pruned_through bigint not null default 0
);
alter table public.scolia_retention_state enable row level security;
revoke all on public.scolia_retention_state from anon, authenticated;
grant all on public.scolia_retention_state to service_role;
insert into public.scolia_retention_state default values;

create function public.prune_scolia_history(p_max_events integer default 100000)
returns jsonb language plpgsql volatile security invoker set search_path = '' set lock_timeout = '2s' as $$
declare
  v_cutoff constant timestamptz := now() - interval '30 days';
  v_window constant integer := 5000;
  v_from bigint;
  v_to bigint;
  v_all_old boolean;
  v_protected bigint[];
  v_scanned integer := 0;
  v_n integer;
  v_events integer := 0;
  v_commands integer;
  v_sessions integer;
  v_failed integer;
  v_deliveries integer;
begin
  -- The row lock also keeps two overlapping runs from racing on the watermark.
  select events_pruned_through into v_from from public.scolia_retention_state for update;

  -- Keep each board's latest old takeout so "was the round taken out after dart X?"
  -- (hasTakeoutSinceEvent) cannot flip from true to false for any retained dart.
  select coalesce(array_agg(t.id), '{}') into v_protected
  from public.scolia_boards b
  cross join lateral (
    select e.id from public.scolia_events e
    where e.board_id = b.id and e.event_type = 'TAKEOUT_FINISHED'
    order by e.received_at desc limit 1
  ) t;

  -- Walk forward from the watermark in id windows. Rows kept behind it (darts that
  -- scored, protected takeouts) are never rescanned. Events never settled are deleted
  -- too: the worker abandons a dart it could not score within 5 minutes, so a 30-day-old
  -- pending or failed event can never be scored and would otherwise stay forever.
  loop
    exit when v_scanned >= p_max_events;
    select max(w.id), bool_and(w.received_at < v_cutoff) into v_to, v_all_old
    from (select id, received_at from public.scolia_events where id > v_from order by id limit v_window) w;
    exit when v_to is null;

    delete from public.scolia_events e
    where e.id > v_from and e.id <= v_to
      and e.received_at < v_cutoff
      and e.id <> all(v_protected)
      and not exists(select 1 from public.throws t where t.scolia_event_id = e.id)
      and not exists(select 1 from public.game_throws g where g.scolia_event_id = e.id)
      and not exists(select 1 from public.bull_off_events b where b.event_id = e.id)
      and not exists(select 1 from public.bull_off_throws bt where bt.scolia_event_id = e.id);
    get diagnostics v_n = row_count;
    v_events := v_events + v_n;
    v_scanned := v_scanned + v_window;
    -- A window that reaches into the retention period is revisited next run.
    exit when not v_all_old;
    v_from := v_to;
  end loop;
  update public.scolia_retention_state set events_pruned_through = v_from;

  delete from public.scolia_commands where id in (
    select id from public.scolia_commands
    where status in ('acknowledged', 'refused', 'failed')
      and coalesce(completed_at, created_at) < now() - interval '7 days'
    limit 20000);
  get diagnostics v_commands = row_count;

  -- Listeners heartbeat every ~20s and count as live for 45s; an hour of silence is abandoned.
  update public.commentary_realtime_sessions
    set status = 'closed', closed_at = now()
    where status = 'active' and last_seen_at < now() - interval '1 hour';
  get diagnostics v_sessions = row_count;

  update public.commentary_realtime_deliveries d
    set status = 'failed', last_error = 'Listener closed before delivery'
    from public.commentary_realtime_sessions s
    where s.id = d.session_id and s.status = 'closed' and d.status = 'pending';
  get diagnostics v_failed = row_count;

  delete from public.commentary_realtime_deliveries where ctid = any(array(
    select ctid from public.commentary_realtime_deliveries
    where created_at < now() - interval '7 days' limit 20000));
  get diagnostics v_deliveries = row_count;

  return jsonb_build_object('events', v_events, 'eventsPrunedThrough', v_from, 'commands', v_commands,
    'sessionsClosed', v_sessions, 'deliveriesFailed', v_failed, 'deliveries', v_deliveries);
end;
$$;

revoke all on function public.prune_scolia_history(integer) from public, anon, authenticated;
grant execute on function public.prune_scolia_history(integer) to service_role;

create extension if not exists pg_cron;

select cron.unschedule('prune-scolia-history')
where exists (select 1 from cron.job where jobname = 'prune-scolia-history');

select cron.schedule('prune-scolia-history', '41 * * * *', 'select public.prune_scolia_history();');
