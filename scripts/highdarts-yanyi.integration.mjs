import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

if (process.env.HIGHDARTS_YANYI_NATIVE !== '1') throw new Error('Set HIGHDARTS_YANYI_NATIVE=1 for the disposable local PostgreSQL test');
const migration = readFileSync(new URL('../supabase/migrations/20261002110000_admit_yanyi_highdarts.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../supabase/migrations/20260914120000_highdarts_2026.sql', import.meta.url), 'utf8').split('alter table public.matches add')[0].replace('begin;', '');
const counting = readFileSync(new URL('../supabase/migrations/20260915090000_highdarts_counted_results.sql', import.meta.url), 'utf8').replace(/^begin;/, '').replace(/commit;\s*$/, '');
const ids = {
  Yanyi: '8e40f0ea-0122-4021-a4fa-ea60e82cb937', Sindre: '13bf0418-ba32-4680-a63c-9a2f223bac3d',
  Jorgen: '37aeaf03-f543-438d-85b3-6aba9c4c06d0', Jon: '36ae9837-7aa9-4db1-84a7-3958bb34ddf9',
  Johan: 'c31193ac-886d-452f-afe7-a8f2bc60c229', Mykhailo: 'c0a76e57-f57b-4402-b569-e466b506382c',
};
const pairs = [['Sindre','Jon'],['Jon','Jorgen'],['Jon','Mykhailo'],['Sindre','Mykhailo'],['Johan','Mykhailo'],['Johan','Sindre'],['Sindre','Jorgen'],['Jorgen','Johan'],['Jorgen','Sindre'],['Mykhailo','Jorgen'],['Mykhailo','Sindre'],['Johan','Jon'],['Jon','Johan']];
const event = 'c318348e-2129-4ce3-ba48-13e6ed3a7441';
const setup = `
create table players(id uuid primary key, display_name text, is_active boolean default true, is_test boolean default false);
create table matches(id uuid primary key);
create table slack_player_links(team_id text, slack_user_id text, player_id uuid);
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
${schema}
${counting}
insert into highdarts_events(id,slug,name) values ('${event}','highdarts-2026','Highdarts');
insert into players(id,display_name) values ${Object.entries(ids).map(([n,id]) => `('${id}','${n}')`).join(',')};
insert into highdarts_fixtures(event_id,stage,office,fixture_no,player_a_name,player_b_name,player_a_id,player_b_id)
values ${pairs.map(([a,b],i) => `('${event}','group','sogndal',${i+1},'${a}','${b}','${ids[a]}','${ids[b]}')`).join(',')};
insert into matches select gen_random_uuid() from generate_series(1,7);
update highdarts_fixtures f set match_id=m.id from
  (select id,row_number() over() n from matches) m
  where fixture_no=(array[3,4,5,6,10,11,12])[m.n];
create temporary table before_fixtures as select * from highdarts_fixtures;
${migration.replace(/^do \$\$/, () => 'create function pg_temp.admit_yanyi() returns void language plpgsql as $$')}
`;
function run(sql) {
  return execFileSync('/Applications/Postgres.app/Contents/Versions/18/bin/psql', ['-h','127.0.0.1','-p','56565','-d','bengt_yanyi_test','-XAt','-v','ON_ERROR_STOP=1'], { input: `begin;\n${setup}\n${sql}\nrollback;`, encoding: 'utf8' });
}
const verified = run(`
update highdarts_fixtures set counts_for_a=false where fixture_no=4;
select pg_temp.admit_yanyi();
select pg_temp.admit_yanyi();
do $$ declare p uuid; choice uuid; begin
  if (select count(*) from highdarts_fixtures)<>17 then raise exception 'Wrong fixture count'; end if;
  if exists(select 1 from highdarts_fixtures f join before_fixtures b using(id)
    where f.fixture_no not in(4,9) and to_jsonb(f)<>to_jsonb(b)) then raise exception 'Other fixtures changed'; end if;
  if (select counts_for_a from highdarts_fixtures where fixture_no=4) then raise exception 'Sindre choice lost'; end if;
  if (select player_b_id from highdarts_fixtures where fixture_no=9)<>'${ids.Yanyi}' then raise exception 'Wrong replacement'; end if;
  foreach p in array array['${ids.Jon}','${ids.Johan}','${ids.Mykhailo}']::uuid[] loop
    select id into choice from highdarts_fixtures where fixture_no>=14 and p in(player_a_id,player_b_id);
    perform set_highdarts_counting_atomic('${event}',p,choice,null,null,null,true);
  end loop;
  if exists(select side.pid from highdarts_fixtures f cross join lateral
    (values(f.player_a_id,f.counts_for_a),(f.player_b_id,f.counts_for_b)) side(pid,counted)
    group by side.pid having count(*) filter(where counted)<>5) then raise exception 'Not everyone has five counting games'; end if;
end $$;
select 'admission, retry, preserved results/exclusion, and all new exclusion choices passed';`);
assert.match(verified, /all new exclusion choices passed/);
const fallback = run(`update highdarts_fixtures set counts_for_b=false where fixture_no=9;
select pg_temp.admit_yanyi();
do $$ begin
if (select player_a_id from highdarts_fixtures where fixture_no=7)<>'${ids.Yanyi}' then raise exception 'Excluded repeat was not preserved'; end if;
if (select counts_for_b from highdarts_fixtures where fixture_no=9) then raise exception 'Exclusion lost'; end if;
end $$;`);
assert.ok(fallback);
for (const [label, change, message] of [
  ['started repeats', `insert into matches values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'); update highdarts_fixtures set match_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' where fixture_no=9; update highdarts_fixtures set counts_for_a=false where fixture_no=7;`, 'No unclaimed'],
  ['qualification started', `alter table highdarts_fixtures disable trigger highdarts_require_counting_choices; insert into highdarts_fixtures(event_id,stage,fixture_no,player_a_name,player_b_name) values('${event}','final',1,'TBD','TBD');`, 'Qualification has started'],
  ['partial admission', `update highdarts_fixtures set player_a_id='${ids.Yanyi}' where fixture_no=8;`, 'Yanyi already has fixtures'],
  ['changed schedule', `update highdarts_fixtures set player_a_id='${ids.Jon}' where fixture_no=8;`, 'agreed fixture counts'],
]) {
  run(`${change}
    create temporary table guarded_before as select * from highdarts_fixtures;
    do $test$ begin
      begin perform pg_temp.admit_yanyi(); raise exception 'Expected admission rejection';
      exception when others then if position('${message}' in sqlerrm)=0 then raise; end if; end;
      if exists((select * from highdarts_fixtures except select * from guarded_before) union all
        (select * from guarded_before except select * from highdarts_fixtures)) then raise exception 'Partial writes escaped rollback'; end if;
    end $test$;`);
  console.log(`Passed: ${label} aborts without partial writes`);
}
console.log('Passed: admission, retry, existing results and choice preservation, fallback repeat, and five counted results for every player');
