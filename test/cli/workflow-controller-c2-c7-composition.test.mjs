import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {AsyncResource} from 'node:async_hooks';
import {startWorkflowController,readControllerLaunches} from '../../src/workflow-controller.mjs';
import {runId,folder,fakeLocks} from './runner-a-fixtures.mjs';

async function composition(t,mode){
  const runDir=join(await folder(t),runId);await fs.mkdir(runDir);
  const runtime={node:'/frozen/node',bin:'/frozen/pdd.mjs'};
  const spec={runId,runDir,root:'/assigned',workflow:'feature',issueNumber:7,runtime};
  const state={runId,root:spec.root,runtime,controlState:'running'};
  const calls={workspaces:0,tabs:[],commands:[],probes:[],contenders:[]};
  // A separate caller must not inherit the lock owner's reentrant context.
  const contender=new AsyncResource('independent-controller-caller');t.after(()=>contender.emitDestroy());
  let clock=0,relaunch=false,process,published,secondStart,insideAdmission=false;
  const ports={acquireLock:fakeLocks(),now:()=>60000,controllerProofNow:()=>clock,
    controllerProofSleep:async ms=>{clock+=ms;},
    withLifecycleGuard:async(s,fn)=>{insideAdmission=true;try{return await fn();}finally{insideAdmission=false;}},
    validateRun:async()=>!(relaunch&&mode==='assignment-invalid'),
    inspectControllerLock:async()=>{
      if(relaunch&&calls.commands.length===1){
        if(mode==='overdue-lock'&&!insideAdmission)clock=15001;
        if(mode==='unknown-lock'||mode==='admission-lock'&&insideAdmission)return 'unknown';
      }
      return 'free';
    },
    readWorkflowJournal:async()=>{
      if(published&&calls.commands.length===2){
        if(mode==='overdue-journal')clock=secondStart+15001;
        if(clock-secondStart>=300||['exact-deadline','overdue-journal','overdue-process'].includes(mode))state.controller=published;
      }
      return {state:structuredClone(state),seq:state.controller?.generation===2?4:2};
    },herdr:{
      supportsProcessIdentity:async request=>{calls.probes.push(request);return true;},
      // The real listing may omit cwd. No existing user pane is an authority.
      listWorkspaces:async()=>calls.workspaces?[{workspaceId:'w1',cwd:null}]:[],
      createWorkspace:async()=>{calls.workspaces++;return {workspaceId:'w1'};},
      createTab:async request=>{
        const last=(await readControllerLaunches(spec)).at(-1);
        assert.equal(last.phase,'tab.create.intent');assert.equal(last.workspaceId,request.workspaceId);
        calls.tabs.push(request);const n=calls.tabs.length;
        return {tabId:`w1:t${n}`,paneId:`w1:p${n}`,terminalId:`terminal-${n}`};
      },
      paneRun:async request=>{
        calls.commands.push(request);const intent=(await readControllerLaunches(spec)).at(-1),n=calls.commands.length;
        assert.equal(intent.phase,'pane.run.intent');assert.equal(request.paneId,intent.paneId);
        const proof={started:true,launchId:intent.launchId,generation:intent.previousGeneration+1,pid:100+n,startIdentity:`boot:start-${n}`,paneId:intent.paneId};
        process={pid:proof.pid,startIdentity:proof.startIdentity,paneId:proof.paneId,executable:runtime.node,argv:intent.argv};
        if(n===1)state.controller=proof;
        else{
          published=proof;secondStart=clock;state.controlState='running';
          if(mode==='changed-pid')process.pid++;
          if(mode==='changed-start')process.startIdentity='other-boot:same-pid';
          if(mode==='changed-generation')published.generation++;
          if(mode==='wrong-argv')process.argv=['/frozen/node','unrelated'];
          if(mode==='wrong-pane')process.paneId='w1:p9';
          // The start lock is still held during delivery and proof polling.
          calls.contenders.push(await contender.runInAsyncScope(()=>startWorkflowController(spec,ports)));
        }
      },
      processInfo:async()=>{
        if(calls.commands.length===2){
          if(mode==='exact-deadline')clock=secondStart+15000;
          if(mode==='overdue-process')clock=secondStart+15001;
        }
        return structuredClone(process);
      }
    }};
  assert.equal((await startWorkflowController(spec,ports)).state,'started');
  assert.equal((await readControllerLaunches(spec)).at(-1).phase,'proved');
  relaunch=true;clock=0;state.controlState='waiting_person';state.rev=57;
  state.waitingPerson={decisions:['approve']};spec.decision={decision:'approve',id:runId,rev:57};
  if(mode==='stale-decision')spec.decision.rev=56;
  if(mode!=='live-prior')process={...process,stopped:true};
  const result=await startWorkflowController(spec,ports);
  return {spec,ports,calls,result,clock,launches:await readControllerLaunches(spec)};
}

