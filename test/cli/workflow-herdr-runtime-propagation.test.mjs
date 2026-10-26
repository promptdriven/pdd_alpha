import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {freezeWorkflowInputs,readWorkflowRuntime,checkWorkflowRuntime,upgradeWorkflowRuntime} from '../../src/workflow-runtime.mjs';
import {createLocalWorkflowControllerPorts,startWorkflowController,readControllerLaunches} from '../../src/workflow-controller.mjs';
import {createWorkflowKeeperPorts,reconcileWorkflowControllers} from '../../src/workflow-keeper.mjs';
import {readProcessStartIdentity} from '../../src/workflow-herdr-client.mjs';
import {runtimeFixture,runId,folder,fakeLocks} from './runner-a-fixtures.mjs';

async function binary(root,name='recorded-herdr'){
  const path=join(root,name);await fs.writeFile(path,'#!/bin/sh\nexit 99\n',{mode:0o700});return path;
}

test('freeze retains the absolute Herdr binding; checks ignore a changed machine runtime and never fall back after deletion',async t=>{
  const f=await runtimeFixture(t),herdr=await binary(f.root);
  f.runtime.herdr=herdr;
  await freezeWorkflowInputs(f);
  assert.equal((await readWorkflowRuntime(f)).runtime.herdr,herdr);
  const ports={runtime:{...f.runtime,herdr:process.execPath},herdrExecutable:process.execPath,env:{PATH:'/usr/bin:/bin'}};
  assert.deepEqual(await checkWorkflowRuntime(f,ports),{ok:true,code:null});
  await fs.unlink(herdr);
  assert.deepEqual(await checkWorkflowRuntime(f,ports),{ok:false,code:'herdr_not_found',message:`Herdr not found at ${herdr}`});
  assert.equal((await readWorkflowRuntime(f)).runtime.herdr,herdr);
});

test('malformed explicit Herdr binding refuses before frozen files; absent legacy binding stays optional',async t=>{
  for(const herdr of [null,false,{},'relative/herdr','/path/with\ncontrol']){
    const f=await runtimeFixture(t);f.runtime.herdr=herdr;
    await assert.rejects(freezeWorkflowInputs(f),{code:'runtime_missing'});
    assert.equal(await fs.stat(join(f.runDir,'frozen')).then(()=>true,()=>false),false);
  }
  const f=await runtimeFixture(t);await freezeWorkflowInputs(f);
  assert.deepEqual(await checkWorkflowRuntime(f,{env:{PATH:''}}),{ok:true,code:null});
  assert.equal(Object.hasOwn((await readWorkflowRuntime(f)).runtime,'herdr'),false);
});

test('missing upgrade Herdr binding refuses before upgrade intent or journal effects',async t=>{
  const f=await runtimeFixture(t);await freezeWorkflowInputs(f);
  const events=[],herdr=join(f.root,'absent'),state={rev:57,controlState:'waiting_person',stopped:true,runtime:f.runtime};
  const r=await upgradeWorkflowRuntime({runDir:f.runDir,expectedRev:57,target:{...f.runtime,herdr}},
    {env:{PATH:'/usr/bin:/bin'},withUpgradeGuard:async(_,action)=>action({state,appendUpgrade:async e=>events.push(e)})});
  assert.deepEqual(r,{state:'refused',code:'herdr_not_found',message:`Herdr not found at ${herdr}`});
  assert.deepEqual(events,[]);assert.equal(await fs.stat(join(f.runDir,'runtime-upgrades')).then(()=>true,()=>false),false);
});

