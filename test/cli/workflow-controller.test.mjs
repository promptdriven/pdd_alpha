import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import vectors from '../../vectors/cli/workflow-controller.json' with {type:'json'};
import {startWorkflowController,readControllerLaunches} from '../../src/workflow-controller.mjs';
import {runId,folder,fakeLocks} from './runner-a-fixtures.mjs';
async function fixture(t,id){
  const runDir=join(await folder(t),runId);await fs.mkdir(runDir);
  const runtime={node:'/saved/node',bin:'/saved/bin/pdd.mjs'};
  const spec={runId,runDir,root:'/assigned',workflow:'feature',issueNumber:7,runtime};
  const calls=[],state={runId,root:spec.root,name:'feature',issue:{number:7},runtime,controlState:'running'},proof={};
  const ports={acquireLock:fakeLocks(),now:()=>60000,withLifecycleGuard:async(s,fn)=>fn(),validateRun:async()=>true,inspectControllerLock:async()=> 'free',readWorkflowJournal:async()=>({state,seq:2}),herdr:{
    supportsProcessIdentity:async()=>true,
    listWorkspaces:async()=>[{workspaceId:'w1',cwd:spec.root}],
    createWorkspace:async p=>{calls.push(['workspace',p]);return {workspaceId:'w2'};},
    createTab:async p=>{calls.push(['tab',p]);return {tabId:'w1:t1',paneId:'w1:p1',terminalId:'term'};},
    paneRun:async p=>{
      calls.push(['run',p]);const intent=(await readControllerLaunches(spec)).at(-1);
      state.controller={started:true,launchId:intent.launchId,generation:(intent.previousGeneration??0)+1,pid:123,startIdentity:'boot:start',paneId:'w1:p1'};
      proof.process={pid:123,startIdentity:'boot:start',paneId:'w1:p1',executable:runtime.node,argv:intent.argv};
      if(id==='wrong-node')proof.process.executable='/wrong/node';
      if(id==='reused-pid')proof.process.startIdentity='other:start';
      if(id==='live-without-generation')delete state.controller;
      if(id==='wrong-controller-generation')state.controller.generation=7;
      if(id==='lost-type-with-proof')throw Error('reply lost');
    },
    processInfo:async()=>['typed-without-process','duplicate-intent'].includes(id)?null:proof.process
  }};
  return {spec,ports,calls,state};
}
for(const c of vectors.cases)test(`controller vector: ${c.id}`,async t=>{
  const f=await fixture(t,c.id);
  if(c.id==='unsafe-path')f.spec.runtime.node=c.given.runtimeNode;
  if(c.id==='intent-not-durable')f.ports.fs={...fs,open:async(path,...args)=>{const h=await fs.open(path,...args);h.sync=async()=>{throw Error('disk full');};return h;}};
  if(c.id==='duplicate-intent'){await startWorkflowController(f.spec,f.ports);f.calls.length=0;}
  const result=await startWorkflowController(f.spec,f.ports);
  if(c.expected.state)assert.equal(result.state,c.expected.state);
  if(c.expected.code)assert.equal(result.code,c.expected.code);
  if(c.expected.started===false)assert.notEqual(result.state,'started');
  if(c.expected.proofPersisted)assert.ok((await readControllerLaunches(f.spec)).at(-1).proof);
  if(c.expected.controllerPaneCount)assert.equal(f.calls.filter(x=>x[0]==='tab').length,c.expected.controllerPaneCount);
  if(c.expected.newRunTabCreated===false||c.expected.newRunTabCreated===false||c.expected.newRunTab===false)assert.equal(f.calls.filter(x=>x[0]==='tab').length,0);
  if(c.expected.controllerCommandDelivered===false||c.expected.effects===0)assert.equal(f.calls.filter(x=>x[0]==='run').length,0);
  if(c.id==='saved-runtime'){const line=f.calls.find(x=>x[0]==='run')[1].command;assert.ok(line.includes("'/saved/node' '/saved/bin/pdd.mjs'"));}
  if(c.id==='focus-and-ownership'){const tab=f.calls.find(x=>x[0]==='tab')[1];assert.equal(tab.session,'default');assert.equal(tab.focus,false);assert.equal(f.calls.find(x=>x[0]==='run')[1].paneId,'w1:p1');}
});
test('controller callers share admission and uncertain delivery is never repeated',async t=>{
  const f=await fixture(t,'typed-without-process');const results=await Promise.all([startWorkflowController(f.spec,f.ports),startWorkflowController(f.spec,f.ports)]);
  assert.equal(f.calls.filter(x=>x[0]==='run').length,1);assert.ok(results.some(r=>r.code==='controller_busy'));
  await startWorkflowController(f.spec,f.ports);assert.equal(f.calls.filter(x=>x[0]==='run').length,1);
});
test('unsupported process schema refuses before any durable or native effect',async t=>{const f=await fixture(t,'');f.ports.herdr.supportsProcessIdentity=async()=>false;assert.equal((await startWorkflowController(f.spec,f.ports)).code,'unsupported');assert.deepEqual(f.calls,[]);assert.deepEqual(await readControllerLaunches(f.spec),[]);});
test('stale human revision refuses under the gate',async t=>{const f=await fixture(t,'');f.state.controlState='waiting_person';f.state.rev=58;f.spec.decision={decision:'approve',id:runId,rev:57};assert.equal((await startWorkflowController(f.spec,f.ports)).code,'stale_decision');assert.deepEqual(f.calls,[]);});
test('proved controller exit is reconciled before a new launch generation is admitted',async t=>{
  const f=await fixture(t,'');assert.equal((await startWorkflowController(f.spec,f.ports)).state,'started');
  const original=f.ports.herdr.processInfo;
  f.ports.herdr.processInfo=async()=>({...await original(),stopped:true});
  assert.equal((await startWorkflowController(f.spec,f.ports)).code,'controller_exited');
  assert.equal(f.calls.filter(x=>x[0]==='run').length,1);
  f.ports.herdr.processInfo=original;
  const next=await startWorkflowController(f.spec,f.ports);assert.equal(next.state,'started');assert.equal(next.controller.generation,2);assert.equal(f.calls.filter(x=>x[0]==='run').length,2);
});
test('failed capability reads and unknown controller locks refuse without launch',async t=>{const f=await fixture(t,'');f.ports.herdr.supportsProcessIdentity=async()=>{throw Error('unavailable');};assert.equal((await startWorkflowController(f.spec,f.ports)).code,'unsupported');f.ports.herdr.supportsProcessIdentity=async()=>true;f.ports.inspectControllerLock=async()=> 'unknown';assert.equal((await startWorkflowController(f.spec,f.ports)).code,'controller_busy');assert.equal(f.calls.length,0);});
test('controller rejects all unsupported path characters before effects',async t=>{for(const node of ["/saved/path'quote/node",'/saved/back\\slash/node','/saved/line\n/node','/saved/\u0085/node','relative/node']){const f=await fixture(t,'');f.spec.runtime.node=node;assert.equal((await startWorkflowController(f.spec,f.ports)).code,'unsupported');assert.deepEqual(f.calls,[]);}});
