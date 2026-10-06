begin;

-- Accepted by the tournament organiser on October 6. Preserve the September 15
-- playing date and the original visit totals; checkout visits use three darts.
do $$
declare
  eid uuid;
  f public.highdarts_fixtures%rowtype;
  report record;
  known_players integer;
begin
  select id into eid from public.highdarts_events where slug = 'highdarts-2026' for update;
  if eid is null then return; end if;
  select count(*) into known_players from public.players where id in (
    '13bf0418-ba32-4680-a63c-9a2f223bac3d', '36ae9837-7aa9-4db1-84a7-3958bb34ddf9', 'c31193ac-886d-452f-afe7-a8f2bc60c229');
  if known_players = 0 then
    raise notice 'No reviewed production identities; no screenshot results to import';
    return;
  end if;
  if known_players <> 3 then raise exception 'Screenshot import requires all three reviewed player identities'; end if;
  perform 1 from public.highdarts_fixtures where event_id = eid order by id for update;

  if not exists (
    select 1 from public.highdarts_fixtures fx join public.matches m on m.id = fx.match_id
    where fx.event_id = eid and fx.stage = 'group' and fx.office = 'sogndal' and fx.fixture_no = 12
      and fx.player_a_id = 'c31193ac-886d-452f-afe7-a8f2bc60c229'
      and fx.player_b_id = '36ae9837-7aa9-4db1-84a7-3958bb34ddf9'
      and m.id = 'cd0f9577-5ce2-44ba-9566-b9644d9b9b5d' and m.highdarts_fixture_id = fx.id
      and m.completed_at is not null and not m.ended_early and m.winner_player_id = fx.player_b_id
  ) then raise exception 'The verified recorded Jon–Johan meeting no longer occupies #12; review before importing'; end if;

  for report in select * from (values
(1, '13bf0418-ba32-4680-a63c-9a2f223bac3d'::uuid, '36ae9837-7aa9-4db1-84a7-3958bb34ddf9'::uuid, 'Sindre Jensen', 'Jon Skjerdal', $report${
  "accepted": true,
  "winner_player_id": "13bf0418-ba32-4680-a63c-9a2f223bac3d",
  "playedOn": "2026-09-15",
  "estimatedAverages": [
    {
      "player_id": "13bf0418-ba32-4680-a63c-9a2f223bac3d",
      "average": 38.57
    },
    {
      "player_id": "36ae9837-7aa9-4db1-84a7-3958bb34ddf9",
      "average": 35.61
    }
  ],
  "legs": [
    {
      "winner_player_id": "13bf0418-ba32-4680-a63c-9a2f223bac3d",
      "visits": [
        {
          "player_id": "13bf0418-ba32-4680-a63c-9a2f223bac3d",
          "scores": [48, 48, 7, 78, 50, 39, 31]
        },
        {
          "player_id": "36ae9837-7aa9-4db1-84a7-3958bb34ddf9",
          "scores": [28, 19, 68, 46, 25, 47, 36]
        }
      ]
    },
    {
      "winner_player_id": "36ae9837-7aa9-4db1-84a7-3958bb34ddf9",
      "visits": [
        {
          "player_id": "13bf0418-ba32-4680-a63c-9a2f223bac3d",
          "scores": [44, 38, 23, 79, 57, 44, 0, 0]
        },
        {
          "player_id": "36ae9837-7aa9-4db1-84a7-3958bb34ddf9",
          "scores": [31, 24, 23, 54, 31, 66, 54, 18]
        }
      ]
    },
    {
      "winner_player_id": "13bf0418-ba32-4680-a63c-9a2f223bac3d",
      "visits": [
        {
          "player_id": "13bf0418-ba32-4680-a63c-9a2f223bac3d",
          "scores": [10, 81, 39, 63, 52, 0, 29, 27]
        },
        {
          "player_id": "36ae9837-7aa9-4db1-84a7-3958bb34ddf9",
          "scores": [18, 80, 28, 21, 45, 24, 26, 7]
        }
      ]
    }
  ]
}$report$::jsonb),
(13, '36ae9837-7aa9-4db1-84a7-3958bb34ddf9'::uuid, 'c31193ac-886d-452f-afe7-a8f2bc60c229'::uuid, 'Jon Skjerdal', 'Johan Flo', $report${
  "accepted": true,
  "winner_player_id": "36ae9837-7aa9-4db1-84a7-3958bb34ddf9",
  "playedOn": "2026-09-15",
  "estimatedAverages": [
    {
      "player_id": "c31193ac-886d-452f-afe7-a8f2bc60c229",
      "average": 34.71
    },
    {
      "player_id": "36ae9837-7aa9-4db1-84a7-3958bb34ddf9",
      "average": 33.32
    }
  ],
  "legs": [
    {
      "winner_player_id": "36ae9837-7aa9-4db1-84a7-3958bb34ddf9",
      "visits": [
        {
          "player_id": "c31193ac-886d-452f-afe7-a8f2bc60c229",
          "scores": [14, 33, 23, 17, 14, 62, 13, 23, 80]
        },
        {
          "player_id": "36ae9837-7aa9-4db1-84a7-3958bb34ddf9",
          "scores": [28, 49, 16, 30, 74, 31, 9, 11, 20, 33]
        }
      ]
    },
    {
      "winner_player_id": "c31193ac-886d-452f-afe7-a8f2bc60c229",
      "visits": [
        {
          "player_id": "c31193ac-886d-452f-afe7-a8f2bc60c229",
          "scores": [103, 37, 31, 44, 43, 19, 19, 5]
        },
        {
          "player_id": "36ae9837-7aa9-4db1-84a7-3958bb34ddf9",
          "scores": [36, 26, 35, 34, 26, 45, 29]
        }
      ]
    },
    {
      "winner_player_id": "36ae9837-7aa9-4db1-84a7-3958bb34ddf9",
      "visits": [
        {
          "player_id": "c31193ac-886d-452f-afe7-a8f2bc60c229",
          "scores": [39, 39, 40, 58, 37, 33, 7]
        },
        {
          "player_id": "36ae9837-7aa9-4db1-84a7-3958bb34ddf9",
          "scores": [94, 52, 28, 55, 34, 0, 24, 14]
        }
      ]
    }
  ]
}$report$::jsonb)
  ) as reports(fixture_no, a, b, a_name, b_name, result) loop
    select * into f from public.highdarts_fixtures
      where event_id = eid and stage = 'group' and office = 'sogndal' and fixture_no = report.fixture_no;
    if f.id is null or f.player_a_id is distinct from report.a or f.player_b_id is distinct from report.b
      or public.highdarts_normalize_name(f.player_a_name) <> public.highdarts_normalize_name(report.a_name)
      or public.highdarts_normalize_name(f.player_b_name) <> public.highdarts_normalize_name(report.b_name) then
      raise exception 'Screenshot fixture % identities changed; import rolled back', report.fixture_no;
    end if;
    if f.match_id is not null then raise exception 'Screenshot fixture % is already claimed; import rolled back', report.fixture_no; end if;
    if f.reported_result = report.result then continue; end if;
    if f.reported_result is not null then raise exception 'Screenshot fixture % already has a different report', report.fixture_no; end if;
    if exists (select 1 from public.highdarts_fixtures where event_id = eid and stage <> 'group') then
      raise exception 'Qualification has started; review the draw before accepting screenshot results';
    end if;
    update public.highdarts_fixtures set reported_result = report.result where id = f.id;
  end loop;
end;
$$;

commit;
