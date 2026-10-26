import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {startWorkflowController,readControllerLaunches} from '../../src/workflow-controller.mjs';
import {createWorkflowHerdrPorts} from '../../src/workflow-herdr-client.mjs';
import {runId,folder,fakeLocks} from './runner-a-fixtures.mjs';

// Synthetic counterpart of the saved issue24 resume reply: the controller pane
// now reports only bash, with foreground_process_group_id == shell_pid.
const shellReply=(paneId='w1:p1')=>({pane_id:paneId,shell_pid:50,foreground_process_group_id:50,foreground_processes:[{pid:50,name:'bash',argv:['/bin/bash']}]});
const expected={session:'default',paneId:'w1:p1',pid:123,startIdentity:'boot:original'};
async function observer(overrides={}){
 const calls=[],ports={herdrExecutable:process.execPath,env:{PDD_TRACE:''},platform:'linux',home:'/synthetic',
  fs:{realpath:async p=>p.startsWith('/proc/')?'/physical/node':p==='/runtime/node'?'/physical/node':p},
  processStartIdentity:async({pid})=>pid===50?'boot:shell':null,
  processExists:async()=>null,
  execFile:async(file,args)=>{calls.push(args);return {code:0,stdout:JSON.stringify({result:{process_info:shellReply(args.at(-1))}})};},...overrides};
 return {calls,ports,...await createWorkflowHerdrPorts(ports)};
}

test('C14 real-shaped resumed pane shell supplies stable exit evidence without a mutation',async()=>{
 const f=await observer(),value=await f.herdr.inspectProcessExit(expected);
 assert.deepEqual(value,{exited:true,pid:123,startIdentity:'boot:original',paneId:'w1:p1',reason:'pane_shell',shell:{pid:50,startIdentity:'boot:shell',argv:['/bin/bash']}});
 assert.equal(f.calls.length,2);assert.ok(f.calls.every(args=>args[3]==='process-info'&&args.at(-1)==='w1:p1'));
});

test('C14 OS absence and changed start identity are affirmative repeated observations',async()=>{
 for(const mode of ['gone','reused']){
  const ids=[],presence=[];const f=await observer({processStartIdentity:async({pid})=>{ids.push(pid);return mode==='reused'?'boot:new-owner':null;},processExists:async({pid})=>{presence.push(pid);return false;},execFile:()=>assert.fail('OS exit needs no pane mutation or transport')});
  const value=await f.herdr.inspectProcessExit(expected);assert.equal(value.exited,true);assert.equal(value.reason,mode==='gone'?'pid_gone':'identity_changed');
  assert.equal(value.pid,123);assert.equal(value.startIdentity,'boot:original');assert.deepEqual(ids,[123,123]);assert.deepEqual(presence,mode==='gone'?[123,123]:[]);
 }
});

test('C14 absent/denied/changed observations and unrelated foreground rows remain unknown',async()=>{
 for(const mode of ['empty','other-group','wrong-pane','duplicate-shell','bad-argv','changing-argv','changing-shell-start','changing-os-start','inconsistent-absence','denied-presence','missing-identity']){
  let reads=0,ids=0,checks=0;
  const f=await observer({
   processStartIdentity:async({pid})=>{
    if(mode==='missing-identity')return null;
    if(mode==='changing-os-start')return `boot:changed-${++ids}`;
    if(pid===50)return mode==='changing-shell-start'?`boot:shell-${++ids}`:'boot:shell';
    return null;
   },
   processExists:async()=>{if(mode==='denied-presence')throw Object.assign(Error('private'),{code:'EPERM'});return mode==='inconsistent-absence'&&++checks===1?false:null;},
   execFile:async(file,args)=>{
    const info=shellReply();reads++;
    if(mode==='empty')info.foreground_processes=[];
    if(mode==='other-group')info.foreground_process_group_id=456;
    if(mode==='wrong-pane')info.pane_id='w1:p9';
    if(mode==='duplicate-shell')info.foreground_processes.push({...info.foreground_processes[0]});
    if(mode==='bad-argv')info.foreground_processes[0].argv=['relative-bash'];
    if(mode==='changing-argv'&&reads>1)info.foreground_processes[0].argv.push('-c','other');
    return {stdout:JSON.stringify({result:{process_info:info}})};
   }
  });
  assert.deepEqual(await f.herdr.inspectProcessExit(expected),{exited:false},mode);
 }
});

