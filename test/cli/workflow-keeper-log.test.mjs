import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {folder,runId} from './runner-a-fixtures.mjs';
import {appendKeeperDecision,readKeeperDecision} from '../../src/workflow-keeper-log.mjs';
import {readRunStatus,writeRunStatus} from '../../src/workflow-run-records.mjs';
import {reconcileWorkflowControllers} from '../../src/workflow-keeper.mjs';
const entry={runId,decision:'stopped',code:'observing_lock',at:1000,journalSeq:4,controller:'absent'};
test('C15 one private bounded decision per run per pass including refusal and inspection error',async t=>{
 const home=await folder(t),entries=[{runId,runDir:'/saved/'+runId}];
 const ports={home,validateLocator:async()=>true,readWorkflowJournal:async()=>({state:{runId,controlState:'running'},seq:4}),observeHerdr:async()=>({complete:false}),stderr:{write(){}}};
 await reconcileWorkflowControllers({entries,now:1000},ports);
 ports.readWorkflowJournal=async()=>{throw Error('secret pane text');};
 await reconcileWorkflowControllers({entries,now:2000},ports);
 const path=join(home,'.pdd/logs/keeper.jsonl'),text=await fs.readFile(path,'utf8'),rows=text.trim().split('\n').map(JSON.parse);
 assert.equal(rows.length,2);assert.equal(rows[0].code,'herdr_unsettled');assert.equal(rows[1].code,'recovery_inspection_failed');assert.equal(rows[1].runId,runId);assert.doesNotMatch(text,/secret|saved/);
 assert.equal((await fs.stat(path)).mode&0o777,0o600);assert.equal((await fs.stat(join(home,'.pdd/logs'))).mode&0o777,0o700);
 assert.equal(await fs.access(join(home,'.pdd/logs/herdr-trace.jsonl')).then(()=>true,()=>false),false);
});
test('C15 status shows the current absent-controller reason but never transfers an old observation',async t=>{
 const home=await folder(t),dir=join(home,runId);await fs.mkdir(dir);
 const status={v:1,runId,state:'running',journalSeq:4,updatedAt:999};await writeRunStatus(dir,status);
 await appendKeeperDecision(entry,{home});const observed=await readRunStatus(dir,{home});
 assert.equal(observed.value.state,'recovery_required');assert.equal(observed.value.message,'controller not running; recovery: observing_lock');assert.deepEqual(JSON.parse(await fs.readFile(join(dir,'status.json'),'utf8')),status);
 for(const changed of [{journalSeq:5},{updatedAt:1001},{state:'failed'},{state:'waiting'}]){
  await writeRunStatus(dir,{...status,...changed});const current=await readRunStatus(dir,{home});assert.equal(current.value.state,changed.state??'running');
 }
});
test('C15 held and newly started controllers do not inherit absent status; unknown stays honest',async t=>{
 const home=await folder(t),dir=join(home,runId);await fs.mkdir(dir);await writeRunStatus(dir,{v:1,runId,state:'running',journalSeq:4,updatedAt:999});
 for(const controller of ['held','started','unknown']){
  await appendKeeperDecision({...entry,controller},{home});const value=(await readRunStatus(dir,{home})).value;
  assert.equal(value.state,controller==='unknown'?'unknown':'running');
  if(controller==='unknown')assert.match(value.message,/controller status unknown; recovery: observing_lock/);
 }
});
test('C15 trace selector is honored without raw messages and logging failure cannot change a decision',async t=>{
 const home=await folder(t);await appendKeeperDecision({...entry,arbitrary:'secret'},{home,env:{PDD_TRACE:'git, herdr'}});
 assert.ok((await fs.readFile(join(home,'.pdd/logs/herdr-trace.jsonl'),'utf8')).includes(runId));
 assert.doesNotMatch(await fs.readFile(join(home,'.pdd/logs/keeper.jsonl'),'utf8'),/secret|arbitrary/);
 const got=await reconcileWorkflowControllers({entries:[{runId,runDir:'/saved'}],now:1},{validateLocator:async()=>false,appendKeeperDecision:async()=>{throw Error('disk');}});
 assert.deepEqual(got,[{runId,state:'stopped',code:'locator_invalid'}]);
});
test('C15 diagnostic reader refuses aliases and ignores incomplete final rows',async t=>{
 const home=await folder(t);await appendKeeperDecision(entry,{home});const path=join(home,'.pdd/logs/keeper.jsonl');
 await fs.appendFile(path,'{"v":1');assert.equal((await readKeeperDecision({runId},{home})).code,'observing_lock');
 assert.equal((await appendKeeperDecision(entry,{home,stderr:{write(){}}})).ok,false);
 await fs.unlink(path);const outside=join(home,'outside');await fs.writeFile(outside,'untouched');await fs.symlink(outside,path);
 assert.equal(await readKeeperDecision({runId},{home}),null);assert.equal((await appendKeeperDecision(entry,{home,stderr:{write(){}}})).ok,false);assert.equal(await fs.readFile(outside,'utf8'),'untouched');
});
test('C15 WAIT decisions are recorded and oversized logs are bounded',async t=>{
 const home=await folder(t);assert.equal((await appendKeeperDecision({...entry,decision:'WAIT'},{home})).ok,true);
 const path=join(home,'.pdd/logs/keeper.jsonl'),line=await fs.readFile(path,'utf8');await fs.writeFile(path,line.repeat(Math.floor((1024*1024-1)/Buffer.byteLength(line))));
 assert.equal((await appendKeeperDecision(entry,{home})).ok,true);assert.ok((await fs.stat(path)).size<1024*1024);assert.equal((await readKeeperDecision({runId},{home})).decision,'stopped');
});

