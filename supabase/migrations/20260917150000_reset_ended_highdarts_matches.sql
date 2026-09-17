begin;

create function public.end_match_early_atomic(p_match_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  m public.matches%rowtype;
  f public.highdarts_fixtures%rowtype;
begin
  select * into m from public.matches where id = p_match_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Match not found';
  end if;
  if m.winner_player_id is not null or (m.completed_at is not null and not m.ended_early) then
    raise exception using errcode = '55000', message = 'Match is already completed';
  end if;
  if m.tournament_match_id is not null then
    raise exception using errcode = '42501', message = 'Cannot end a tournament bracket match early';
  end if;

  if m.highdarts_fixture_id is not null then
    select * into f from public.highdarts_fixtures where id = m.highdarts_fixture_id for update;
    if not found or f.match_id is distinct from m.id then
      raise exception using errcode = '55000', message = 'Fixture no longer belongs to this match';
    end if;
    if f.slack_message_ts is not null then
      raise exception using errcode = '55000', message = 'A published result must be corrected by an organiser';
    end if;
    perform 1 from public.background_jobs
      where deduplication_key = 'highdarts_result:' || f.id::text for update;
    if exists (select 1 from public.background_jobs
      where deduplication_key = 'highdarts_result:' || f.id::text and status = 'dispatching') then
      raise exception using errcode = '55000', message = 'Result delivery is in progress. Try again shortly';
    end if;
    delete from public.background_jobs where deduplication_key = 'highdarts_result:' || f.id::text;
    -- The fixture foreign key clears match_id; scoring and board assignment leave with the abandoned match.
    delete from public.matches where id = m.id;
    return jsonb_build_object('ok', true, 'resetFixtureId', f.id);
  end if;

  if m.ended_early then
    raise exception using errcode = '55000', message = 'Match is already completed';
  end if;
  update public.matches set ended_early = true, completed_at = now() where id = m.id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.end_match_early_atomic(uuid) from public, anon, authenticated;
grant execute on function public.end_match_early_atomic(uuid) to service_role;

commit;
