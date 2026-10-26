import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import vectors from '../../vectors/cli/workflow-controller.json' with {type:'json'};
import {startWorkflowController,readControllerLaunches} from '../../src/workflow-controller.mjs';
import {runId,folder,fakeLocks} from './runner-a-fixtures.mjs';
import {readHerdrTrace} from '../../src/herdr-trace.mjs';
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
test('unsupported process schema refuses before any durable or native effect',async t=>{const f=await fixture(t,'');delete f.ports.herdr.supportsProcessIdentity;assert.equal((await startWorkflowController(f.spec,f.ports)).code,'unsupported');assert.deepEqual(f.calls,[]);assert.deepEqual(await readControllerLaunches(f.spec),[]);});
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
test('failed capability reads and unknown controller locks refuse without launch',async t=>{const f=await fixture(t,'');f.ports.herdr.supportsProcessIdentity=async()=>{throw Error('unavailable');};assert.equal((await startWorkflowController(f.spec,f.ports)).code,'herdr_identity_unavailable');assert.equal(f.calls.filter(x=>x[0]==='run').length,0);const g=await fixture(t,'');g.ports.inspectControllerLock=async()=> 'unknown';assert.equal((await startWorkflowController(g.spec,g.ports)).code,'controller_busy');assert.equal(g.calls.length,0);});
test('controller rejects all unsupported path characters before effects',async t=>{for(const node of ["/saved/path'quote/node",'/saved/back\\slash/node','/saved/line\n/node','/saved/\u0085/node','relative/node']){const f=await fixture(t,'');f.spec.runtime.node=node;assert.equal((await startWorkflowController(f.spec,f.ports)).code,'unsupported');assert.deepEqual(f.calls,[]);}});


test('enabled controller trace preserves receivers, once-only calls and saved launch proof',async t=>{
  const f=await fixture(t,'lost-type-with-proof');
  f.ports.home=await folder(t);f.ports.env={PDD_TRACE:'herdr'};
  f.ports.herdr.listWorkspaces=async()=>[];
  const observed=[];
  for(const name of ['listWorkspaces','createWorkspace','createTab','paneRun','processInfo']){
    const original=f.ports.herdr[name];
    f.ports.herdr[name]=async function(request){
      assert.equal(this,f.ports.herdr);observed.push([name,structuredClone(request)]);
      return original.call(this,request);
    };
  }
  const first=await startWorkflowController(f.spec,f.ports);
  assert.equal(first.state,'started');assert.equal(first.controller.generation,1);
  assert.deepEqual(observed.map(([name])=>name),['listWorkspaces','createWorkspace','createTab','paneRun','processInfo']);
  assert.deepEqual(observed[1][1],{session:'default',cwd:f.spec.root,focus:false});
  assert.deepEqual(observed[2][1],{session:'default',workspaceId:'w2',cwd:f.spec.root,label:'run #7 feature',focus:false});
  const intent=(await readControllerLaunches(f.spec)).at(-1);
  assert.equal(observed[3][1].command,intent.line);
  assert.deepEqual(intent.proof.process.argv,intent.argv);
  assert.equal((await startWorkflowController(f.spec,f.ports)).state,'started');
  assert.equal(observed.filter(([name])=>name==='paneRun').length,1);
  const encoded=JSON.stringify(readHerdrTrace(f.ports));
  for(const operation of ['workspace.list','workspace.create','tab.create','pane.run','pane.process_info'])assert.ok(encoded.includes(operation),operation);
  assert.ok(!encoded.includes('/saved/'));assert.ok(!encoded.includes(intent.line));assert.ok(!encoded.includes('run #7 feature'));
});

test('tracing cannot replace controller identity or generation proof',async t=>{
  for(const id of ['reused-pid','live-without-generation','wrong-controller-generation']){
    const f=await fixture(t,id);f.ports.home=await folder(t);f.ports.env={PDD_TRACE:'herdr'};
    const first=await startWorkflowController(f.spec,f.ports);
    assert.equal(first.state,'uncertain');assert.equal(first.code,'process_unproved');
    await startWorkflowController(f.spec,f.ports);
    assert.equal(f.calls.filter(([name])=>name==='run').length,1);
  }
});

test('trace opt-in grants no process capability and creates no file before unsupported refusal',async t=>{
  const f=await fixture(t,'');f.ports.home=await folder(t);f.ports.env={PDD_TRACE:'herdr'};
  delete f.ports.herdr.supportsProcessIdentity;
  assert.deepEqual(await startWorkflowController(f.spec,f.ports),{state:'refused',code:'unsupported',controller:null});
  assert.deepEqual(f.calls,[]);assert.deepEqual(await readControllerLaunches(f.spec),[]);
  assert.deepEqual(await fs.readdir(f.ports.home),[]);
});

test('disabled or unavailable trace storage preserves controller launch result',async t=>{
  for(const setting of ['', 'herdr']){
    const f=await fixture(t,'lost-type-with-proof');f.ports.env={PDD_TRACE:setting};
    f.ports.home=await folder(t);
    if(setting)await fs.writeFile(join(f.ports.home,'.pdd'),'not a directory');
    assert.equal((await startWorkflowController(f.spec,f.ports)).state,'started');
    assert.equal(f.calls.filter(([name])=>name==='run').length,1);
    if(!setting)assert.deepEqual(await fs.readdir(f.ports.home),[]);
  }
});