test('C14 explicit missing Herdr remains actionable and invalid expected identities have no probe effects',async()=>{
 const f=await observer({herdrExecutable:'/synthetic/missing-herdr-c14'});
 await assert.rejects(f.herdr.inspectProcessExit(expected),e=>e.code==='herdr_not_found'&&e.message==='Herdr not found at /synthetic/missing-herdr-c14');
 for(const request of [{...expected,pid:0},{...expected,startIdentity:''},{...expected,paneId:'invalid'},{...expected,session:'other'}]){
  const x=await observer({processStartIdentity:()=>assert.fail('invalid input')});assert.deepEqual(await x.herdr.inspectProcessExit(request),{exited:false});assert.equal(x.calls.length,0);
 }
});

async function recovery(t,mode){
 const runDir=join(await folder(t),runId);await fs.mkdir(runDir);
 const runtime={node:'/runtime/node',bin:'/runtime/pdd.mjs'},spec={runId,runDir,root:'/assigned',workflow:'feature',issueNumber:24,runtime};
 const stage={paneId:'w1:p9',backendGen:4,phase:'working'};
 const state={runId,root:spec.root,runtime,controlState:'running',stage:structuredClone(stage)};
 let clock=0,killed=false,commands=0,tabs=0;const calls=[];let process;
 const f=await observer({processStartIdentity:async({pid})=>{
   if(pid===50)return 'boot:shell';
   if(pid===124)return 'boot:replacement';
   if(!killed||mode==='live')return 'boot:original';
   return mode==='reused'?'boot:reused':null;
  },processExists:async()=>mode==='gone'||mode==='busy-lock'||mode.startsWith('overdue')||mode==='exact-deadline'||mode==='observer-timeout'?false:null,
  execFile:async(file,args)=>{
   calls.push(args);let info;
   if(!killed||commands===2||mode==='live')info={pane_id:args.at(-1),shell_pid:50,foreground_process_group_id:process.pid,foreground_processes:[process]};
   else info=shellReply(args.at(-1));
   if(killed&&mode==='unknown')info.foreground_process_group_id=456;
   if(killed&&mode==='observer-timeout')clock=14999;
   return {stdout:JSON.stringify({result:{process_info:info}})};
  }});
 const ports={...f.ports,fs,acquireLock:fakeLocks(),controllerProofNow:()=>clock,controllerProofSleep:async ms=>{clock+=ms;},now:()=>60000,
  withLifecycleGuard:async(s,fn)=>fn(),validateRun:async()=>true,
  inspectControllerLock:async()=>{if(killed&&commands===1&&mode==='overdue-lock')clock=15001;return killed&&commands===1&&mode==='busy-lock'?'busy':killed&&commands===1&&mode==='unknown-lock'?'unknown':'free';},
  readWorkflowJournal:async()=>({state:structuredClone(state),seq:commands===2?4:2}),
  herdr:{...f.herdr,supportsProcessIdentity:async()=>true,listWorkspaces:async()=>[{workspaceId:'w1',cwd:null}],createWorkspace:async()=>({workspaceId:'w1'}),
   createTab:async()=>({paneId:`w1:p${++tabs}`,tabId:`w1:t${tabs}`,terminalId:`term-${tabs}`}),
   paneRun:async()=>{
    commands++;const intent=(await readControllerLaunches(spec)).at(-1),pid=commands===1?123:124,startIdentity=commands===1?'boot:original':'boot:replacement';
    assert.equal(intent.phase,'pane.run.intent');
    process={pid,argv:intent.argv};
    state.controller={started:true,pid,startIdentity,paneId:intent.paneId,launchId:intent.launchId,generation:commands};
   },closePane:()=>assert.fail('no cleanup of the active stage or original pane')
  }};
 assert.equal((await startWorkflowController(spec,ports)).state,'started');
 const original=(await readControllerLaunches(spec)).at(-1);killed=true;clock=0;
 if(mode==='unbound-journal')delete state.controller;
 if(mode==='frozen-conflict')state.controller.startIdentity='boot:unrelated';
 const inspect=ports.herdr.inspectProcessExit;
 ports.herdr.inspectProcessExit=async request=>{
  if(mode==='observer-timeout')return new Promise(()=>{});
  const value=await inspect(request);
  if(mode==='overdue-observer')clock=15001;
  if(mode==='exact-deadline')clock=15000;
  if(mode==='wrong-exit-binding')return {...value,pid:999};
  return value;
 };
 const result=await startWorkflowController(spec,ports),launches=await readControllerLaunches(spec);
 assert.deepEqual(state.stage,stage);return {result,launches,original,commands,tabs,ports,spec};
}

