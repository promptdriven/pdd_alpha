import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {prepareWorkflow,driveWorkflow,readWorkflowJournal,createWorkflowControllerAuthorityPorts} from '../src/workflow-runner.mjs';
import {createLocalWorkflowControllerPorts,startWorkflowController,readControllerLaunches} from '../src/workflow-controller.mjs';
import {fakeLocks} from './cli/runner-a-fixtures.mjs';
import {loadGuidance} from '../src/guidance.mjs';
import {withWorkflowLock,inspectWorkflowLock} from './cli/workflow-test-lock.mjs';
const exec=promisify(execFile),packageRoot=resolve(import.meta.dirname,'..');
async function fixture(t){
  const home=await fs.mkdtemp(join(tmpdir(),'pdd-authority-'));t.after(()=>fs.rm(home,{recursive:true,force:true}));
  const cwd=join(home,'repo');await fs.mkdir(cwd);
  const git=async(...args)=>(await exec('git',args,{cwd})).stdout.trim();
  await git('init','-b','main');await git('config','user.name','Synthetic');await git('config','user.email','synthetic@example.invalid');
  await fs.writeFile(join(cwd,'README.md'),'Retained input.\n');await git('add','.');await git('commit','-m','initial');
  await git('remote','add','origin','https://github.com/example/project.git');await git('update-ref','refs/remotes/origin/main',await git('rev-parse','HEAD'));
  const calls=[];
  const ports={home,loadGuidance,withWorkflowLock,inspectWorkflowLock,stdout:{write(){}},stderr:{write(){}},
    runtime:{v:1,releaseId:'synthetic',versionRoot:packageRoot,packageRoot,node:process.execPath,bin:join(packageRoot,'bin/pdd.mjs'),pddVersion:'test',alphaDigest:'a'.repeat(64),nodeVersion:process.versions.node,clientDigest:null,credentialHelper:null,future:{preserved:true}},
    resolveWorkflowModel:async({agent})=>({state:'selected',selection:{machineId:null,agent,model:null,effort:null,cliVersion:'test',catalogRevision:'test',source:'native-defaults'}}),
    execFile:async(file,args,opts)=>{
      calls.push([file,args]);
      if(file==='git'&&args[0]==='fetch'){
        const head=(await exec('git',['rev-parse','refs/remotes/origin/main'],opts)).stdout.trim();
        const path=resolve(opts.cwd,(await exec('git',['rev-parse','--git-path','FETCH_HEAD'],opts)).stdout.trim());
        await fs.writeFile(path+'.fixture',head+'\n');await fs.rename(path+'.fixture',path);return {stdout:''};
      }
      if(file==='git'&&!['push','ls-remote'].includes(args[0]))return exec(file,args,opts);
      if(file==='gh'&&args[0]==='repo')return {stdout:JSON.stringify({nameWithOwner:'example/project',defaultBranchRef:{name:'main'},url:'https://github.com/example/project'})};
      if(file==='gh'&&args[0]==='api')return {stdout:JSON.stringify({number:17,html_url:'https://github.com/example/project/issues/17',title:'Synthetic',body:'Retain work.',state:'OPEN',isPullRequest:false})};
      assert.fail('Unexpected command: '+file);
    }};
  const spec=await prepareWorkflow({cwd,name:'small-change',issue:'17',packageRoot,agent:'codex'},ports);
  assert.equal(spec.state,'prepared',spec.message);
  const authority=createWorkflowControllerAuthorityPorts(ports);
  return {home,cwd,spec,ports,authority,calls};
}
test('authority validates a real prepared physical assignment without writing or native effects',async t=>{
  const f=await fixture(t),before=await fs.readFile(join(f.spec.runDir,'journal.jsonl'));
  const {state}=await f.authority.readWorkflowJournal(f.spec);
  assert.equal(await f.authority.validateRun(f.spec,state),true);
  assert.equal(await f.authority.inspectControllerLock(f.spec),'free');
  assert.deepEqual(await fs.readFile(join(f.spec.runDir,'journal.jsonl')),before);
  assert.ok(f.calls.every(([file])=>['git','gh'].includes(file)));
});
test('authority rejects stale state, changed canonical metadata and arbitrary locators before lifecycle effects',async t=>{
  const f=await fixture(t),{state}=await readWorkflowJournal(f.spec);
  assert.equal(await f.authority.validateRun(f.spec,{...state,seq:state.seq+1}),false);
  for(const patch of [{root:f.cwd},{runtime:{...f.spec.runtime,future:{preserved:false}}},{workflow:'other'},{issueNumber:18},{runDir:join(f.home,'invented')}]){
    const bad={...f.spec,...patch};assert.equal(await f.authority.validateRun(bad,state),false);
    assert.equal(await f.authority.inspectControllerLock(bad),'unknown');
    await assert.rejects(f.authority.withLifecycleGuard(bad,()=>assert.fail('invalid locator cannot run action')));
  }
  assert.equal(await fs.stat(join(f.home,'invented')).then(()=>true,()=>false),false);
});
test('lifecycle guard validates again after acquisition and releases on changed frozen input',async t=>{
  const f=await fixture(t);let entered=0,released=0,actions=0;
  const p={...f.ports,withWorkflowLock:async(spec,action)=>{
    assert.ok(spec.path.endsWith(f.spec.runId+'.lock'));entered++;
    await fs.appendFile(join(f.spec.runDir,'frozen/input-0.txt'),'changed');
    try{return await action();}finally{released++;}
  }};
  await assert.rejects(createWorkflowControllerAuthorityPorts(p).withLifecycleGuard(f.spec,()=>actions++));
  assert.equal(entered,1);assert.equal(released,1);assert.equal(actions,0);
});
test('real lifecycle retirement and unknown controller lock never authorize launch',async t=>{
  const f=await fixture(t),s=(await readWorkflowJournal(f.spec)).state;
  const parent=join(s.assignment.commonDir,'pdd/run-lifecycle');await fs.mkdir(parent,{recursive:true});
  await fs.writeFile(join(parent,f.spec.runId+'.json'),JSON.stringify({state:'removing'}));
  await assert.rejects(f.authority.withLifecycleGuard(f.spec,()=>assert.fail('retired run')));
  for(const inspectWorkflowLock of [async()=> 'unknown',async()=>{throw Error('unknown');}]){
    assert.equal(await createWorkflowControllerAuthorityPorts({...f.ports,inspectWorkflowLock}).inspectControllerLock(f.spec),'unknown');
  }
});
test('factory never substitutes a caller journal for the strict history reader',async t=>{
  const f=await fixture(t);let forged=0;
  const a=createWorkflowControllerAuthorityPorts({...f.ports,readWorkflowJournal:async()=>{forged++;return {state:{},seq:1};}});
  const j=await a.readWorkflowJournal(f.spec);assert.equal(j.state.runId,f.spec.runId);assert.equal(forged,0);
  await fs.appendFile(join(f.spec.runDir,'journal.jsonl'),'partial');
  await assert.rejects(a.readWorkflowJournal(f.spec));
  assert.equal(await a.validateRun(f.spec,j.state),false);assert.equal(forged,0);
});
test('controller authority inspects the real lifetime lock and preserves full assignment identity',async t=>{
  const f=await fixture(t),j=await readWorkflowJournal(f.spec);
  await withWorkflowLock({path:join(f.spec.runDir,'controller.lock')},async()=>{
    assert.equal(await f.authority.inspectControllerLock(f.spec),'held');
  });
  assert.equal(await f.authority.inspectControllerLock(f.spec),'free');
  const a=createWorkflowControllerAuthorityPorts({...f.ports,lookupIssueWorktree:async()=>({state:'ready',assignment:{...j.state.assignment,baseSha:'b'.repeat(40)}})});
  assert.equal(await a.validateRun(f.spec,j.state),false);
  await assert.rejects(a.withLifecycleGuard(f.spec,()=>assert.fail('different assignment cannot act')));
});
test('local composition retains complete supplied port references and validates keeper locators physically',async t=>{
  const f=await fixture(t),custom=async()=> 'held',runtime={raw:'resolver'},future={untouched:true},herdr={};
  const supplied={...f.ports,runtime,herdr,processStartIdentity:async()=>null,observeHerdr:async()=>({complete:false}),inspectControllerLock:custom,future};
  const local=await createLocalWorkflowControllerPorts(supplied);
  assert.equal(local.runtime,runtime);assert.equal(local.herdr,herdr);assert.equal(local.future,future);assert.equal(local.execFile,f.ports.execFile);assert.equal(local.inspectControllerLock,custom);
  assert.equal(supplied.validateLocator,undefined);
  const s=(await readWorkflowJournal(f.spec)).state;
  const entry={runId:s.runId,root:s.root,runDir:f.spec.runDir,commonDir:s.assignment.commonDir};
  assert.equal(await local.validateLocator(entry),true);
  for(const patch of [{root:f.cwd},{commonDir:f.home},{runId:'00000000-0000-4000-8000-000000000000'}])assert.equal(await local.validateLocator({...entry,...patch}),false);
});
test('drive journals the exact shared OS identity and retains tracing in its bounded command environment',async t=>{
  const f=await fixture(t),identity='linux:synthetic-boot:12345',before=process.env.PDD_TRACE;
  process.env.PDD_TRACE='herdr,git';t.after(()=>{if(before===undefined)delete process.env.PDD_TRACE;else process.env.PDD_TRACE=before;});
  const tools=join(f.home,'tools'),output=join(f.home,'child-env');await fs.mkdir(tools);
  const reply=JSON.stringify({result:{type:'pane_process_info',process_info:{pane_id:'w1:p1',shell_pid:1,foreground_process_group_id:process.pid,foreground_processes:[{pid:process.pid,argv:[f.spec.runtime.node,f.spec.runtime.bin,'workflow','drive',f.spec.runId]}]}}});
  await fs.writeFile(join(tools,'herdr'),'#!/bin/sh\nprintf "%s\\n%s\\n" "$PDD_TRACE" "$SAFE" > "$PROBE_OUTPUT"\nprintf "%s\\n" "$PROBE_REPLY"\n',{mode:0o700});
  f.ports.env={PATH:tools,SAFE:'retained',PROBE_OUTPUT:output,PROBE_REPLY:reply};
  f.ports.controller={herdrSession:'default',workspaceId:'w1',tabId:'w1:t1',paneId:'w1:p1'};
  f.ports.processStartIdentity=async input=>{assert.deepEqual(input,{pid:process.pid,paneId:'w1:p1'});return identity;};
  f.ports.resolveWorkflowModel=async()=>({state:'refused'}); // stop after proof, before any stage
  delete f.ports.execFile; // real default executor; resume only reads local Git, never fetches
  await driveWorkflow({runId:f.spec.runId,cwd:f.cwd,packageRoot},f.ports);
  const j=await readWorkflowJournal(f.spec);assert.equal(j.state.controller.startIdentity,identity);assert.equal(j.state.controller.pid,process.pid);
  assert.equal(await fs.readFile(output,'utf8'),'herdr,git\nretained\n');assert.equal(f.ports.env.PDD_TRACE,undefined);
});
test('drive refuses unavailable shared OS identity instead of falling back to raw local start ticks',async t=>{
  const f=await fixture(t),execute=f.ports.execFile,before=await fs.readFile(join(f.spec.runDir,'journal.jsonl'));
  f.ports.controller={herdrSession:'default',workspaceId:'w1',tabId:'w1:t1',paneId:'w1:p1'};
  f.ports.processStartIdentity=async()=>null;
  f.ports.execFile=async(file,args,opts)=>file==='herdr'?{stdout:JSON.stringify({result:{process_info:{pane_id:'w1:p1',foreground_processes:[{pid:process.pid,argv:[f.spec.runtime.node,f.spec.runtime.bin,'workflow','drive',f.spec.runId]}]}}})}:execute(file,args,opts);
  const r=await driveWorkflow({runId:f.spec.runId,cwd:f.cwd,packageRoot},f.ports);
  assert.equal(r.exitCode,1);assert.match(r.message,/start identity is unavailable/);
  assert.deepEqual(await fs.readFile(join(f.spec.runDir,'journal.jsonl')),before);
});
test('real public adapter joins Herdr-shaped replies to OS identity and actual frozen drive journal',async t=>{
  const f=await fixture(t),execute=f.ports.execFile;let intent,starts=0,local;
  f.ports.acquireLock=fakeLocks();
  f.ports.env={...process.env,PDD_TRACE:''};
  f.ports.controller={herdrSession:'default',workspaceId:'w1',tabId:'w1:t2',paneId:'w1:p2'};
  f.ports.resolveWorkflowModel=async()=>({state:'refused'}); // never reach native stages
  f.ports.execFile=async(file,args,opts)=>{
    if(file!=='herdr')return execute(file,args,opts);
    assert.deepEqual(args.slice(0,2),['--session','default']);
    const op=args.slice(2,4).join('.');
    let result;
    if(op==='pane.list')result={type:'pane_list',panes:[{pane_id:'w1:p1'}]};
    else if(op==='workspace.list')result={type:'workspace_list',workspaces:[{workspace_id:'w1',cwd:f.spec.root}]};
    else if(op==='tab.create')result={tab:{tab_id:'w1:t2'},root_pane:{tab_id:'w1:t2',pane_id:'w1:p2',terminal_id:'synthetic-terminal'}};
    else if(op==='pane.run'){
      starts++;intent=(await readControllerLaunches(f.spec)).at(-1);
      assert.equal(args[5],intent.line);
      await driveWorkflow({runId:f.spec.runId,cwd:f.cwd,packageRoot,launchId:intent.launchId},local);
      result={type:'ok'};
    }else if(op==='pane.process-info'){
      const paneId=args.at(-1),argv=paneId==='w1:p2'&&intent?intent.argv:['/bin/bash'];
      // Synthetic identifiers with the real public foreground-process schema;
      // OS evidence belongs only to this test's Node PID, not a lab controller.
      result={type:'pane_process_info',process_info:{pane_id:paneId,shell_pid:process.pid,foreground_process_group_id:process.pid,
        foreground_processes:[{pid:process.pid,argv,cmdline:'synthetic',cwd:f.spec.root,name:argv[0]==='/bin/bash'?'bash':'node'}]}};
    }else assert.fail('Unexpected synthetic Herdr operation: '+op);
    return {stdout:JSON.stringify({id:'synthetic',result}),code:0};
  };
  local=await createLocalWorkflowControllerPorts(f.ports);
  const r=await startWorkflowController(f.spec,local);
  assert.equal(r.state,'started',JSON.stringify(r));assert.equal(starts,1);
  const journal=await readWorkflowJournal(f.spec),saved=(await readControllerLaunches(f.spec)).at(-1);
  assert.equal(r.controller.startIdentity,journal.state.controller.startIdentity);
  assert.equal(saved.proof.process.startIdentity,journal.state.controller.startIdentity);
  assert.equal(saved.proof.process.pid,process.pid);assert.equal(journal.state.controller.launchId,intent.launchId);
  assert.equal(journal.state.controller.generation,1);assert.deepEqual(saved.proof.process.argv,intent.argv);
  assert.match(r.controller.startIdentity,process.platform==='linux'?/^linux:[a-f0-9-]+:\d+$/:/^darwin:/);
  assert.equal((await startWorkflowController(f.spec,local)).state,'started');assert.equal(starts,1);
});
