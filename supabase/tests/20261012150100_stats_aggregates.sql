-- Disposable regression for 20261012150100_stats_aggregates. Everything is rolled back.
-- stats_overview() and stats_player_detail() must return exactly the rows the statistics page
-- used to download with PostgREST, scoped to one player, so the browser computes the same numbers.
begin;

insert into public.players (id, display_name) values
  ('51000000-0000-0000-0000-000000000001', 'Stats Alice'),
  ('51000000-0000-0000-0000-000000000002', 'Stats Bob'),
  ('51000000-0000-0000-0000-000000000003', 'Stats Carol');

insert into public.matches (id, mode, start_score, finish, legs_to_win, created_at, winner_player_id, ended_early) values
  -- Alice wins 2-1.
  ('5a000000-0000-0000-0000-000000000001', 'x01', '501', 'double_out', 2, '2026-01-01 10:00+00', '51000000-0000-0000-0000-000000000001', false),
  -- Ended early: excluded everywhere.
  ('5a000000-0000-0000-0000-000000000002', 'x01', '301', 'single_out', 1, '2026-01-02 10:00+00', null, true),
  -- Still running, includes a bust.
  ('5a000000-0000-0000-0000-000000000003', 'x01', '201', 'single_out', 1, '2026-01-03 10:00+00', null, false),
  -- Alice is recorded as the winner of a leg and match without any turns of hers.
  ('5a000000-0000-0000-0000-000000000004', 'x01', '501', 'double_out', 1, '2026-01-04 10:00+00', '51000000-0000-0000-0000-000000000001', false),
  -- Bob alone: never part of Alice's detail.
  ('5a000000-0000-0000-0000-000000000005', 'x01', '301', 'single_out', 1, '2026-01-05 10:00+00', '51000000-0000-0000-0000-000000000002', false);

insert into public.legs (id, match_id, leg_number, starting_player_id, winner_player_id, created_at) values
  ('5b000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000001', 1, '51000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', '2026-01-01 10:00+00'),
  ('5b000000-0000-0000-0000-000000000002', '5a000000-0000-0000-0000-000000000001', 2, '51000000-0000-0000-0000-000000000002', '51000000-0000-0000-0000-000000000002', '2026-01-01 10:20+00'),
  ('5b000000-0000-0000-0000-000000000003', '5a000000-0000-0000-0000-000000000001', 3, '51000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', '2026-01-01 10:40+00'),
  ('5b000000-0000-0000-0000-000000000004', '5a000000-0000-0000-0000-000000000002', 1, '51000000-0000-0000-0000-000000000001', null, '2026-01-02 10:00+00'),
  ('5b000000-0000-0000-0000-000000000005', '5a000000-0000-0000-0000-000000000003', 1, '51000000-0000-0000-0000-000000000002', null, '2026-01-03 10:00+00'),
  ('5b000000-0000-0000-0000-000000000006', '5a000000-0000-0000-0000-000000000004', 1, '51000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', '2026-01-04 10:00+00'),
  ('5b000000-0000-0000-0000-000000000007', '5a000000-0000-0000-0000-000000000005', 1, '51000000-0000-0000-0000-000000000002', '51000000-0000-0000-0000-000000000002', '2026-01-05 10:00+00');

