import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

if (process.env.HIGHDARTS_ABSENCES_NATIVE !== '1') throw new Error('Set HIGHDARTS_ABSENCES_NATIVE=1 for the disposable local database');
const migration = (name) => readFileSync(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8').replace(/^begin;/, '').replace(/commit;\s*$/, '');
const nick = 'f416c614-c8b9-4f85-988e-17926044b09d';
const babar = 'd1da69a2-35b8-4174-b584-bcb8f8fe5fc4';
const setup = `
create type public.x01_start as enum ('201','301','501');
create type public.finish_rule as enum ('single_out','double_out');
create table players(id uuid primary key, display_name text, avatar_url text, is_active boolean default true, is_test boolean default false, nicknames text[]);
create table matches(id uuid primary key, winner_player_id uuid, completed_at timestamptz, ended_early boolean default false, paused_at timestamptz);
create table match_players(match_id uuid, player_id uuid);
create table background_jobs(id uuid primary key, dedupe_key text, kind text, payload jsonb);
create table slack_player_links(team_id text, slack_user_id text, player_id uuid);
create table legs(id uuid primary key, match_id uuid, winner_player_id uuid);
create table turns(id uuid primary key, leg_id uuid, player_id uuid, total_scored integer, busted boolean, tiebreak_round integer, turn_number integer);
create table throws(id uuid primary key, turn_id uuid);
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
${migration('20260914120000_highdarts_2026')}
${migration('20260914163000_highdarts_finals')}
${migration('20261006094831_highdarts_accepted_reports')}
`;
const identities = `insert into players(id,display_name) values('${nick}','Nick'),('${babar}','babar');
update highdarts_fixtures set player_a_id = case player_a_name when 'Nicolas Silvester' then '${nick}'::uuid when 'Babar Shah' then '${babar}'::uuid end,
player_b_id = case player_b_name when 'Nicolas Silvester' then '${nick}'::uuid when 'Babar Shah' then '${babar}'::uuid end;`;
const attendance = migration('20261012104051_highdarts_final_absences');
function run(sql) {
  return execFileSync(process.env.PSQL_BIN || 'psql', ['-h','127.0.0.1','-p','56585','-d','hs_week_test','-XAtq','-v','ON_ERROR_STOP=1'], {
    input: `begin;\n${setup}\n${sql}\nrollback;`, stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  });
}
const output = run(`${identities}
create temp table before_snapshot as select highdarts_snapshot() value;
${attendance}
do $$ begin
 if (highdarts_snapshot() - 'absentPlayerIds') <> (select value from before_snapshot) then raise exception 'Changed existing snapshot'; end if;
 if (select count(*) from highdarts_final_absences) <> 2 then raise exception 'Expected two absences'; end if;
 if exists(select 1 from unnest(array['anon','authenticated']) r where has_table_privilege(r,'highdarts_final_absences','SELECT') or has_table_privilege(r,'highdarts_final_absences','INSERT') or has_function_privilege(r,'highdarts_snapshot()','EXECUTE')) then raise exception 'Browser permissions widened'; end if;
 if not has_table_privilege('service_role','highdarts_final_absences','SELECT') or not has_function_privilege('service_role','highdarts_snapshot()','EXECUTE') then raise exception 'Service permissions lost'; end if;
end $$;
select highdarts_snapshot()->'absentPlayerIds';
do $$ begin
 begin
  insert into highdarts_fixtures(event_id,stage,fixture_no,player_a_name,player_b_name,player_a_id)
   select id,'playoff',1,'Nick','TBD','${nick}'::uuid from highdarts_events;
  raise exception 'Expected absent finalist rejection';
 exception when sqlstate '55000' then null; end;
end $$;
update highdarts_final_absences set player_id=player_id;
delete from highdarts_final_absences where player_id='${nick}';
insert into highdarts_final_absences select id,'${nick}'::uuid from highdarts_events where slug='highdarts-2026';
insert into highdarts_fixtures(event_id,stage,fixture_no,player_a_name,player_b_name)
 select id,'final',1,'TBD','TBD' from highdarts_events where slug='highdarts-2026';
do $$ begin
 begin delete from highdarts_final_absences; raise exception 'Expected locked absence'; exception when sqlstate '55000' then null; end;
 begin update highdarts_final_absences set player_id=player_id; raise exception 'Expected locked absence'; exception when sqlstate '55000' then null; end;
end $$;
`);
assert.deepEqual(JSON.parse(output.trim().split('\n').at(-1)).sort(), [nick, babar].sort());
const fresh = run(`${attendance}\nselect highdarts_snapshot()->'absentPlayerIds';`);
assert.deepEqual(JSON.parse(fresh.trim().split('\n').at(-1)), []);
for (const [change, expected] of [
  [`insert into players(id,display_name) values('${nick}','Nick');`, 'Expected both reviewed Bergen players'],
  [`${identities} update highdarts_fixtures set player_a_id=null,player_b_id=null;`, 'Reviewed players must both belong'],
  [`${identities} insert into highdarts_fixtures(event_id,stage,fixture_no,player_a_name,player_b_name) select id,'final',1,'TBD','TBD' from highdarts_events;`, 'Qualification has already started'],
]) {
  assert.throws(() => run(`${change}\n${attendance}`), (error) => String(error.stderr).includes(expected));
}
console.log('Attendance migration passed: exact identities, unchanged history, snapshot, permissions, fresh DB, qualification locks and failure rollback.');
