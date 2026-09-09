-- Bull-off measurements never enter scoring throws or statistical history.
alter table public.matches add column bull_off jsonb;
create table public.bull_off_events (
  event_id bigint primary key references public.scolia_events(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade
);
create index bull_off_events_match_idx on public.bull_off_events(match_id);
alter table public.bull_off_events enable row level security;
revoke all on public.bull_off_events from anon, authenticated;
grant all on public.bull_off_events to service_role;

-- Queryable history for future bull-off-only leaderboards, separate from X01.
create table public.bull_off_throws (
  id bigint generated always as identity primary key,
  match_id uuid not null references public.matches(id) on delete cascade,
  player_id uuid not null references public.players(id),
  round integer not null check (round > 0),
  distance_mm numeric(7,1) check (distance_mm >= 0 and distance_mm <= 1000),
  scolia_event_id bigint unique references public.scolia_events(id) on delete set null,
  recorded_at timestamptz not null default now(),
  unique(match_id, player_id, round)
);
create index bull_off_throws_player_distance_idx on public.bull_off_throws(player_id, distance_mm)
  where distance_mm is not null;
alter table public.bull_off_throws enable row level security;
grant select on public.bull_off_throws to anon, authenticated;
grant all on public.bull_off_throws to service_role;
grant usage, select on sequence public.bull_off_throws_id_seq to service_role;
create policy bull_off_history_read on public.bull_off_throws for select to anon, authenticated
  using (exists (select 1 from public.matches m where m.id = match_id));

create function public.create_bull_off_match_atomic(
  p_start_score public.x01_start, p_finish public.finish_rule, p_legs_to_win integer,
  p_fair_ending boolean, p_player_ids uuid[], p_scolia_board_id uuid default null,
  p_rematch_of_match_id uuid default null
) returns setof public.matches language plpgsql security invoker set search_path = '' as $$
declare v_match public.matches%rowtype;
begin
  select * into strict v_match from public.create_x01_match_atomic(p_start_score, p_finish,
    p_legs_to_win, p_fair_ending, p_player_ids, p_scolia_board_id, p_rematch_of_match_id);
  update public.matches set bull_off = jsonb_build_object(
    'revision', 0, 'phase', 'throwing', 'round', 1, 'order', to_jsonb(p_player_ids),
    'pending', to_jsonb(p_player_ids), 'distances', (select jsonb_object_agg(id::text, '[]'::jsonb) from unnest(p_player_ids) id),
    'shots', '[]'::jsonb, 'awaitingTakeout', false
  ) where id = v_match.id returning * into v_match;
  return next v_match;
end;
$$;
revoke all on function public.create_bull_off_match_atomic(public.x01_start, public.finish_rule, integer, boolean, uuid[], uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_bull_off_match_atomic(public.x01_start, public.finish_rule, integer, boolean, uuid[], uuid, uuid) to service_role;

-- Only the server's pure state machine may supply a transition. CAS prevents
-- concurrent manual/hardware requests from attributing a dart twice.
create function public.update_bull_off_atomic(p_match_id uuid, p_revision integer, p_state jsonb, p_event_id bigint default null)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_match public.matches%rowtype; v_shot jsonb;
begin
  select * into v_match from public.matches where id = p_match_id for update;
  if not found or v_match.bull_off is null or v_match.bull_off->>'phase' = 'complete'
    or v_match.winner_player_id is not null or v_match.ended_early or v_match.paused_at is not null
    or (v_match.bull_off->>'revision')::integer <> p_revision then return false; end if;
  if (p_state->>'revision')::integer <> p_revision + 1 then raise exception 'Invalid bull-off revision'; end if;
  if p_event_id is not null then
    insert into public.bull_off_events(event_id, match_id) values (p_event_id, p_match_id) on conflict do nothing;
    if not found then return false; end if;
  end if;
  if jsonb_array_length(p_state->'shots') = jsonb_array_length(v_match.bull_off->'shots') + 1 then
    v_shot := p_state->'shots'->-1;
    insert into public.bull_off_throws(match_id, player_id, round, distance_mm, scolia_event_id)
    values(p_match_id, (v_shot->>'playerId')::uuid, (v_shot->>'round')::integer,
      (v_shot->>'distanceMm')::numeric, p_event_id);
  elsif p_state->'shots' is distinct from v_match.bull_off->'shots' then
    raise exception 'Invalid bull-off shot history';
  end if;
  update public.matches set bull_off = p_state where id = p_match_id;
  if p_state->>'phase' = 'complete' then
    -- Vacate unique play-order slots before assigning the ranked positions.
    update public.match_players set play_order = play_order + 100000 where match_id = p_match_id;
    update public.match_players mp set play_order = ranked.ordinality::integer - 1
    from jsonb_array_elements_text(p_state->'order') with ordinality ranked(id, ordinality)
    where mp.match_id = p_match_id and mp.player_id = ranked.id::uuid;
    update public.legs set starting_player_id = (p_state->'order'->>0)::uuid
    where match_id = p_match_id and leg_number = 1;
  end if;
  return true;
end;
$$;
revoke all on function public.update_bull_off_atomic(uuid, integer, jsonb, bigint) from public, anon, authenticated;
grant execute on function public.update_bull_off_atomic(uuid, integer, jsonb, bigint) to service_role;

-- Defense in depth: old clients and direct writes cannot start X01 early.
create function public.guard_bull_off_turn() returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.legs l join public.matches m on m.id = l.match_id
    where l.id = new.leg_id and m.bull_off->>'phase' = 'throwing') then
    raise exception 'Complete closest to bull before scoring';
  end if;
  return new;
end;
$$;
create trigger guard_bull_off_turn before insert on public.turns for each row execute function public.guard_bull_off_turn();

create function public.guard_bull_off_lineup() returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.matches where id = coalesce(new.match_id, old.match_id)
    and bull_off->>'phase' = 'throwing') then
    raise exception 'Player lineup is locked during bull-off';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger guard_bull_off_lineup before insert or update or delete on public.match_players
for each row execute function public.guard_bull_off_lineup();