-- Turns: [leg, player, number, scored, busted, at]; darts follow per turn.
insert into public.turns (id, leg_id, player_id, turn_number, total_scored, busted, created_at) values
  ('5c000000-0000-0000-0000-000000000001', '5b000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', 1, 180, false, '2026-01-01 10:01+00'),
  ('5c000000-0000-0000-0000-000000000002', '5b000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000002', 2, 41, false, '2026-01-01 10:02+00'),
  ('5c000000-0000-0000-0000-000000000003', '5b000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', 3, 140, false, '2026-01-01 10:03+00'),
  ('5c000000-0000-0000-0000-000000000004', '5b000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', 5, 141, false, '2026-01-01 10:05+00'),
  ('5c000000-0000-0000-0000-000000000005', '5b000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', 7, 40, false, '2026-01-01 10:07+00'),
  ('5c000000-0000-0000-0000-000000000006', '5b000000-0000-0000-0000-000000000002', '51000000-0000-0000-0000-000000000002', 1, 100, false, '2026-01-01 10:21+00'),
  ('5c000000-0000-0000-0000-000000000007', '5b000000-0000-0000-0000-000000000002', '51000000-0000-0000-0000-000000000001', 2, 26, false, '2026-01-01 10:22+00'),
  ('5c000000-0000-0000-0000-000000000008', '5b000000-0000-0000-0000-000000000003', '51000000-0000-0000-0000-000000000001', 1, 60, false, '2026-01-01 10:41+00'),
  -- Two turns with the same timestamp: the id breaks the tie.
  ('5c000000-0000-0000-0000-000000000009', '5b000000-0000-0000-0000-000000000003', '51000000-0000-0000-0000-000000000001', 2, 0, true, '2026-01-01 10:42+00'),
  ('5c000000-0000-0000-0000-000000000010', '5b000000-0000-0000-0000-000000000003', '51000000-0000-0000-0000-000000000001', 3, 50, false, '2026-01-01 10:42+00'),
  -- Ended early.
  ('5c000000-0000-0000-0000-000000000011', '5b000000-0000-0000-0000-000000000004', '51000000-0000-0000-0000-000000000001', 1, 100, false, '2026-01-02 10:01+00'),
  -- Running match, bust, and a turn without darts.
  ('5c000000-0000-0000-0000-000000000012', '5b000000-0000-0000-0000-000000000005', '51000000-0000-0000-0000-000000000001', 1, 0, true, '2026-01-03 10:01+00'),
  ('5c000000-0000-0000-0000-000000000013', '5b000000-0000-0000-0000-000000000005', '51000000-0000-0000-0000-000000000001', 2, 45, false, '2026-01-03 10:02+00'),
  ('5c000000-0000-0000-0000-000000000014', '5b000000-0000-0000-0000-000000000007', '51000000-0000-0000-0000-000000000002', 1, 140, false, '2026-01-05 10:01+00');

insert into public.throws (turn_id, dart_index, segment, scored) values
  ('5c000000-0000-0000-0000-000000000001', 1, 'T20', 60), ('5c000000-0000-0000-0000-000000000001', 2, 'T20', 60), ('5c000000-0000-0000-0000-000000000001', 3, 'T20', 60),
  ('5c000000-0000-0000-0000-000000000002', 1, '20', 20), ('5c000000-0000-0000-0000-000000000002', 2, 'S1', 1), ('5c000000-0000-0000-0000-000000000002', 3, '20', 20),
  ('5c000000-0000-0000-0000-000000000003', 1, 'T20', 60), ('5c000000-0000-0000-0000-000000000003', 2, 'T20', 60), ('5c000000-0000-0000-0000-000000000003', 3, '20', 20),
  ('5c000000-0000-0000-0000-000000000004', 1, 'T20', 60), ('5c000000-0000-0000-0000-000000000004', 2, 'T19', 57), ('5c000000-0000-0000-0000-000000000004', 3, 'D12', 24),
  ('5c000000-0000-0000-0000-000000000005', 1, 'D20', 40),
  ('5c000000-0000-0000-0000-000000000007', 1, '5', 5), ('5c000000-0000-0000-0000-000000000007', 2, 'S1', 1), ('5c000000-0000-0000-0000-000000000007', 3, '20', 20),
  ('5c000000-0000-0000-0000-000000000008', 1, '19', 19), ('5c000000-0000-0000-0000-000000000008', 2, 'S3', 3), ('5c000000-0000-0000-0000-000000000008', 3, '7', 7),
  ('5c000000-0000-0000-0000-000000000009', 1, 'T20', 60), ('5c000000-0000-0000-0000-000000000009', 2, 'Miss', 0),
  ('5c000000-0000-0000-0000-000000000010', 1, 'OuterBull', 25), ('5c000000-0000-0000-0000-000000000010', 2, 'InnerBull', 50), ('5c000000-0000-0000-0000-000000000010', 3, 'MISS', 0),
  ('5c000000-0000-0000-0000-000000000011', 1, 'T20', 60), ('5c000000-0000-0000-0000-000000000011', 2, '20', 20), ('5c000000-0000-0000-0000-000000000011', 3, '20', 20),
  ('5c000000-0000-0000-0000-000000000012', 1, 'T19', 57),
  ('5c000000-0000-0000-0000-000000000014', 1, 'T20', 60), ('5c000000-0000-0000-0000-000000000014', 2, 'T20', 60), ('5c000000-0000-0000-0000-000000000014', 3, '20', 20);

