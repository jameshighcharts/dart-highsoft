// Run with the standalone worker loader. Local-only, all fixtures/schema changes roll back.
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { createInterface } from 'node:readline';
import { ScoliaAtomicIngestion } from '../src/lib/server/scoliaAtomicIngestion.ts';
import { recomputeLegTurns } from '../src/lib/server/recomputeLegTurns.ts';
const url = process.env.SCOLIA_TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:65422/postgres';
if (!['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname)) throw new Error('This rollback harness only accepts a local database');
const child = spawn('psql',['-X','-qAt','-v','ON_ERROR_STOP=1',url],{stdio:['pipe','pipe','pipe']});
let pending; let errors='';
child.stderr.on('data',data=>{errors+=data.toString();});
child.on('exit',code=>{pending?.reject(new Error(`psql exited ${code}: ${errors}`));pending=null;});
createInterface({input:child.stdout}).on('line',line=>{
  if (!pending) return;
  if(line===pending.marker){const done=pending;pending=null;done.resolve(done.lines);}
  else pending.lines.push(line);
});
function sql(text){return new Promise((resolve,reject)=>{
  assert.ok(!pending);const marker=randomUUID();pending={resolve,reject,marker,lines:[]};
  child.stdin.write(`${text};\nselect '${marker}';\n`);
});}
const quote=value=>`'${String(value).replaceAll("'","''")}'`;
const scalar=async text=>JSON.parse((await sql(`select to_jsonb((${text}))`))[0] || 'null');
let fullReads=0, commits=0, beforeCommit=null;
const rpcCalls=[];
const supabase={rpc:async(name,args)=>{
  rpcCalls.push(name);
  if(name==='commit_scolia_x01_throw'){commits++;if(beforeCommit){const hook=beforeCommit;beforeCommit=null;await hook();}}
  const parameters=Object.entries(args).map(([key,value])=>`${key} => ${value===null?'null':typeof value==='object'?`${quote(JSON.stringify(value))}::jsonb`:typeof value==='number'?value:quote(value)}`).join(',');
  const data=await scalar(`public.${name}(${parameters})`);
  if((name==='prepare_scolia_x01_throw' && data.snapshot) || data?.prepared?.snapshot)fullReads++;
  return {data,error:null};
}};
async function fixture(count,fair=false,legs=1){
  const ids=Array.from({length:count},()=>randomUUID());const board=randomUUID();
  await sql(`insert into public.players(id,display_name,is_test) values ${ids.map(id=>`(${quote(id)},${quote('Atomic integration '+id)},true)`).join(',')}`);
  await sql(`insert into public.scolia_boards(id,serial_number,name) values(${quote(board)},${quote(board)},'Atomic integration')`);
  const match=await scalar(`(select id from public.create_x01_match_atomic('201','double_out',${legs},${fair},array[${ids.map(id=>`${quote(id)}::uuid`).join(',')}]))`);
  await sql(`update public.matches set scolia_board_id=${quote(board)} where id=${quote(match)}`);
  const owner=new ScoliaAtomicIngestion(supabase);const results=[];
  async function dart(segment='Miss',scored=0){
    const raw={board_id:board,message_id:randomUUID(),event_type:'THROW_DETECTED',payload:{sector:segment},
      occurred_at:null,received_at:new Date().toISOString()};
    const {event,prepared}=await owner.persistAndPrepare(raw);
    const result=await owner.ingest(event,{segment,scored},prepared);results.push({event,result});return result;
  }
  return {ids,match,owner,results,dart};
}
try{
  await sql('begin');
  const bullExists=await scalar("exists(select 1 from information_schema.columns where table_schema='public' and table_name='matches' and column_name='bull_off')");
  if(!bullExists)await sql(await readFile(new URL('../supabase/migrations/20260909120000_x01_bull_off.sql',import.meta.url),'utf8'));
  await sql(await readFile(new URL('../supabase/migrations/20260909160000_atomic_scolia_scoring.sql',import.meta.url),'utf8'));
  await sql(await readFile(new URL('../supabase/migrations/20260909170000_persist_prepare_scolia_throw.sql',import.meta.url),'utf8'));
  const long=await fixture(7);const baseline=fullReads;
  const callBaseline=rpcCalls.length;
  for(let i=0;i<420;i++)assert.equal((await long.dart()).status,'processed');
  assert.deepEqual(rpcCalls.slice(callBaseline),Array.from({length:420},()=>['persist_and_prepare_scolia_throw','commit_scolia_x01_throw']).flat());
  const original=long.results[0].event;
  const duplicate=await long.owner.persistAndPrepare({...original,payload:{sector:'T20'}});
  assert.deepEqual(duplicate.event.payload,original.payload);
  assert.equal(duplicate.event.id,original.id);
  assert.equal(duplicate.prepared,null);
  assert.equal(await scalar("has_function_privilege('authenticated','public.persist_and_prepare_scolia_throw(jsonb,uuid,text)','EXECUTE')"),false);
  assert.equal(fullReads-baseline,1,'only the first unchanged-leg prepare downloads history');
  assert.equal(await scalar(`(select count(*) from public.throws where match_id=${quote(long.match)})`),420);
  const last=long.results.at(-1);await long.owner.ingest(last.event,{segment:'Miss',scored:0});
  assert.equal(await scalar(`(select count(*) from public.throws where match_id=${quote(long.match)})`),420);
  await sql(`delete from public.throws where id=${quote(last.result.throwId)}`);
  assert.equal((await long.owner.ingest(last.event,{segment:'Miss',scored:0})).status,'ignored','undo must not resurrect a consumed detection');

  const tie=await fixture(2,true);
  for(let i=0;i<6;i++)await tie.dart('T20',60);
  await tie.dart('S1',1);await tie.dart('D10',20);
  assert.equal(await scalar(`(select winner_player_id from public.matches where id=${quote(tie.match)})`),null);
  await tie.dart('S1',1);await tie.dart('D10',20);
  for(let i=0;i<6;i++)await tie.dart('S20',20);
  for(let i=0;i<3;i++)await tie.dart('T20',60);
  for(let i=0;i<3;i++)await tie.dart('S20',20);
  assert.equal(await scalar(`(select winner_player_id from public.matches where id=${quote(tie.match)})`),tie.ids[0]);
  assert.equal(await scalar(`(select count(*) from public.elo_ratings where match_id=${quote(tie.match)})`),2);

  const race=await fixture(2);for(let i=0;i<3;i++)await race.dart('T20',60);for(let i=0;i<3;i++)await race.dart();
  const prior=race.results[0].result.throwId;const before=commits;
  beforeCommit=()=>sql(`update public.throws set segment='S20',scored=20 where id=${quote(prior)}`);
  await race.dart('S1',1);assert.equal(commits-before,2,'a correction must reject and retry a stale plan');
  await race.dart('D10',20);
  assert.equal(await scalar(`(select winner_player_id from public.matches where id=${quote(race.match)})`),null);
  const leg=await scalar(`(select id from public.legs where match_id=${quote(race.match)})`);
  await recomputeLegTurns(supabase,leg,201,'double_out');
  assert.equal(await scalar(`(select total_scored from public.turns where leg_id=${quote(leg)} and turn_number=1)`),140);

  const multi=await fixture(7);for(let i=0;i<21;i++)await multi.dart('T20',60);await multi.dart('S1',1);await multi.dart('D10',20);
  assert.equal(await scalar(`(select count(*) from public.elo_ratings_multi where match_id=${quote(multi.match)})`),7);
  const legs=await fixture(2,false,2);for(let i=0;i<3;i++)await legs.dart('T20',60);for(let i=0;i<3;i++)await legs.dart();await legs.dart('S1',1);await legs.dart('D10',20);
  assert.equal(await scalar(`(select starting_player_id from public.legs where match_id=${quote(legs.match)} and leg_number=2)`),legs.ids[1]);
  assert.equal((await legs.dart()).accepted.rows.turn.player_id,legs.ids[1]);
  // A preparation failure must not roll back the raw event needed for recovery.
  const originalPrepare=await scalar("pg_get_functiondef('public.prepare_scolia_x01_throw(bigint,uuid,text)'::regprocedure)");
  await sql(`create or replace function public.prepare_scolia_x01_throw(p_event_id bigint,p_known_match_id uuid default null,p_known_revision text default null)
    returns jsonb language plpgsql stable security invoker set search_path='' as $$ begin raise exception 'injected preparation failure'; end $$`);
  const failedPrepare=await long.owner.persistAndPrepare({...original,message_id:randomUUID(),received_at:new Date().toISOString()});
  assert.equal(failedPrepare.prepared,null);
  assert.equal(await scalar(`exists(select 1 from public.scolia_events where id=${failedPrepare.event.id})`),true);
  await sql(originalPrepare);
  assert.equal((await long.owner.ingest(failedPrepare.event,{segment:'Miss',scored:0})).status,'processed');
  console.log('Passed: two sequential requests per dart, durable preparation-failure recovery, 420-dart cache reuse, duplicate/undo safety, stale correction retry, fair-ending tiebreaks, 1v1/multiplayer Elo, next-leg rotation, atomic correction recomputation.');
}finally{if(child.exitCode===null){await sql('rollback');child.stdin.end();}}
