import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

if (process.env.HIGHDARTS_COUNTING_NATIVE !== "1")
  throw new Error(
    "Set HIGHDARTS_COUNTING_NATIVE=1 for the prepared disposable local environment",
  );
const event = randomUUID();
const playerIds = Array.from({ length: 7 }, () => randomUUID());
const fixtures = Array.from({ length: 6 }, () => randomUUID());
const sql = (query) =>
  execFileSync(
    "/Applications/Postgres.app/Contents/Versions/18/bin/psql",
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
const save = (excludedFixtureId, expectedExcludedFixtureId = null) =>
  fetch("http://127.0.0.1:3020/api/highdarts/counting", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      eventId: event,
      playerId: playerIds[0],
      excludedFixtureId,
      expectedExcludedFixtureId,
    }),
  });
try {
  sql(`begin;
    insert into highdarts_events(id,slug,name) values ('${event}','counting-api-${event}','Counting API test');
    insert into players(id,display_name,is_test) values ${playerIds.map((id, i) => `('${id}','Counting API ${event} ${i}',true)`).join(",")};
    insert into highdarts_fixtures(id,event_id,stage,office,fixture_no,player_a_name,player_b_name,player_a_id,player_b_id)
    values ${fixtures.map((id, i) => `('${id}','${event}','group','vik',${i + 1},'A','B','${playerIds[0]}','${playerIds[i + 1]}')`).join(",")}; commit;`);
  const results = await Promise.all(
    fixtures.slice(0, 2).map(async (id) => {
      const response = await save(id);
      return { id, status: response.status, body: await response.json() };
    }),
  );
  assert.deepEqual(
    results.map((r) => r.status).sort(),
    [200, 409],
    JSON.stringify(results),
  );
  const winner = results.find((r) => r.status === 200);
  assert.ok(winner);
  assert.equal(
    sql(
      `select count(*) filter(where counts_for_a) || ':' || count(*) filter(where counts_for_b) from highdarts_fixtures where event_id='${event}'`,
    ),
    "5:6",
  );
  assert.equal(
    (await save(winner.id)).status,
    200,
    "An identical retry should be safe",
  );
  assert.equal(
    (await save(fixtures[2])).status,
    409,
    "Stale replacement should fail",
  );
  assert.equal((await save(null, winner.id)).status, 200);
  assert.equal(
    sql(
      `select count(*) from highdarts_fixtures where event_id='${event}' and counts_for_a and counts_for_b`,
    ),
    "6",
  );
  console.log(
    "Counting API race passed: one 200, one 409; exactly five owner results and six opponent results; safe retry and clear.",
  );
} finally {
  sql(
    `begin; delete from highdarts_fixtures where event_id='${event}'; delete from highdarts_events where id='${event}'; delete from players where id in (${playerIds.map((id) => `'${id}'`).join(",")}); commit;`,
  );
}