do $$
declare
  alice constant uuid := '51000000-0000-0000-0000-000000000001';
  carol constant uuid := '51000000-0000-0000-0000-000000000003';
  overview json;
  detail json;
  turn json;
  expected_darts jsonb;
begin
  -- The functions run with the caller's rights and are for clients, not the public role.
  assert not (select prosecdef from pg_proc where oid = 'public.stats_overview()'::regprocedure), 'stats_overview must be security invoker';
  assert not (select prosecdef from pg_proc where oid = 'public.stats_player_detail(uuid)'::regprocedure), 'stats_player_detail must be security invoker';
  assert has_function_privilege('authenticated', 'public.stats_overview()', 'execute'), 'signed-in users must read the overview';
  assert has_function_privilege('authenticated', 'public.stats_player_detail(uuid)', 'execute'), 'signed-in users must read player detail';

  -- Overview: the old count queries, run over the same filters.
  overview := public.stats_overview();
  assert (overview->>'total_matches')::int = (select count(*) from public.matches where ended_early = false),
    format('total_matches %s', overview->>'total_matches');
  assert (overview->>'completed_matches')::int = (select count(*) from public.matches where ended_early = false and winner_player_id is not null),
    format('completed_matches %s', overview->>'completed_matches');
  assert (overview->>'total_legs')::int = (select count(*) from public.legs l join public.matches m on m.id = l.match_id where m.ended_early = false),
    format('total_legs %s', overview->>'total_legs');
  assert (overview->>'total_turns')::int = (select count(*) from public.turns t join public.legs l on l.id = t.leg_id join public.matches m on m.id = l.match_id where m.ended_early = false),
    format('total_turns %s', overview->>'total_turns');
  assert (overview->>'total_throws')::int = (select count(*) from public.throws th join public.turns t on t.id = th.turn_id join public.legs l on l.id = t.leg_id join public.matches m on m.id = l.match_id where m.ended_early = false),
    format('total_throws %s', overview->>'total_throws');
  assert (overview->>'first_match_at')::timestamptz = (select min(created_at) from public.matches where ended_early = false), 'first match';
  assert (overview->>'last_match_at')::timestamptz = (select max(created_at) from public.matches where ended_early = false), 'last match';
  -- The seeded rows: matches 1, 3, 4 and 5 count; the ended-early match does not.
  assert (overview->>'total_matches')::int >= 4;

  detail := public.stats_player_detail(alice);

  -- Turns: exactly the old turns query (this player, not ended early, tiebreaks included),
  -- ordered by time with the id breaking ties.
  assert (select array_agg(t->>0 order by ord) from json_array_elements(detail->'turns') with ordinality as x(t, ord))
    = (select array_agg(t.id::text order by t.created_at, t.id)
       from public.turns t join public.legs l on l.id = t.leg_id join public.matches m on m.id = l.match_id
       where t.player_id = alice and m.ended_early = false),
    'turns must match the old turns query in time order';
  assert not exists (select 1 from json_array_elements(detail->'turns') t where t->>0 = '5c000000-0000-0000-0000-000000000011'),
    'turns of ended-early matches are excluded';

  -- Each turn carries its fields and its darts in dart order, as the old throws query returned them.
  for turn in select t from json_array_elements(detail->'turns') t loop
    assert (select row(tu.leg_id::text, tu.total_scored, tu.busted, tu.turn_number) from public.turns tu where tu.id = (turn->>0)::uuid)
      = row(turn->>1, (turn->>2)::int, (turn->>3)::boolean, (turn->>4)::int), format('turn %s fields', turn->>0);
    assert (turn->>5)::timestamptz = (select created_at from public.turns where id = (turn->>0)::uuid), format('turn %s time', turn->>0);
    select coalesce(jsonb_agg(jsonb_build_array(th.dart_index, th.segment, th.scored) order by th.dart_index), '[]'::jsonb)
      into expected_darts from public.throws th where th.turn_id = (turn->>0)::uuid;
    assert (turn->6)::jsonb = expected_darts, format('turn %s darts %s', turn->>0, turn->6);
  end loop;
  assert json_array_length((select t->6 from json_array_elements(detail->'turns') t where t->>0 = '5c000000-0000-0000-0000-000000000013')) = 0,
    'a turn without darts has an empty dart list';

  -- Legs: those the player's turns belong to, plus legs the player won, never ended-early ones.
  assert (select array_agg(l->>0 order by l->>0) from json_array_elements(detail->'legs') l)
    = (select array_agg(l.id::text order by l.id::text) from public.legs l join public.matches m on m.id = l.match_id
       where m.ended_early = false
         and (l.winner_player_id = alice or exists (select 1 from public.turns t where t.leg_id = l.id and t.player_id = alice))),
    'legs must be the legs played or won';
  assert exists (select 1 from json_array_elements(detail->'legs') l where l->>0 = '5b000000-0000-0000-0000-000000000006'),
    'a leg won without turns still counts as a leg won';
  assert not exists (select 1 from json_array_elements(detail->'legs') l where l->>0 = '5b000000-0000-0000-0000-000000000007'),
    'other players'' legs are not included';
  assert (select row(l->>1, (l->>2)::int, (l->>3)::timestamptz, l->>4) from json_array_elements(detail->'legs') l where l->>0 = '5b000000-0000-0000-0000-000000000002')
    = row('5a000000-0000-0000-0000-000000000001'::text, 2, '2026-01-01 10:20+00'::timestamptz, '51000000-0000-0000-0000-000000000002'::text),
    'leg columns are [id, match_id, leg_number, created_at, winner_player_id]';

  -- Matches: those of the included legs plus matches the player won, never ended-early ones.
  assert (select array_agg(m->>0 order by m->>0) from json_array_elements(detail->'matches') m)
    = array['5a000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000003', '5a000000-0000-0000-0000-000000000004'],
    format('matches %s', detail->'matches');
  assert (select row((m->>1)::timestamptz, m->>2, m->>3, m->>4) from json_array_elements(detail->'matches') m where m->>0 = '5a000000-0000-0000-0000-000000000003')
    = row('2026-01-03 10:00+00'::timestamptz, null::text, '201'::text, 'single_out'::text),
    'match columns are [id, created_at, winner_player_id, start_score, finish]';

  -- Segment and adjacency summaries: the same view rows, for this player only.
  assert (detail->'segments')::jsonb = (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from public.player_segment_summary s where s.player_id = alice),
    'segments must be the view rows';
  assert json_array_length(detail->'segments') > 0;
  assert (detail->'adjacency')::jsonb = (select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) from public.player_adjacency_stats a where a.player_id = alice),
    'adjacency must be the view rows';
  assert json_array_length(detail->'adjacency') = 1, 'Alice has more than ten darts, so she has an adjacency row';

  -- A player without games gets empty lists, not nulls.
  detail := public.stats_player_detail(carol);
  assert detail::jsonb = '{"turns": [], "legs": [], "matches": [], "segments": [], "adjacency": []}'::jsonb,
    format('empty player %s', detail);
end $$;

rollback;
