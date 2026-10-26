import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { constants } from 'node:fs';
import vectors from '../../vectors/cli/workflow-controller.json' with {type:'json'};
import {startWorkflowController,readControllerLaunches} from '../../src/workflow-controller.mjs';
import {runId,folder,fakeLocks} from './runner-a-fixtures.mjs';
import {readHerdrTrace} from '../../src/herdr-trace.mjs';
async function fixture(t,id){
  const runDir=join(await folder(t),runId);await fs.mkdir(runDir);
  const runtime={node:'/saved/node',bin:'/saved/bin/pdd.mjs'};
  const spec={runId,runDir,root:'/assigned',workflow:'feature',issueNumber:7,runtime};
  const calls=[],state={runId,root:spec.root,name:'feature',issue:{number:7},runtime,controlState:'running'},proof={};
  let proofTime=0;
  const ports={controllerProofNow:()=>proofTime,controllerProofSleep:async ms=>{proofTime+=ms;},acquireLock:fakeLocks(),now:()=>60000,withLifecycleGuard:async(s,fn)=>fn(),validateRun:async()=>true,inspectControllerLock:async()=> 'free',readWorkflowJournal:async()=>({state,seq:2}),herdr:{
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

for(const publishedAt of [300,14900,15000])test(`issue20 C2 binds delayed controller.started at ${publishedAt}ms without a second delivery`,async t=>{
  const f=await fixture(t,''),send=f.ports.herdr.paneRun;let clock=0,published;
  f.ports.controllerProofNow=()=>clock;
  f.ports.controllerProofSleep=async ms=>{clock+=ms;if(clock>=publishedAt)f.state.controller=published;};
  f.ports.herdr.paneRun=async p=>{await send(p);published=f.state.controller;delete f.state.controller;};
  const r=await startWorkflowController(f.spec,f.ports);
  assert.equal(r.state,'started');assert.equal(clock,publishedAt);assert.equal(f.calls.filter(c=>c[0]==='run').length,1);
  assert.equal((await readControllerLaunches(f.spec)).at(-1).phase,'proved');
});
test('issue20 C2 deadline is uncertain and the same original is never redelivered',async t=>{
  const f=await fixture(t,'live-without-generation');let clock=0,reads=0;
  f.ports.controllerProofNow=()=>clock;f.ports.controllerProofSleep=async ms=>{clock+=ms;};
  const read=f.ports.herdr.processInfo;f.ports.herdr.processInfo=async()=>{reads++;return read();};
  const r=await startWorkflowController(f.spec,f.ports);
  assert.equal(r.state,'uncertain');assert.equal(r.code,'process_unproved');assert.equal(clock,15000);assert.equal(reads,151);
  assert.match(r.message,new RegExp(`may be running; check pdd workflow status ${runId}`));assert.doesNotMatch(r.message,/not started/);
  await startWorkflowController(f.spec,f.ports);assert.equal(f.calls.filter(c=>c[0]==='run').length,1);
});
test('issue20 C6 reconciles pane.run.intent at human wait before comparing approval',async t=>{
  const f=await fixture(t,''),read=f.ports.herdr.processInfo;
  f.ports.herdr.processInfo=async()=>null;
  assert.equal((await startWorkflowController(f.spec,f.ports)).code,'process_unproved');
  assert.equal((await readControllerLaunches(f.spec)).at(-1).phase,'pane.run.intent');
  f.state.controlState='waiting_person';f.state.rev=57;f.state.waitingPerson={rev:57,decisions:['approve']};
  f.spec.decision={decision:'approve',id:runId,rev:57};
  f.ports.herdr.processInfo=async p=>f.calls.filter(c=>c[0]==='run').length===1?null:read(p);
  const approved=await startWorkflowController(f.spec,f.ports);
  assert.equal(approved.state,'started');assert.equal(approved.controller.generation,2);
  const launches=await readControllerLaunches(f.spec);assert.equal(launches.length,2);assert.equal(launches[0].phase,'exited');assert.equal(launches[0].exitedProof.humanWait,true);
  await startWorkflowController(f.spec,f.ports);assert.equal(f.calls.filter(c=>c[0]==='run').length,2);
});
test('issue20 C6 a positively live prior controller fences a different decision',async t=>{
  const f=await fixture(t,'');assert.equal((await startWorkflowController(f.spec,f.ports)).state,'started');
  f.state.controlState='waiting_person';f.state.rev=57;f.state.waitingPerson={rev:57,decisions:['approve']};f.spec.decision={decision:'approve',id:runId,rev:57};
  assert.equal((await startWorkflowController(f.spec,f.ports)).code,'controller_busy');assert.equal(f.calls.filter(c=>c[0]==='run').length,1);
});
for(const blocked of ['unknown-lock','no-bound-start','stale-revision'])test(`issue20 C6 does not replace an unproved or unauthorized prior: ${blocked}`,async t=>{
  const f=await fixture(t,''),read=f.ports.herdr.processInfo;
  assert.equal((await startWorkflowController(f.spec,f.ports)).state,'started');
  f.ports.herdr.processInfo=async()=>null;f.state.controlState='waiting_person';f.state.rev=57;f.state.waitingPerson={rev:57,decisions:['approve']};f.spec.decision={decision:'approve',id:runId,rev:57};
  if(blocked==='unknown-lock')f.ports.inspectControllerLock=async()=> 'unknown';
  if(blocked==='no-bound-start')f.state.controller.launchId='00000000-0000-4000-8000-000000000000';
  if(blocked==='stale-revision')f.spec.decision.rev=56;
  const r=await startWorkflowController(f.spec,f.ports);assert.notEqual(r.state,'started');assert.equal(f.calls.filter(c=>c[0]==='run').length,1);
  if(blocked==='stale-revision')assert.equal(r.code,'stale_decision');
});

for(const blocked of ['held-lock','throwing-lock','changed-frozen-proof','wrong-argv'])test(`issue20 C6 preserves prior authority: ${blocked}`,async t=>{
  const f=await fixture(t,''),original=f.ports.herdr.processInfo;
  assert.equal((await startWorkflowController(f.spec,f.ports)).state,'started');
  f.state.controlState='waiting_person';f.state.rev=57;f.state.waitingPerson={rev:57,decisions:['approve']};
  f.spec.decision={decision:'approve',id:runId,rev:57};f.ports.herdr.processInfo=async()=>null;
  if(blocked==='held-lock')f.ports.inspectControllerLock=async()=> 'held';
  if(blocked==='throwing-lock')f.ports.inspectControllerLock=async()=>{throw Error('unavailable');};
  if(blocked==='changed-frozen-proof')f.state.controller.startIdentity='different:process';
  if(blocked==='wrong-argv'){
    f.state.controlState='running';f.ports.herdr.processInfo=async()=>({...await original(),argv:['/saved/node','unrelated']});
  }
  const r=await startWorkflowController(f.spec,f.ports);
  assert.equal(r.state,'uncertain');assert.equal(f.calls.filter(c=>c[0]==='run').length,1);
  assert.notEqual((await readControllerLaunches(f.spec)).at(-1).phase,'exited');
});
test('issue20 C6 same-decision human-wait inspection persists exit without launching',async t=>{
  const f=await fixture(t,'');assert.equal((await startWorkflowController(f.spec,f.ports)).state,'started');
  f.state.controlState='waiting_person';f.ports.herdr.processInfo=async()=>null;
  const r=await startWorkflowController(f.spec,f.ports);
  assert.equal(r.code,'controller_exited');assert.equal((await readControllerLaunches(f.spec)).at(-1).phase,'exited');
  assert.equal(f.calls.filter(c=>c[0]==='run').length,1);
});
test('issue20 C2 stalled observations stop at the deadline and late evidence cannot persist proof',async t=>{
  const f=await fixture(t,'');let clockReads=0,release;
  f.ports.controllerProofNow=()=>clockReads++===0?0:14990;
  f.ports.herdr.processInfo=()=>new Promise(resolve=>{release=resolve;});
  const r=await startWorkflowController(f.spec,f.ports);
  assert.equal(r.state,'uncertain');assert.match(r.message,/may be running/);
  const before=await readControllerLaunches(f.spec);
  release({pid:123,startIdentity:'boot:start',paneId:'w1:p1',executable:f.spec.runtime.node,argv:before.at(-1).argv});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(await readControllerLaunches(f.spec),before);assert.equal(f.calls.filter(c=>c[0]==='run').length,1);
});

test('issue20 C2 waits for matching process evidence even when journal started is already durable',async t=>{
  const f=await fixture(t,''),read=f.ports.herdr.processInfo;let clock=0;
  f.ports.controllerProofNow=()=>clock;f.ports.controllerProofSleep=async ms=>{clock+=ms;};
  f.ports.herdr.processInfo=async()=>clock<600?null:read();
  const r=await startWorkflowController(f.spec,f.ports);
  assert.equal(r.state,'started');assert.equal(clock,600);assert.equal(f.calls.filter(c=>c[0]==='run').length,1);
});
test('issue20 C6 failed durable exit cannot authorize another controller',async t=>{
  const f=await fixture(t,'');assert.equal((await startWorkflowController(f.spec,f.ports)).state,'started');
  f.state.controlState='waiting_person';f.state.rev=57;f.state.waitingPerson={rev:57,decisions:['approve']};
  f.spec.decision={decision:'approve',id:runId,rev:57};f.ports.herdr.processInfo=async()=>null;
  f.ports.fs={...fs,open:async(path,flags,...args)=>{
    if(typeof flags==='number'&&(flags&constants.O_CREAT))throw Error('synthetic persistence failure');
    return fs.open(path,flags,...args);
  }};
  const r=await startWorkflowController(f.spec,f.ports);
  assert.equal(r.state,'uncertain');assert.equal(r.code,'proof_not_durable');
  assert.equal(f.calls.filter(c=>c[0]==='run').length,1);assert.equal((await readControllerLaunches(f.spec)).length,1);
});

// Reviewer-1's synthetic late-observation and late-lock probes, plus the
// journal side of the same observation boundary. No live Herdr is involved.
for(const mode of ['live-observation','journal-observation','exit-lock']){
  for(const completedAt of [15000,15001])test(`issue20 B1 ${mode} completes at ${completedAt}ms`,async t=>{
    const f=await fixture(t,''),read=f.ports.herdr.processInfo,journal=f.ports.readWorkflowJournal;
    let clock=0;
    f.ports.controllerProofNow=()=>clock;
    if(mode==='live-observation')f.ports.herdr.processInfo=async()=>{const process=await read();clock=completedAt;return process;};
    if(mode==='journal-observation')f.ports.readWorkflowJournal=async()=>{
      const observed=await journal();if(f.calls.some(c=>c[0]==='run'))clock=completedAt;return observed;
    };
    if(mode==='exit-lock'){
      f.ports.herdr.processInfo=async()=>({...await read(),stopped:true});
      let locks=0;f.ports.inspectControllerLock=async()=>{if(++locks>1)clock=completedAt;return 'free';};
    }
    const result=await startWorkflowController(f.spec,f.ports),launches=await readControllerLaunches(f.spec),last=launches.at(-1);
    assert.equal(f.calls.filter(c=>c[0]==='run').length,1);
    assert.equal(launches.length,1);
    if(completedAt>15000){
      assert.equal(result.state,'uncertain');assert.equal(result.code,'process_unproved');
      assert.equal(last.phase,'pane.run.intent');assert.equal(last.proof,undefined);assert.equal(last.exitedProof,undefined);
      assert.match(result.message,/may be running/);
    }else if(mode==='exit-lock'){
      assert.equal(result.state,'uncertain');assert.equal(result.code,'controller_exited');assert.equal(last.phase,'exited');
    }else{
      assert.equal(result.state,'started');assert.equal(last.phase,'proved');
    }
  });
}
test('issue20 B1 overdue prior-lock proof cannot admit an approval replacement',async t=>{
  const f=await fixture(t,''),read=f.ports.herdr.processInfo;
  assert.equal((await startWorkflowController(f.spec,f.ports)).state,'started');
  f.state.controlState='waiting_person';f.state.rev=57;f.state.waitingPerson={rev:57,decisions:['approve']};
  f.spec.decision={decision:'approve',id:runId,rev:57};f.ports.herdr.processInfo=async()=>({...await read(),stopped:true});
  let clock=0;f.ports.controllerProofNow=()=>clock;f.ports.inspectControllerLock=async()=>{clock=15001;return 'free';};
  const result=await startWorkflowController(f.spec,f.ports),launches=await readControllerLaunches(f.spec);
  assert.equal(result.state,'uncertain');assert.equal(result.code,'process_unproved');
  assert.equal(launches.length,1);assert.equal(launches[0].phase,'proved');assert.equal(launches[0].exitedProof,undefined);
  assert.equal(f.calls.filter(c=>c[0]==='run').length,1);
});

// Synthetic identities with the real workspace.list omission of cwd. A new
// controller still receives its own tab/pane and exact process generation.
async function workspaceRelaunch(t) {
  const f=await fixture(t,''),listed=[];let count=0,process;
  f.ports.herdr.listWorkspaces=async()=>structuredClone(listed);
  f.ports.herdr.createWorkspace=async request=>{
    f.calls.push(['workspace',request]);const workspace={workspaceId:`w${++count}`,cwd:request.cwd};
    listed.push(workspace);return workspace;
  };
  f.ports.herdr.createTab=async request=>{
    f.calls.push(['tab',request]);const n=f.calls.filter(x=>x[0]==='tab').length;
    return {tabId:`${request.workspaceId}:t${n}`,paneId:`${request.workspaceId}:p${n}`,terminalId:`term-${n}`};
  };
  f.ports.herdr.paneRun=async request=>{
    f.calls.push(['run',request]);const intent=(await readControllerLaunches(f.spec)).at(-1);
    f.state.controller={started:true,launchId:intent.launchId,generation:intent.previousGeneration+1,pid:123+intent.admission,startIdentity:`boot:start-${intent.admission}`,paneId:intent.paneId};
    process={pid:f.state.controller.pid,startIdentity:f.state.controller.startIdentity,paneId:intent.paneId,executable:f.spec.runtime.node,argv:intent.argv};
  };
  f.ports.herdr.processInfo=async()=>process;
  assert.equal((await startWorkflowController(f.spec,f.ports)).state,'started');
  process={...process,stopped:true};
  assert.equal((await startWorkflowController(f.spec,f.ports)).code,'controller_exited');
  assert.equal((await readControllerLaunches(f.spec)).at(-1).phase,'exited');
  return {...f,listed};
}

for(const mode of ['omitted-cwd','null-cwd','other-matching-workspace'])test(`relaunch reuses its durable workspace: ${mode}, with a new proved controller pane`,async t=>{
  const f=await workspaceRelaunch(t);delete f.listed[0].cwd;
  if(mode==='null-cwd')f.listed[0].cwd=null;
  // A matching-cwd workspace does not steal the saved run's grouping.
  if(mode==='other-matching-workspace')f.listed.unshift({workspaceId:'w9',cwd:f.spec.root});
  const result=await startWorkflowController(f.spec,f.ports);
  assert.equal(result.state,'started');assert.equal(result.controller.generation,2);
  assert.equal(result.controller.workspaceId,'w1');assert.equal(result.controller.paneId,'w1:p2');
  assert.equal(f.calls.filter(x=>x[0]==='workspace').length,1);
  assert.deepEqual(f.calls.filter(x=>x[0]==='tab').map(x=>x[1].workspaceId),['w1','w1']);
  assert.equal(f.calls.filter(x=>x[0]==='run').length,2);
  const saved=(await readControllerLaunches(f.spec)).at(-1);
  assert.equal(saved.workspaceId,'w1');assert.equal(saved.phase,'proved');
  assert.equal(saved.proof.process.paneId,'w1:p2');
  assert.equal((await startWorkflowController(f.spec,f.ports)).state,'started');
  assert.equal(f.calls.filter(x=>x[0]==='run').length,2);
});

for(const mode of ['missing','conflicting-cwd','other-root','other-runtime'])test(`workspace reuse excludes ${mode} identity`,async t=>{
  const f=await workspaceRelaunch(t);
  if(mode==='missing')f.listed.length=0;
  if(mode==='conflicting-cwd')f.listed[0].cwd='/someone-else';
  if(mode==='other-root'){delete f.listed[0].cwd;f.spec.root='/different-assignment';}
  if(mode==='other-runtime'){delete f.listed[0].cwd;f.spec.runtime={node:'/other/node',bin:'/other/pdd.mjs'};f.state.runtime=f.spec.runtime;}
  const result=await startWorkflowController(f.spec,f.ports);
  assert.equal(result.state,'started');assert.equal(result.controller.workspaceId,'w2');
  assert.equal(f.calls.filter(x=>x[0]==='workspace').length,2);
  assert.equal(f.calls.filter(x=>x[0]==='tab').length,2);
  assert.equal(f.calls.filter(x=>x[0]==='run').length,2);
});

test('duplicate listed workspace identities cannot admit a new tab or controller command',async t=>{
  const f=await workspaceRelaunch(t);f.listed.push({...f.listed[0]});
  const result=await startWorkflowController(f.spec,f.ports);
  assert.equal(result.state,'uncertain');assert.equal(result.code,'workspace_unknown');
  assert.equal(f.calls.filter(x=>x[0]==='workspace').length,1);
  assert.equal(f.calls.filter(x=>x[0]==='tab').length,1);
  assert.equal(f.calls.filter(x=>x[0]==='run').length,1);
  await startWorkflowController(f.spec,f.ports);
  assert.equal(f.calls.filter(x=>x[0]==='tab').length,1);
});
