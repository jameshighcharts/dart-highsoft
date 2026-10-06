import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { buildStandings, resultStats } from '../src/lib/highdarts/standings.ts';
import { withReportedResults } from '../src/lib/highdarts/reportedResults.ts';
import { buildSheetExport } from '../src/lib/highdarts/sheetExport.ts';

if (process.env.HIGHDARTS_REPORTS_NATIVE !== '1') throw new Error('Set HIGHDARTS_REPORTS_NATIVE=1 for disposable local PostgreSQL verification');
const migration = (name) => readFileSync(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8').replace(/^begin;/, '').replace(/commit;\s*$/, '');
const acceptedSchema = migration('20261006094831_highdarts_accepted_reports');
const seed = migration('20261006094832_accept_sogndal_screenshot_results');
const importFunction = seed.replace('do $$', () => 'create function pg_temp.accept_reports() returns void language plpgsql as $$');
const ids = { sindre: '13bf0418-ba32-4680-a63c-9a2f223bac3d', jon: '36ae9837-7aa9-4db1-84a7-3958bb34ddf9', johan: 'c31193ac-886d-452f-afe7-a8f2bc60c229' };
const recorded = 'cd0f9577-5ce2-44ba-9566-b9644d9b9b5d';
const event = "(select id from highdarts_events where slug='highdarts-2026')";
const fixture = (number) => `(select id from highdarts_fixtures where office='sogndal' and stage='group' and fixture_no=${number})`;
const setup = `
create type public.x01_start as enum ('201','301','501');
create type public.finish_rule as enum ('single_out','double_out');
create table players(id uuid primary key, display_name text, avatar_url text, is_active boolean default true, is_test boolean default false, nicknames text[]);
create table matches(id uuid primary key, mode text default 'x01', start_score x01_start default '301', finish finish_rule default 'single_out', legs_to_win integer default 2, fair_ending boolean default false, tournament_match_id uuid, completed_at timestamptz, winner_player_id uuid, ended_early boolean default false, scolia_board_id uuid, paused_at timestamptz);
create table match_players(match_id uuid, player_id uuid);
create table legs(id uuid primary key, match_id uuid, leg_number integer, winner_player_id uuid);
create table turns(id uuid primary key, leg_id uuid, player_id uuid, total_scored integer, busted boolean, tiebreak_round integer, turn_number integer);
create table throws(id uuid primary key, turn_id uuid);
create table background_jobs(job_type text, payload jsonb, run_at timestamptz, deduplication_key text unique);
create table slack_player_links(team_id text, slack_user_id text, player_id uuid);
create table scolia_boards(id uuid primary key, name text, enabled boolean);
create table game_sessions(id uuid primary key, scolia_board_id uuid, status text);
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
insert into players(id,display_name) values ('${ids.sindre}','Sindre Jensen'),('${ids.jon}','Jon Skjerdal'),('${ids.johan}','Johan Flo');
${migration('20260914120000_highdarts_2026')}
${migration('20260914163000_highdarts_finals')}
${migration('20260915090000_highdarts_counted_results')}
${migration('20260915120000_highdarts_manual_scoring')}
insert into matches(id,completed_at,winner_player_id,highdarts_fixture_id) values('${recorded}','2026-09-24T12:00:00Z','${ids.jon}',${fixture(12)});
update highdarts_fixtures set match_id='${recorded}' where id=${fixture(12)};
create temporary table before_fixtures as select * from highdarts_fixtures;
create temporary table before_matches as select * from matches;
set constraints all immediate;
set constraints all deferred;
${acceptedSchema}
${importFunction}
`;
function run(sql) {
  return execFileSync(process.env.PSQL_BIN || 'psql', ['-h','127.0.0.1','-p','56575','-d','bengt_reports_test','-XAtq','-v','ON_ERROR_STOP=1'], {
    input: `begin;\n${setup}\n${sql}\nset constraints all immediate;\nrollback;`, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  });
}
function rejection(sql, message) {
  return `do $test$ begin begin ${sql}; raise exception 'Expected rejection'; exception when others then if position('${message}' in sqlerrm)=0 then raise; end if; end; end $test$;`;
}
const snapshotOutput = run(`
${seed}
select pg_temp.accept_reports();
do $$ begin
  if (select count(*) from highdarts_fixtures where reported_result is not null)<>2 then raise exception 'Expected exactly two reports'; end if;
  if exists(select 1 from highdarts_fixtures f join before_fixtures b using(id) where to_jsonb(f)-'reported_result'<>to_jsonb(b)) then raise exception 'Existing fixture data changed'; end if;
  if exists((select * from matches except select * from before_matches) union all (select * from before_matches except select * from matches)) then raise exception 'Scoring matches changed'; end if;
  if exists(select 1 from throws) or exists(select 1 from background_jobs) then raise exception 'Created scoring or publishing data'; end if;
  if exists(select 1 from unnest(array['anon','authenticated']) role_name where has_table_privilege(role_name,'highdarts_fixtures','UPDATE') or has_function_privilege(role_name,'highdarts_snapshot()','EXECUTE') or has_function_privilege(role_name,'lock_highdarts_draw_atomic(jsonb,jsonb)','EXECUTE')) then raise exception 'Public write/RPC privilege'; end if;
  if not has_function_privilege('service_role','highdarts_snapshot()','EXECUTE') or not has_function_privilege('service_role','lock_highdarts_draw_atomic(jsonb,jsonb)','EXECUTE') then raise exception 'Service RPC grant lost'; end if;
end $$;
select 'SNAPSHOT:' || highdarts_snapshot()::text;
`);
const snapshot = JSON.parse(snapshotOutput.split('\n').find((line) => line.startsWith('SNAPSHOT:')).slice(9));
assert.deepEqual(withReportedResults(snapshot), snapshot);
const reports = snapshot.fixtures.filter((f) => f.reportedResult);
assert.deepEqual(reports.map((f) => f.fixture_no), [1, 13]);
assert.equal(snapshot.fixtures.find((f) => f.match_id === recorded).reportedResult, undefined);
const rounded = (values) => values.map((row) => row.map((value) => Math.round(value * 100) / 100));
assert.deepEqual(rounded(reports.map((f) => [resultStats(f, f.player_a_id).average, resultStats(f, f.player_b_id).average])), [[38.57,35.61],[33.32,34.71]]);
const standings = buildStandings(snapshot);
assert.equal(standings.averagesIncomplete, false);
const jon = standings.offices.find((o) => o.office === 'sogndal').table.find((r) => r.key === ids.jon);
assert.equal(jon.played, 3);
assert.equal(jon.wins, 2);
assert.equal(jon.averageEstimated, true);
assert.ok(Math.abs(jon.average - (819 + 833) / (23 + 25)) < 1e-10);
const exported = buildSheetExport(snapshot);
assert.deepEqual(rounded(exported.fixtures.filter((f) => f.office === 'sogndal' && [1,13].includes(f.number)).map((f) => f.result)), [[2,1,38.57,35.61],[2,1,33.32,34.71]]);
writeFileSync('/private/tmp/bengt-accepted-db-snapshot.json', JSON.stringify(snapshot, null, 2));
console.log('Passed: actual migrations, exact report totals, retries, unchanged fixtures/scoring data, service-only RPCs, weighted standings, sheet parity');

run(`select pg_temp.accept_reports();
insert into matches(id) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into match_players values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','${ids.jon}'),('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','${ids.johan}');
${rejection(`perform link_highdarts_match_atomic('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',${fixture(13)})`, 'highdarts_reported_result_valid')}
${rejection(`update highdarts_fixtures set player_a_id='${ids.sindre}' where id=${fixture(13)}`, 'highdarts_reported_result_valid')}
${rejection(`update highdarts_fixtures set reported_result=reported_result-'accepted' where id=${fixture(13)}`, 'highdarts_reported_result_valid')}
do $$ begin if exists(select 1 from matches where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and highdarts_fixture_id is not null) then raise exception 'Partial link escaped rollback'; end if; end $$;
${rejection(`perform lock_highdarts_draw_atomic(highdarts_snapshot(),'[]'::jsonb)`, 'Complete the group games')}
`);
console.log('Passed: duplicate linking, identity changes, unaccepted data and incomplete groups rejected');

const games = ['playoff','quarterfinal','semifinal','final'].flatMap((stage, i) => Array.from({ length: [4,4,2,1][i] }, (_, n) => ({ stage, position: n+1, player_a_name: 'Jon', player_b_name: 'Johan', player_a_id: ids.jon, player_b_id: ids.johan })));
run(`select pg_temp.accept_reports();
delete from highdarts_fixtures where not (office='sogndal' and fixture_no in(1,12,13));
create temporary table expected as select highdarts_snapshot() as snapshot;
update highdarts_fixtures set reported_result=jsonb_set(reported_result,'{playedOn}','"2026-09-16"') where id=${fixture(1)};
${rejection(`perform lock_highdarts_draw_atomic((select snapshot from expected),'${JSON.stringify(games)}')`, 'Results changed')}
select lock_highdarts_draw_atomic(highdarts_snapshot(),'${JSON.stringify(games)}');
do $$ begin if (select count(*) from highdarts_fixtures where stage<>'group')<>11 then raise exception 'Draw failed'; end if; end $$;
${rejection(`update highdarts_fixtures set reported_result=null where id=${fixture(1)}`, 'Unlock the draw')}
${rejection(`update highdarts_fixtures set counts_for_a=false where id=${fixture(1)}`, 'Unlock the draw')}
`);
console.log('Passed: accepted reports permit SQL draw lock; stale snapshot and post-lock report/count edits rejected');

run(`select pg_temp.accept_reports();
update highdarts_fixtures set counts_for_a=false where id=${fixture(1)};
select pg_temp.accept_reports();
do $$ begin if (select counts_for_a from highdarts_fixtures where id=${fixture(1)}) then raise exception 'Exclusion lost on retry'; end if; end $$;
update highdarts_fixtures set counts_for_a=true where id=${fixture(1)};
${rejection(`insert into highdarts_fixtures(event_id,stage,fixture_no,player_a_name,player_b_name) values(${event},'tiebreak',1,'Jon','Johan')`, 'must each choose one excluded result')}
`);
console.log('Passed: existing exclusions survive import/retry; outstanding counting choices still block qualification');

for (const [label, change, message] of [
  ['claimed screenshot fixture', `insert into matches(id,highdarts_fixture_id) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',${fixture(13)}); update highdarts_fixtures set match_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' where id=${fixture(13)};`, 'already claimed'],
  ['changed identities', `update highdarts_fixtures set player_b_id='${ids.sindre}' where id=${fixture(13)};`, 'identities changed'],
  ['different recorded winner', `update matches set winner_player_id='${ids.johan}' where id='${recorded}';`, 'no longer occupies #12'],
  ['qualification started', `set constraints all immediate; alter table highdarts_fixtures disable trigger highdarts_require_counting_choices; insert into highdarts_fixtures(event_id,stage,fixture_no,player_a_name,player_b_name) values(${event},'tiebreak',1,'Jon','Johan');`, 'Qualification has started'],
]) {
  run(`${change}
  create temporary table guarded_before as select * from highdarts_fixtures;
  ${rejection('perform pg_temp.accept_reports()', message)}
  do $$ begin if exists((select * from highdarts_fixtures except select * from guarded_before) union all (select * from guarded_before except select * from highdarts_fixtures)) then raise exception 'Partial import escaped rollback'; end if; end $$;`);
  console.log(`Passed: ${label} aborts the complete import`);
}
run(`update matches set highdarts_fixture_id=null; update highdarts_fixtures set match_id=null; delete from highdarts_fixtures; delete from matches; delete from players; select pg_temp.accept_reports();`);
console.log('Passed: fresh database without reviewed production identities is a no-op; all transactions rolled back');