for(const mode of ['gone','reused','shell','exact-deadline'])test(`C14 killed controller same-request recovery admits exactly one new proved launch: ${mode}`,async t=>{
 const f=await recovery(t,mode),[old,next]=f.launches;
 assert.equal(f.result.state,'started');assert.equal(f.result.controller.generation,2);assert.equal(f.commands,2);assert.equal(f.tabs,2);
 assert.equal(old.phase,'exited');assert.deepEqual(old.exitedProof.controller,f.original.proof.controller);
 assert.equal(old.exitedProof.exitEvidence.reason,mode==='reused'?'identity_changed':mode==='shell'?'pane_shell':'pid_gone');
 assert.equal(next.phase,'proved');assert.equal(next.previousGeneration,1);assert.equal(next.workspaceId,'w1');assert.equal(next.paneId,'w1:p2');
 assert.notEqual(next.launchId,old.launchId);assert.equal(next.proof.process.pid,124);assert.equal(next.proof.process.startIdentity,'boot:replacement');
 assert.equal((await startWorkflowController(f.spec,f.ports)).state,'started');
 assert.equal((await readControllerLaunches(f.spec)).length,2,'a retry inspects the replacement without a third launch');
});

for(const mode of ['unknown','busy-lock','unknown-lock','unbound-journal','frozen-conflict','wrong-exit-binding','overdue-observer','overdue-lock','observer-timeout','live'])test(`C14 keeps unresolved or live prior launch without a replacement: ${mode}`,async t=>{
 const f=await recovery(t,mode);assert.equal(f.commands,1);assert.equal(f.tabs,1);assert.equal(f.launches.length,1);
 assert.equal(f.launches[0].phase,'proved');assert.equal(f.launches[0].exitedProof,undefined);
 assert.equal(f.result.state,mode==='live'?'started':'uncertain');
 if(mode==='frozen-conflict')assert.equal(f.result.code,'proof_conflict');
});

test('C14 current C10 composition proves healthy launch before unknown foreground recovery',async t=>{
 const f=await recovery(t,'unknown');
 assert.equal(f.original.phase,'proved');
 assert.equal(f.original.proof.process.pid,123);
 assert.equal(f.original.proof.process.startIdentity,'boot:original');
 assert.deepEqual(f.original.proof.process.argv,f.original.argv);
 await assert.rejects(f.ports.herdr.processInfo({session:'default',paneId:f.original.paneId}),error=>error.code==='process_unproved');
 assert.equal(f.result.state,'uncertain');assert.equal(f.launches[0].exitedProof,undefined);
 assert.equal(f.commands,1);assert.equal(f.tabs,1);assert.equal(f.launches.length,1);
});


test('C14 default OS presence probe recognizes an exited disposable process without a pane request',async()=>{
 const {spawn}=await import('node:child_process');
 const child=spawn(process.execPath,['-e','process.exit(0)'],{stdio:'ignore'});
 await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('synthetic child exit')));});
 const f=await observer({processExists:undefined,processStartIdentity:async()=>null,execFile:()=>assert.fail('No Herdr request for known OS absence')});
 const value=await f.herdr.inspectProcessExit({...expected,pid:child.pid});
 assert.equal(value.exited,true);assert.equal(value.reason,'pid_gone');assert.equal(value.pid,child.pid);
});