test('C15 an uncertain admitted launch invalidates the earlier free-lock observation',async t=>{
 const home=await folder(t),entries=[{runId,runDir:'/saved/'+runId}],ports={home,observations:new Map(),validateLocator:async()=>true,readWorkflowJournal:async()=>({state:{runId,controlState:'running',name:'feature',root:'/assigned',issue:{number:1}},seq:4}),observeHerdr:async()=>({complete:true,upSince:0,stableSince:0}),inspectWorkflowLock:async()=>'free',readControllerLaunches:async()=>[],checkWorkflowRuntime:async()=>({ok:true}),startWorkflowController:async()=>({state:'uncertain',code:'proof_unavailable'})};
 await reconcileWorkflowControllers({entries,now:30000},ports);await reconcileWorkflowControllers({entries,now:60000},ports);
 const seen=await readKeeperDecision({runId},{home});assert.equal(seen.code,'proof_unavailable');assert.equal(seen.controller,'unknown');
});


test('C15 corrupt complete rows refuse append unchanged while diagnostic reads remain lenient',async t=>{
 const home=await folder(t),ports={home,stderr:{write(){}}};
 assert.equal((await appendKeeperDecision(entry,ports)).ok,true);
 const path=join(home,'.pdd/logs/keeper.jsonl'),valid=await fs.readFile(path,'utf8');
 for(const corrupt of ['not-json\n',JSON.stringify({...entry,v:1,controller:'invented'})+'\n',JSON.stringify({...entry,v:1,journalSeq:-1})+'\n']){
  const original=valid+corrupt+valid;await fs.writeFile(path,original);
  assert.equal((await appendKeeperDecision(entry,ports)).ok,false);
  assert.equal(await fs.readFile(path,'utf8'),original);
  assert.equal((await readKeeperDecision({runId},ports)).code,entry.code);
 }
 // Corruption must also refuse before retention could discard the bad row.
 const large='not-json\n'+valid.repeat(Math.floor((1024*1024-10)/Buffer.byteLength(valid)));
 await fs.writeFile(path,large);assert.equal((await appendKeeperDecision(entry,ports)).ok,false);assert.equal(await fs.readFile(path,'utf8'),large);
 await fs.writeFile(path,'');assert.equal((await appendKeeperDecision(entry,ports)).ok,true);
 assert.equal((await appendKeeperDecision(entry,ports)).ok,true);
 assert.equal(await fs.readFile(path,'utf8'),valid+valid);
});


test('C20 C21 current structured keeper diagnostics display fixes and reset time without changing saved status',async t=>{
 const home=await folder(t),dir=join(home,runId);await fs.mkdir(dir);const status={v:1,runId,state:'running',journalSeq:4,updatedAt:999};await writeRunStatus(dir,status);
 for(const diagnostic of [{code:'herdr_not_found',reason:'server_absent'},{code:'launch_budget',resetAt:3601000}]){
  assert.equal((await appendKeeperDecision({...entry,...diagnostic,decision:'needs_you',controller:'unknown',message:'PRIVATE ignored'}, {home})).ok,true);
  const saved=await readKeeperDecision({runId},{home});assert.equal(saved.message,undefined);
  const value=(await readRunStatus(dir,{home})).value;assert.equal(value.state,'recovery_required');
  assert.match(value.message,diagnostic.reason?/Herdr is not running.*pdd setup/:/1970-01-01T01:00:01.000Z.*pdd workflow status.*pdd doctor/);
  assert.deepEqual(JSON.parse(await fs.readFile(join(dir,'status.json'),'utf8')),status);
 }
 const path=join(home,'.pdd/logs/keeper.jsonl'),before=await fs.readFile(path,'utf8');
 for(const bad of [{reason:'raw private text'},{code:'other',resetAt:3601000},{code:'launch_budget',resetAt:1e100}])assert.equal((await appendKeeperDecision({...entry,...bad},{home})).ok,false);
 assert.equal(await fs.readFile(path,'utf8'),before);assert.doesNotMatch(before,/PRIVATE/);
});
