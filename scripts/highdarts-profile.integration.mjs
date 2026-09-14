import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

// This opt-in harness writes only to the disposable native preview database.
if (process.env.HIGHDARTS_PROFILE_NATIVE !== "1")
  throw new Error(
    "Set HIGHDARTS_PROFILE_NATIVE=1 in the prepared local environment",
  );
const psql = "/Applications/Postgres.app/Contents/Versions/18/bin/psql";
const event = randomUUID();
const players = Array.from({ length: 4 }, () => randomUUID());
const fixtures = [randomUUID(), randomUUID()];
const sql = (query) =>
  execFileSync(
    psql,
    [
      "-h",
      "/private/tmp",
      "-p",
      "56555",
      "-d",
      "bengt_profile",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      query,
    ],
    { encoding: "utf8" },
  ).trim();
const literal = (value) => "'" + value.replaceAll("'", "''") + "'";
const identityMigration = readFileSync(new URL('../supabase/migrations/20260914191500_highdarts_player_identities.sql', import.meta.url), 'utf8')
  .replace(/^begin;\s*/, '').replace(/commit;\s*$/, '');
sql(`begin;
  create temporary table original_identity_fixtures as
    select f.id, f.player_a_id, f.player_b_id from highdarts_fixtures f
    join highdarts_events e on e.id=f.event_id
    where e.slug='highdarts-2026' and f.stage='group' and f.match_id is null;
  do $$ begin
    if (select count(*) from original_identity_fixtures where player_a_id is not null and player_b_id is not null) <> 76 then
      raise exception 'Identity regression requires the prepared 76-fixture preview';
    end if;
  end $$;
  update highdarts_fixtures set player_a_id=null, player_b_id=null where id in (select id from original_identity_fixtures);
  ${identityMigration}
  ${identityMigration}
  do $$ begin
    if exists (select 1 from highdarts_fixtures f join original_identity_fixtures o on o.id=f.id
      where f.player_a_id is distinct from o.player_a_id or f.player_b_id is distinct from o.player_b_id) then
      raise exception 'Identity resolution changed a player or failed to resolve an alias';
    end if;
  end $$;
  create temporary table preserved_assignment as
    select f.id, p.id as player_a_id from highdarts_fixtures f cross join players p
    where f.id in (select id from original_identity_fixtures) and p.id not in (f.player_a_id,f.player_b_id) limit 1;
  update highdarts_fixtures f set player_a_id=p.player_a_id, player_b_id=null from preserved_assignment p where p.id=f.id;
  ${identityMigration}
  do $$ begin
    if exists (select 1 from highdarts_fixtures f join preserved_assignment p on p.id=f.id where f.player_a_id<>p.player_a_id or f.player_b_id is null) then
      raise exception 'Migration overwrote an existing assignment';
    end if;
  end $$;
  rollback;`);
console.log('Identity migration passed: 76 fixture pairs restored through Slack links, repeat is idempotent, existing assignments preserved; test rolled back.');
try {
  sql(`begin;
    insert into highdarts_events(id,slug,name) values ('${event}','profile-test-${event}','Profile integration test');
    insert into players(id,display_name,is_test) values ${players.map((id, i) => `('${id}','Profile test ${event} ${i}',true)`).join(",")};
    insert into highdarts_fixtures(id,event_id,stage,office,fixture_no,player_a_name,player_b_name,player_a_id,player_b_id) values
    ${fixtures.map((id, i) => `('${id}','${event}','group','bergen',${i + 1},'Test A','Test B','${players[i * 2]}','${players[i * 2 + 1]}')`).join(",")}; commit;`);
  const create = (id, pair) =>
    fetch("http://127.0.0.1:3020/api/matches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        highdartsFixtureId: id,
        playerIds: pair,
        startScore: 301,
        finishRule: "single_out",
        legsToWin: 2,
        fairEnding: false,
      }),
    });
  const responses = await Promise.all(
    fixtures.map((id, i) => create(id, players.slice(i * 2, i * 2 + 2))),
  );
  const outcomes = await Promise.all(
    responses.map(async (r) => ({ status: r.status, body: await r.json() })),
  );
  assert.deepEqual(
    outcomes.map((r) => r.status).sort(),
    [201, 409],
    JSON.stringify(outcomes),
  );
  assert.equal(
    sql(
      `select count(*) from matches where highdarts_fixture_id in (${fixtures.map(literal).join(",")})`,
    ),
    "1",
  );
  assert.equal(
    sql(
      `select count(distinct match_id) from match_players where player_id in (${players.map(literal).join(",")})`,
    ),
    "1",
    "A failed start left an orphan",
  );
  const retry = await create(
    fixtures[outcomes.findIndex((r) => r.status === 201)],
    players.slice(
      outcomes.findIndex((r) => r.status === 201) * 2,
      outcomes.findIndex((r) => r.status === 201) * 2 + 2,
    ),
  );
  assert.equal(retry.status, 409);
  console.log(
    "Real API race passed: one 201, one 409, duplicate retry rejected, no orphan match.",
  );
} finally {
  sql(`begin; set session_replication_role=replica;
    create temporary table profile_test_matches as select distinct match_id as id from match_players where player_id in (${players.map(literal).join(",")});
    delete from throws where turn_id in (select t.id from turns t join legs l on l.id=t.leg_id where l.match_id in (select id from profile_test_matches));
    delete from turns where leg_id in (select id from legs where match_id in (select id from profile_test_matches));
    delete from legs where match_id in (select id from profile_test_matches);
    delete from match_players where match_id in (select id from profile_test_matches);
    delete from dartiq_source_revisions where match_id in (select id from profile_test_matches);
    delete from matches where id in (select id from profile_test_matches);
    delete from highdarts_fixtures where event_id='${event}';
    delete from highdarts_events where id='${event}';
    delete from players where id in (${players.map(literal).join(",")});
    set session_replication_role=origin; commit;`);
}
