-- Selection never replays individual darts. Keep raw post-insert settlement in
-- load_scolia_match_snapshot, including its concurrent-correction semantics.
create function public.load_scolia_match_selection(
  p_match_id uuid, p_leg_id uuid default null
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'match', to_jsonb(m), 'leg', to_jsonb(l),
    'playerIds', (select coalesce(jsonb_agg(mp.player_id order by mp.play_order), '[]')
      from public.match_players mp where mp.match_id = m.id),
    'turnCount', (select count(*) from public.turns t where t.leg_id = l.id),
    'turns', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'leg_id', t.leg_id, 'player_id', t.player_id,
      'turn_number', t.turn_number, 'total_scored', t.total_scored,
      'busted', t.busted, 'tiebreak_round', t.tiebreak_round,
      'throws', '[]'::jsonb, 'throw_count', d.throw_count, 'throws_total', d.throws_total
    ) order by t.turn_number), '[]')
    from (select * from public.turns where leg_id = l.id
      order by turn_number desc limit case when m.fair_ending then null else 1 end) t
    cross join lateral (select count(*) as throw_count, coalesce(sum(scored), 0) as throws_total
      from public.throws where turn_id = t.id) d)
  )
  from public.matches m
  join lateral (select * from public.legs where match_id = m.id
    and (case when p_leg_id is null then winner_player_id is null else id = p_leg_id end)
    order by leg_number desc limit 1) l on true
  where m.id = p_match_id;
$$;
revoke all on function public.load_scolia_match_selection(uuid, uuid) from public, anon, authenticated;
grant execute on function public.load_scolia_match_selection(uuid, uuid) to service_role;