async function controllerFixture(t){
  const home=await folder(t),herdr=await binary(home),current=await binary(home,'current-herdr'),runDir=join(home,runId);await fs.mkdir(runDir);
  const runtime={node:process.execPath,bin:'/recorded/bin/pdd.mjs',herdr};
  const spec={runId,runDir,root:home,workflow:'feature',issueNumber:7,runtime};
  const state={runId,controlState:'running',name:'feature',root:home,runtime,issue:{number:7}},calls=[];
  let intent,deliveries=0;
  const input={runtime:{...runtime,herdr:current},herdrExecutable:current,home,env:{PATH:'',PDD_TRACE:''},
    acquireLock:fakeLocks(),readWorkflowJournal:async()=>({seq:2,state}),withLifecycleGuard:async(_,action)=>action(),
    validateRun:async()=>true,inspectControllerLock:async()=> 'free',
    execFile:async(file,args)=>{
      assert.equal(file,herdr,'the saved runtime wins over the caller runtime, executable hint and empty PATH');
      calls.push([file,args]);const op=args.slice(2,4).join('.');let result;
      if(op==='workspace.list')result={workspaces:[{workspace_id:'w1',cwd:home}]};
      else if(op==='tab.create')result={tab:{tab_id:'w1:t1'},root_pane:{tab_id:'w1:t1',pane_id:'w1:p1',terminal_id:'synthetic'}};
      else if(op==='pane.run'){
        deliveries++;intent=(await readControllerLaunches(spec)).at(-1);
        state.controller={started:true,launchId:intent.launchId,generation:1,pid:process.pid,paneId:'w1:p1',startIdentity:await readProcessStartIdentity({pid:process.pid})};
        result={type:'ok'};
      }else if(op==='pane.process-info')result={process_info:{pane_id:'w1:p1',shell_pid:process.pid,foreground_processes:[{pid:process.pid,argv:intent?.argv??['/bin/sh']}]}};
      else assert.fail('Unexpected edge operation '+op);
      return {stdout:JSON.stringify({result}),code:0};
    }};
  return {home,herdr,current,spec,state,calls,input,deliveries:()=>deliveries};
}

test('real controller factory uses saved Herdr with empty PATH and retains exact OS/start/argv proof with one delivery',async t=>{
  const f=await controllerFixture(t),ports=await createLocalWorkflowControllerPorts(f.input);
  const r=await startWorkflowController(f.spec,ports);
  assert.equal(r.state,'started',JSON.stringify(r));assert.equal(f.deliveries(),1);
  const intent=(await readControllerLaunches(f.spec)).at(-1);
  assert.equal(intent.runtime.herdr,f.herdr);assert.deepEqual(intent.proof.process.argv,intent.argv);
  assert.equal(intent.proof.process.startIdentity,f.state.controller.startIdentity);
  assert.equal((await startWorkflowController(f.spec,ports)).state,'started');assert.equal(f.deliveries(),1);
  assert.equal(ports.runtime,f.input.runtime,'factory does not mutate supplied runtime');
});

test('missing recorded controller Herdr reports its path before transport effects without using the current executable',async t=>{
  const f=await controllerFixture(t),ports=await createLocalWorkflowControllerPorts(f.input);
  await fs.unlink(f.herdr);
  const r=await startWorkflowController(f.spec,ports);
  assert.equal(r.state,'refused');assert.equal(r.code,'herdr_not_found');assert.equal(r.message,`Herdr not found at ${f.herdr}`);
  assert.deepEqual(f.calls,[]);assert.equal(f.deliveries(),0);
  const intent=(await readControllerLaunches(f.spec)).at(-1);assert.equal(intent.runtime.herdr,f.herdr);
  await startWorkflowController(f.spec,ports);assert.equal(f.deliveries(),0);assert.deepEqual(f.calls,[]);
});

test('controller runtime rebinding preserves every explicitly supplied transport and authority reference',async t=>{
  const f=await controllerFixture(t),herdr={supportsProcessIdentity:async()=>true,listWorkspaces:async()=>[],
    createWorkspace:async()=>({refused:true}),createTab:async()=>assert.fail(),paneRun:async()=>assert.fail(),processInfo:async()=>assert.fail()};
  const original={...f.input,herdr,observeHerdr:async()=>({complete:false}),processStartIdentity:async()=>null};
  const ports=await createLocalWorkflowControllerPorts(original);
  for(const key of Object.keys(original))assert.equal(ports[key],original[key]);
  assert.equal((await startWorkflowController(f.spec,ports)).code,'workspace_create_failed');assert.deepEqual(f.calls,[]);
});

