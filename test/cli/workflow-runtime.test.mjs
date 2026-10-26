import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import vectors from '../../vectors/cli/workflow-runtime.json' with {type:'json'};
import {freezeWorkflowInputs,readWorkflowRuntime,checkWorkflowRuntime,upgradeWorkflowRuntime,listWorkflowRuntimeReferences} from '../../src/workflow-runtime.mjs';
import {runtimeFixture,runId} from './runner-a-fixtures.mjs';
for(const c of vectors.cases)test(`runtime vector: ${c.id}`,async t=>{
  const f=await runtimeFixture(t);const frozen=await freezeWorkflowInputs(f);
  const check=()=>checkWorkflowRuntime(f);
  switch(c.id){
    case 'freeze-full-context':{
      assert.equal(await fs.readFile(join(f.runDir,'frozen','input-0.txt'),'utf8'),f.guidance);
      for(let i=0;i<f.definition.files.length;i++)assert.equal(await fs.readFile(join(f.runDir,'frozen',`input-${i+2}.txt`),'utf8'),f.definition.files[i].content);
      assert.equal(JSON.stringify(frozen).includes('process.env'),false);break;
    }
    case 'source-changed':f.definition.files[0].content='changed source';f.guidance='changed';assert.equal((await check()).ok,true);break;
    case 'freeze-changed':await fs.writeFile(join(f.runDir,'frozen','input-0.txt'),'changed frozen');assert.deepEqual(await check(),{ok:false,code:c.expected.code});break;
    case 'node-missing':await fs.unlink(f.runtime.bin);assert.deepEqual(await check(),{ok:false,code:c.expected.code});break;
    case 'partial-freeze':await fs.unlink(join(f.runDir,'frozen','complete.json'));assert.equal((await check()).ok,false);await assert.rejects(freezeWorkflowInputs(f),{code:'EEXIST'});break;
    case 'multi-release-run':{
      assert.deepEqual((await readWorkflowRuntime(f)).runtime.future,{retained:true});
      const census=await listWorkflowRuntimeReferences({entries:[{runId,runDir:f.runDir}]},{readWorkflowJournal:async()=>({seq:1,state:{controlState:'WAIT',runtime:f.runtime}})});
      assert.equal(census.complete,true);assert.equal(census.references[0].runtime.releaseId,'old');break;
    }
    case 'upgrade-not-consent':assert.equal((await readWorkflowRuntime(f)).runtime.releaseId,'old');assert.equal((await check()).ok,true);break;
    case 'stock-tool-change':assert.equal((await readWorkflowRuntime(f)).runtime.codexVersion,null);assert.equal((await check()).ok,true);break;
    case 'freeze-seed-complete':assert.deepEqual((await readWorkflowRuntime(f)).seed,f.seed);break;
    case 'raw-unknown-control-preserved':{
      const state={controlState:'future-state',runtime:f.runtime};await listWorkflowRuntimeReferences({entries:[{runId,runDir:f.runDir}]},{readWorkflowJournal:async()=>({seq:1,state})});assert.equal(state.controlState,c.expected.rawControlStateAfterRewrite);break;
    }
    case 'blocked-pinned-run':assert.deepEqual(await checkWorkflowRuntime({...f,releasePolicy:{blocked:['old']}}),{ok:false,code:'runtime_blocked',next:'Upgrade run'});assert.equal((await readWorkflowRuntime(f)).runtime.releaseId,'old');break;
    case 'freeze-project-and-selection':assert.deepEqual(frozen.seed.project,c.expected.frozenProject);assert.equal(frozen.seed.launchSelection.model,c.expected.frozenSelection.model);assert.equal(frozen.seed.launchSelection.effort,'high');break;
    default:{
      const target={...f.runtime,releaseId:'new'},events=[],state={rev:57,controlState:'waiting_person',stopped:true,runtime:f.runtime,upgrades:[]};
      const ports={withUpgradeGuard:async(spec,action)=>action({state,appendUpgrade:async e=>{events.push(e.event);if((c.id==='upgrade-before-commit-crash'&&e.event==='upgrade.committed')||(c.id==='upgrade-target-conflict'&&e.event==='upgrade.intent'))throw Error('crash');state.upgrades.push(e);if(e.event==='upgrade.committed'){state.runtime=e.newRuntime;state.rev++;}}})};
      const args={runDir:f.runDir,expectedRev:57,target};
      if(c.id==='upgrade-stale-revision')state.rev=58;
      if(c.id==='upgrade-live-turn')state.stageLive=true;
      let result=await upgradeWorkflowRuntime(args,ports);
      if(c.id==='upgrade-target-conflict')result=await upgradeWorkflowRuntime({...args,target:{...target,releaseId:'different'}},ports);
      if(c.id==='upgrade-repeat-current-request'||c.id==='upgrade-after-commit-crash'||c.id==='upgrade-before-commit-crash')result=await upgradeWorkflowRuntime(args,ports);
      if(c.expected.state)assert.equal(result.state,c.expected.state);
      if(c.expected.code!==undefined)assert.equal(result.code,c.expected.code);
      if(c.expected.journalEvents)assert.deepEqual(events,c.expected.journalEvents);
      if(c.id==='upgrade-stale-revision'||c.id==='upgrade-live-turn'){assert.deepEqual(events,[]);assert.equal(state.runtime.releaseId,'old');}
      if(c.id==='upgrade-before-commit-crash'){assert.equal(state.runtime.releaseId,'old');assert.equal(result.state,'recovery_required');assert.deepEqual(events,['upgrade.intent','upgrade.committed']);}
      if(c.id==='upgrade-after-commit-crash'||c.id==='upgrade-repeat-current-request'){assert.equal(state.runtime.releaseId,'new');assert.deepEqual(events,['upgrade.intent','upgrade.committed']);}
      if(c.id==='upgrade-target-conflict'){assert.equal(result.state,'refused');assert.equal(state.runtime.releaseId,'old');}
    }
  }
});
test('runtime census fails closed on unreadable and changing journals',async t=>{
  const f=await runtimeFixture(t);await freezeWorkflowInputs(f);
  assert.equal((await listWorkflowRuntimeReferences({entries:[{runDir:f.runDir}]})).complete,false);
  let seq=0;const p={readWorkflowJournal:async()=>({seq:++seq,state:{controlState:'WAIT',runtime:f.runtime}})};
  assert.equal((await listWorkflowRuntimeReferences({entries:[{runDir:f.runDir}]},p)).complete,false);
});
test('upgrade requires a real guard and never chooses current by itself',async t=>{const f=await runtimeFixture(t);await freezeWorkflowInputs(f);assert.deepEqual(await upgradeWorkflowRuntime({runDir:f.runDir,expectedRev:57,target:f.runtime}),{state:'refused',code:'unsupported'});});
test('pending upgrade retains both runtimes without inventing commit',async t=>{
  const f=await runtimeFixture(t);await freezeWorkflowInputs(f);const state={runtime:f.runtime,controlState:'WAIT',rev:57,stopped:true};
  await upgradeWorkflowRuntime({runDir:f.runDir,expectedRev:57,target:{...f.runtime,releaseId:'new'}},{withUpgradeGuard:async(_,fn)=>fn({state,appendUpgrade:async()=>{throw Error('lost durability');}})});
  const r=await listWorkflowRuntimeReferences({entries:[{runId,runDir:f.runDir}]},{readWorkflowJournal:async()=>({state,seq:1})});assert.equal(r.complete,true);assert.ok(r.references.some(r=>r.pendingUpgrade&&r.runtime.releaseId==='new'));assert.equal(state.runtime.releaseId,'old');
});
test('upgrade accepts the installed Runtime interface and adds matching packageRoot alias',async t=>{
  const f=await runtimeFixture(t);await freezeWorkflowInputs(f);const target={...f.runtime,releaseId:'new'};delete target.packageRoot;
  const state={rev:57,controlState:'WAIT',stopped:true,runtime:f.runtime,upgrades:[]};
  const result=await upgradeWorkflowRuntime({runDir:f.runDir,expectedRev:57,target},{withUpgradeGuard:async(_,fn)=>fn({state,appendUpgrade:async e=>{state.upgrades.push(e);if(e.event==='upgrade.committed')state.runtime=e.newRuntime;}})});
  assert.equal(result.state,'upgraded');assert.equal(state.runtime.packageRoot,target.versionRoot);assert.deepEqual(state.runtime.future,target.future);
});