test('changed OS boot identity with the same Herdr PID remains inspect-only',async t=>{
  const f=await fixture(t,'');
  assert.equal((await startWorkflowController(f.spec,f.ports)).state,'started');
  const original=f.ports.herdr.processInfo;
  f.ports.herdr.processInfo=async()=>({...await original(),startIdentity:'different-boot:same-start-ticks'});
  for(let i=0;i<2;i++){
    const r=await startWorkflowController(f.spec,f.ports);assert.equal(r.state,'uncertain');assert.equal(r.code,'process_unproved');
  }
  assert.equal(f.calls.filter(([name])=>name==='run').length,1);
  assert.equal((await readControllerLaunches(f.spec)).length,1);
});

test('Herdr foreground PID and OS start evidence cannot substitute a shell for the exact Node invocation',async t=>{
  const f=await fixture(t,''),original=f.ports.herdr.processInfo;
  // Public foreground-process shape observed in Herdr: a shell is a process,
  // but it is not the saved Node controller or its run-specific drive argv.
  f.ports.herdr.processInfo=async()=>({...await original(),executable:'/bin/bash',argv:['/bin/bash']});
  const r=await startWorkflowController(f.spec,f.ports);
  assert.equal(r.state,'uncertain');assert.equal(r.code,'process_unproved');
  await startWorkflowController(f.spec,f.ports);
  assert.equal(f.calls.filter(([name])=>name==='run').length,1);
});

test('only allowlisted tracing enters the durable drive command, without changing process argv or repeating delivery',async t=>{
  const before=process.env.PDD_TRACE;process.env.PDD_TRACE='git';t.after(()=>{if(before===undefined)delete process.env.PDD_TRACE;else process.env.PDD_TRACE=before;});
  for(const [selector,expected] of [['herdr,git','herdr,git'],['git,herdr','herdr,git'],['herdr,PRIVATE_TEXT','herdr'],['PRIVATE; touch /tmp/never',null],[undefined,'git']]){
    const f=await fixture(t,'');f.ports.home=await folder(t);f.ports.env={PDD_TRACE:selector,SECRET:'not-forwarded'};
    assert.equal((await startWorkflowController(f.spec,f.ports)).state,'started');
    const intent=(await readControllerLaunches(f.spec)).at(-1);
    assert.equal(intent.traceSelector??null,expected);
    assert.equal(intent.line,(expected?`PDD_TRACE='${expected}' `:'')+intent.argv.map(x=>`'${x}'`).join(' '));
    assert.ok(!intent.line.includes('PRIVATE'));assert.ok(!intent.line.includes('SECRET'));assert.ok(!intent.line.includes('not-forwarded'));
    assert.deepEqual(intent.proof.process.argv,intent.argv);
    f.ports.env.PDD_TRACE='git';assert.equal((await startWorkflowController(f.spec,f.ports)).state,'started');
    assert.equal((await readControllerLaunches(f.spec)).at(-1).line,intent.line);
    assert.equal(f.calls.filter(([name])=>name==='run').length,1);
  }
});

test('saved selector changes invalidate launch history and never authorize another pane command',async t=>{
  const f=await fixture(t,'');f.ports.home=await folder(t);f.ports.env={PDD_TRACE:'herdr'};
  assert.equal((await startWorkflowController(f.spec,f.ports)).state,'started');
  const intent=(await readControllerLaunches(f.spec)).at(-1),dir=join(f.spec.runDir,'controller-launch',intent.launchId);
  const last=(await fs.readdir(dir)).sort().at(-1),path=join(dir,last),record=JSON.parse(await fs.readFile(path,'utf8'));
  record.traceSelector='git';await fs.writeFile(path,JSON.stringify(record)+'\n');
  assert.equal((await startWorkflowController(f.spec,f.ports)).code,'launch_history_invalid');
  assert.equal(f.calls.filter(([name])=>name==='run').length,1);
});

test('failed identity on the new pane refuses before command and never repeats pane creation or probing',async t=>{
 for(const throws of [false,true]){
  const f=await fixture(t,'');let probes=0;
  f.ports.herdr.supportsProcessIdentity=async request=>{
   probes++;assert.deepEqual(request,{session:'default',paneId:'w1:p1'});
   assert.equal((await readControllerLaunches(f.spec)).at(-1).phase,'tab.created');
   assert.equal(f.calls.filter(x=>x[0]==='tab').length,1);assert.equal(f.calls.filter(x=>x[0]==='run').length,0);
   if(throws)throw Error('private OS failure');return false;
  };
  for(let i=0;i<2;i++){
   const r=await startWorkflowController(f.spec,f.ports);
   assert.equal(r.state,'refused');assert.equal(r.code,'herdr_identity_unavailable');
   assert.equal(r.message,'Herdr process identity is unavailable for the new controller pane. No controller command was sent.');
   assert.equal(r.controller.paneId,'w1:p1');
  }
  assert.equal(probes,1);assert.deepEqual(f.calls.map(x=>x[0]),['tab']);
  assert.equal((await readControllerLaunches(f.spec)).at(-1).phase,'herdr.identity_unavailable');
 }
});
