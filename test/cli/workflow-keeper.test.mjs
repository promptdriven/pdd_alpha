import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import vectors from '../../vectors/cli/workflow-keeper.json' with {type:'json'};
import {reconcileWorkflowControllers,runWorkflowKeeper,discoverWorkflowRuns,restoreManagedWorkflowSession} from '../../src/workflow-keeper.mjs';
import {runId,folder,fakeLocks} from './runner-a-fixtures.mjs';
function fixture(){
  const entries=[{runId,runDir:`/saved/pdd/workflows/${runId}`,root:'/assigned'}],state={runId,controlState:'running',name:'feature',root:'/assigned',runtime:{releaseId:'old'},issue:{number:7}},launches=[],calls=[];
  let time=30000;
  const ports={observations:new Map(),validateLocator:async()=>true,readWorkflowJournal:async()=>({state,seq:1}),observeHerdr:async()=>({upSince:0,stableSince:0,complete:true}),inspectWorkflowLock:async()=> 'free',readControllerLaunches:async()=>launches,checkWorkflowRuntime:async()=>({ok:true}),startWorkflowController:async spec=>{calls.push(spec);return {state:'started',code:null};}};
  return {entries,state,launches,calls,ports,pass:async(now=time)=>{time=now;return reconcileWorkflowControllers({entries,now},ports);}};
}
for(const priorIntent of [true,false])test(`keeper preserves known missing-path controller message and state, priorIntent=${priorIntent}`,async()=>{
 const f=fixture(),message='Herdr not found at /saved/runtime/herdr',calls=[];
 if(priorIntent)f.launches.push({admittedAt:1000,phase:'pane.run.intent',decision:null});
 f.ports.startWorkflowController=async spec=>{calls.push(spec);return {state:'uncertain',code:'herdr_not_found',message};};
 await f.pass(30000);const result=await f.pass(60000);
 assert.deepEqual(result,[{runId,state:'uncertain',code:'herdr_not_found',message,...(priorIntent?{inspectOriginal:true}:{})}]);
 assert.equal(calls.length,1);assert.equal(calls[0].runtime,f.state.runtime);
 assert.equal(Object.hasOwn(calls[0],'decision'),priorIntent);
});
test('keeper does not forward arbitrary controller error text',async()=>{
 const f=fixture();f.ports.startWorkflowController=async()=>({state:'uncertain',code:'launch_uncertain',message:'untrusted raw diagnostic'});
 await f.pass(30000);const [result]=await f.pass(60000);
 assert.equal(result.state,'uncertain');assert.equal(result.code,'launch_uncertain');assert.equal(Object.hasOwn(result,'message'),false);
});
for(const c of vectors.cases)test(`keeper vector: ${c.id}`,async t=>{
  const f=fixture();
  switch(c.id){
    case 'human-wait':case 'fixed-quota-stays-stopped':f.state.controlState='waiting_person';f.state.waitingPerson={origin:'quota'};break;
    case 'question-lost':f.state.controlState='question_lost';break;
    case 'budget-boundary':for(let i=0;i<3;i++)f.launches.push({admittedAt:1000,phase:'exited'});break;
    case 'uncertain-launch':f.launches.push({admittedAt:1000,phase:'pane.run.intent',decision:null});f.ports.startWorkflowController=async spec=>{assert.equal(spec.decision,null);return {state:'uncertain',code:'launch_uncertain'};};break;
    case 'quota-observation':f.state.controlState='WAIT';f.state.quota={until:1000};f.ports.observeQuota=async()=>{throw Error('network failure');};break;
    case 'legacy-unadopted':f.state.adopted=false;delete f.state.controlState;break;
    case 'unstable-herdr':f.ports.observeHerdr=async()=>({upSince:30000,stableSince:55001,complete:true});break;
    case 'nonmanaged-command-pass-through':assert.deepEqual(await restoreManagedWorkflowSession({},{}),{state:'unmanaged'});return;
    case 'managed-restore':assert.equal((await restoreManagedWorkflowSession({launchId:runId,generation:3},{readManagedLaunch:async()=>({launchId:runId,generation:4})})).state,'retired');return;
    case 'public-runs-keeper-service':{
      const home=await folder(t),abort=new AbortController(),intervals=[];let active=0;
      const p={...f.ports,signal:abort.signal,acquireLock:fakeLocks(),wait:async ms=>{intervals.push(ms);assert.equal(active,0);abort.abort();},fs:{...fs,readdir:async()=>{active++;await Promise.resolve();active--;return [];}}};
      assert.equal((await runWorkflowKeeper({home},p)).exitCode,0);assert.deepEqual(intervals,[30000]);return;
    }
    case 'service-owner-contention':{
      const home=await folder(t),abort=new AbortController(),p={signal:abort.signal,acquireLock:async()=>({state:'busy'}),startWorkflowController:()=>assert.fail()};
      assert.equal((await runWorkflowKeeper({home},p)).state,c.expected.secondOwnerResult);return;
    }
    case 'restore-policy-revision':f.state.machineToolPolicy={revision:8,targetAccountId:'b'};break;
  }
  await f.pass(30000);const r=await f.pass(c.id==='one-free-check'?59999:60000);
  if(c.expected.driveLaunches!==undefined)assert.equal(f.calls.length,c.expected.driveLaunches,c.id);
  if(c.expected.controllerStarted===false)assert.equal(f.calls.length,0);
  if(c.expected.needsYou)assert.equal(r[0].state,'needs_you');
  if(c.expected.inspectOriginal)assert.equal(r[0].inspectOriginal,true);
  if(c.expected.retryObservation)assert.equal(r[0].retryObservation,true);
  if(c.id==='restore-policy-revision'){assert.equal(f.calls.length,1);assert.equal(f.calls[0].runtime.releaseId,'old');assert.equal('accountId' in f.calls[0],false);}
  if(c.id==='alpha-only'||c.id==='restart-after-death')assert.equal(f.calls[0].decision,undefined);
});
test('discovery includes registry when display append was lost and warns on corruption',async t=>{
  const home=await folder(t),dir=join(home,'.pdd','runs','registry');await fs.mkdir(dir,{recursive:true});
  const entry={v:1,runId,commonDir:'/repo/.git',root:'/assigned',runDir:`/repo/.git/pdd/workflows/${runId}`};
  await fs.writeFile(join(dir,`${runId}.json`),JSON.stringify(entry));await fs.writeFile(join(dir,'bad.json'),'{');
  const r=await discoverWorkflowRuns({home});assert.deepEqual(r.entries,[entry]);assert.ok(r.warnings.some(w=>w.startsWith('registry_invalid')));
});
test('blocked question, unknown lock and corrupt journal never relaunch',async()=>{
  for(const mode of ['blocked','unknown','damaged']){
    const f=fixture();if(mode==='blocked')f.state.pending={backend:{agentStatus:'blocked'}};
    if(mode==='unknown')f.ports.inspectWorkflowLock=async()=> 'unknown';
    if(mode==='damaged')f.ports.readWorkflowJournal=async()=>{throw Error('damaged');};
    await f.pass(30000);await f.pass(60000);assert.equal(f.calls.length,0);
  }
});
test('quota due is observation-only until a fresh room answer',async()=>{const f=fixture();f.state.controlState='WAIT';f.state.quota={until:1000};f.ports.observeQuota=async()=>({fresh:true,room:true});await f.pass(30000);await f.pass(60000);assert.equal(f.calls.length,1);});
test('a missing recovery registry stays visible through the index but cannot launch',async t=>{
  const home=await folder(t),dir=join(home,'.pdd','runs');await fs.mkdir(dir,{recursive:true});const entry={runId,runDir:`/saved/pdd/workflows/${runId}`,root:'/assigned'};await fs.writeFile(join(dir,'index.jsonl'),JSON.stringify(entry)+'\n');
  const discovered=await discoverWorkflowRuns({home});assert.equal(discovered.entries.length,1);assert.ok(discovered.warnings.includes(`registry_missing_or_invalid:${runId}`));
  const f=fixture();const r=await reconcileWorkflowControllers({entries:discovered.entries,now:60000},f.ports);assert.equal(r[0].code,'registry_missing_or_invalid');assert.equal(f.calls.length,0);
});
test('managed restore reconciles policy through its owner before acquiring the native claim',async()=>{
  const events=[],record={launchId:runId,generation:4,kind:'codex',nativeSessionId:'9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d',runtime:{releaseId:'old'},flags:['--saved-flag'],managedAccount:true};
  const ports={readManagedLaunch:async()=>record,validateManagedRuntime:async()=>true,validateManagedFlags:async()=>true,accountAdapter:{reconcileRestore:async()=>{events.push('policy');return {ready:true};}},validateOwner:async()=>({state:'current'}),acquireLock:async()=>{events.push('claim');return {state:'owned',release:async()=>{}};},restoreNative:async(actual,claim)=>{events.push('restore');assert.equal(actual.runtime.releaseId,'old');await claim.release();return {state:'restored'};}};
  assert.equal((await restoreManagedWorkflowSession({launchId:runId,generation:4},ports)).state,'restored');assert.deepEqual(events,['policy','claim','restore']);
  ports.accountAdapter.reconcileRestore=async()=>({ready:false,code:'fixed_full'});ports.acquireLock=()=>assert.fail('fixed quota question cannot claim or restore');assert.equal((await restoreManagedWorkflowSession({launchId:runId,generation:4},ports)).code,'fixed_full');
});