test('C2/B1 proof deadlines compose with C7 same-call approval workspace reuse',async t=>{
  const newLaunch=['delayed-journal','exact-deadline','overdue-process','overdue-journal','changed-pid','changed-start','changed-generation','wrong-argv','wrong-pane'];
  const modes=[...newLaunch,'overdue-lock','unknown-lock','admission-lock','assignment-invalid','live-prior','stale-decision'];
  for(const mode of modes)await t.test(mode,async t=>{
    const f=await composition(t,mode),{calls,result,launches}=f;
    assert.equal(calls.workspaces,1,'the same run never creates a second workspace');
    assert.equal(calls.tabs.length,newLaunch.includes(mode)?2:1);
    assert.equal(calls.commands.length,newLaunch.includes(mode)?2:1);
    if(newLaunch.includes(mode)){
      assert.equal(launches[0].phase,'exited');
      assert.equal(launches[1].workspaceId,'w1');assert.equal(launches[1].previousGeneration,1);
      assert.equal(launches[1].paneId,'w1:p2');assert.equal(launches[1].tabId,'w1:t2');
      assert.notEqual(launches[1].launchId,launches[0].launchId);
      assert.deepEqual(calls.probes.map(p=>p.paneId),['w1:p1','w1:p2']);
      assert.equal(calls.contenders.length,1);assert.equal(calls.contenders[0].code,'controller_busy');
      if(['delayed-journal','exact-deadline'].includes(mode)){
        assert.equal(result.state,'started');assert.equal(result.controller.generation,2);
        assert.equal(result.controller.pid,102);assert.equal(result.controller.startIdentity,'boot:start-2');
        assert.equal(result.controller.paneId,'w1:p2');assert.equal(launches[1].phase,'proved');
        assert.equal(f.clock,mode==='exact-deadline'?15000:300);
      }else{
        assert.equal(result.state,'uncertain');assert.equal(result.code,'process_unproved');
        assert.equal(launches[1].phase,'pane.run.intent');assert.equal(launches[1].proof,undefined);
        assert.equal(launches[1].exitedProof,undefined);assert.match(result.message,/may be running/);
      }
      await startWorkflowController(f.spec,f.ports);
      assert.equal(calls.commands.length,2,'inspection cannot redeliver an uncertain or proved launch');
      assert.equal(calls.tabs.length,2);
    }else{
      assert.equal(launches.length,1);
      if(['overdue-lock','unknown-lock'].includes(mode)){
        assert.equal(result.state,'uncertain');assert.equal(result.code,'process_unproved');
        assert.equal(launches[0].phase,'proved');assert.equal(launches[0].exitedProof,undefined);
      }else{
        assert.equal(result.state,'refused');
        assert.equal(result.code,{'admission-lock':'controller_busy','assignment-invalid':'assignment_invalid','live-prior':'controller_busy','stale-decision':'stale_decision'}[mode]);
      }
    }
  });
});