test('keeper uses independent saved executable bindings and observation continuity, then refuses a missing recorded binary',async t=>{
  const home=await folder(t),first=await binary(home,'first-herdr'),second=await binary(home,'second-herdr'),current=await binary(home,'current-herdr');
  const secondId='6f1c2d3e-0a1b-4c2d-8e3f-1a2b3c4d5e70';
  const entries=[runId,secondId].map(id=>({runId:id,runDir:join(home,id),root:home}));
  const states=new Map(entries.map((e,i)=>[e.runDir,{runId:e.runId,root:home,name:'feature',issue:{number:i+7},controlState:'running',runtime:{herdr:i?second:first}}]));
  let now=0;const commands=[],starts=[];
  const ports=await createWorkflowKeeperPorts({home,env:{PATH:'',PDD_TRACE:''},runtime:{herdr:current},herdrExecutable:current,
    fs:{...fs,readFile:async(p,...args)=>p==='/proc/net/unix'?'x: 2 0 00010000 0001 01 77 /synthetic/herdr.sock\n':fs.readFile(p,...args),
      readdir:async(p,...args)=>p==='/proc'?[String(process.pid)]:p===`/proc/${process.pid}/fd`?['99']:fs.readdir(p,...args),
      readlink:async(p,...args)=>p===`/proc/${process.pid}/fd/99`?'socket:[77]':fs.readlink(p,...args)},
    observations:new Map(),herdrObservationNow:()=>now,validateLocator:async()=>true,
    readWorkflowJournal:async e=>({seq:1,state:states.get(e.runDir)}),inspectWorkflowLock:async()=> 'free',
    readControllerLaunches:async()=>[],checkWorkflowRuntime:async()=>({ok:true}),
    startWorkflowController:async spec=>{starts.push(spec);return {state:'started',code:null};},
    execFile:async(file,args)=>{assert.ok([first,second].includes(file));assert.deepEqual(args,['--session','default','status','--json']);commands.push(file);return {stdout:JSON.stringify({server:{running:true,status:'running',session:null,socket:'/synthetic/herdr.sock'}})};}});
  for(now of [0,30000,60000])await reconcileWorkflowControllers({entries,now},ports);
  assert.deepEqual(commands,[first,first,second,second,first,first,second,second,first,first,second,second]);
  assert.deepEqual(starts.map(s=>s.runtime.herdr),[first,second]);
  await fs.unlink(first);now=90000;
  const result=await reconcileWorkflowControllers({entries:[entries[0]],now},ports);
  assert.deepEqual(result,[{runId,state:'needs_you',code:'herdr_not_found',message:`Herdr not found at ${first}`}]);
  assert.equal(starts.length,2);assert.equal(commands.length,12);
});


test('recorded executable deletion after durable tab creation remains uncertain with its path and no pane command',async t=>{
  const f=await controllerFixture(t),edge=f.input.execFile;
  f.input.execFile=async(file,args)=>{const response=await edge(file,args);if(args[2]==='tab'&&args[3]==='create')await fs.unlink(f.herdr);return response;};
  const ports=await createLocalWorkflowControllerPorts(f.input),r=await startWorkflowController(f.spec,ports);
  assert.equal(r.state,'uncertain');assert.equal(r.code,'herdr_not_found');assert.equal(r.message,`Herdr not found at ${f.herdr}`);
  const intent=(await readControllerLaunches(f.spec)).at(-1);
  assert.equal(intent.phase,'tab.created');assert.equal(intent.paneId,'w1:p1');assert.equal(f.deliveries(),0);
  assert.deepEqual(f.calls.map(([,args])=>args.slice(2,4).join('.')),['workspace.list','tab.create']);
  assert.equal((await startWorkflowController(f.spec,ports)).state,'uncertain');assert.equal(f.deliveries(),0);
});
