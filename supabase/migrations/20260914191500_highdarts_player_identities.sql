begin;
-- Reviewed against the existing Highsoft player/Slack links on 2026-09-14.
-- Sheet aliases include KH, Pankoen, Nick and expanded/misspelled full names.
-- Resolve through the stable workspace identity; never rename or create players.
with identities(sheet_name, slack_user_id) as (values
    ('Aleksander Walle','U07NGSQED5H'),
    ('Alicja Pankowiecka','U026VD3SWLR'),
    ('Babar Shah','U0875QRGQ3U'),
    ('Ferdinand Berntsen','U01C6HQKCKF'),
    ('Guro','U080VGCKC'),
    ('Havard Gundersen','U06J2EADKV4'),
    ('James Haugen','U07FETLHFB9'),
    ('Ken-Havard Lieng','U01BK71KHCL'),
    ('Kseniia Hadzhun','U0B2RCX8J7K'),
    ('Nicolas Silvester','U09F7M86LLE'),
    ('Nikita Myklebust','U07K2DECD62'),
    ('Stian Totland','U06C2J3HZC2'),
    ('Andreas Tistel','U05D7TN2K4H'),
    ('Anne Hauge','U0BNG033KCJ'),
    ('Askele Johansson','U01BD1L2TNW'),
    ('Bengt Abelsen Ohlen','U01PN1BCBN0'),
    ('Elida Espeland','U08C9MR42P5'),
    ('Elise Fosse','U091L3JCYH0'),
    ('Gjertrud','U0G59RS6M'),
    ('Helga Brudevoll','U01K5U4KW68'),
    ('Joakim Rudolfsen','UGD91PVKP'),
    ('Linda Sven','U0G4URNF4'),
    ('Pawel Kubica','U0AKLEVGBSS'),
    ('Sigrid Lundeland','U0AP15J23V0'),
    ('Silje Tverberg','U03UJF0PYTD'),
    ('Johan Flo','U0AK73A75E3'),
    ('Jon Skjerdal','U0ANKMM5GTH'),
    ('Jorgen Tistel','U044RQGRU01'),
    ('Mykhailo Pelykh','U0BAKV92YPL'),
    ('Sindre Jensen','U07GRHJ8V0C')
), resolved as (
  select i.sheet_name, p.id from identities i
  join public.slack_player_links l on l.team_id='T07UR9NFJ' and l.slack_user_id=i.slack_user_id
  join public.players p on p.id=l.player_id and p.is_active and not p.is_test
)
update public.highdarts_fixtures f set
  player_a_id=coalesce(f.player_a_id,a.id),
  player_b_id=coalesce(f.player_b_id,b.id)
from public.highdarts_events e, resolved a, resolved b
where f.event_id=e.id and e.slug='highdarts-2026' and f.stage='group' and f.match_id is null
  and f.player_a_name=a.sheet_name and f.player_b_name=b.sheet_name
  and (f.player_a_id is null or f.player_b_id is null)
  and coalesce(f.player_a_id,a.id) <> coalesce(f.player_b_id,b.id);
commit;
