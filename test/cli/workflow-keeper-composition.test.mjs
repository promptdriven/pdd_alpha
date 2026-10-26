import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {runPdd} from '../../src/pdd-cli.mjs';
import {loadGuidance} from '../../src/guidance.mjs';
import {prepareWorkflow,readWorkflowJournal} from '../../src/workflow-runner.mjs';
import {createWorkflowKeeperPorts,restoreManagedWorkflowSession} from '../../src/workflow-keeper.mjs';
import {inspectWorkflowLock} from '../../src/workflow-claims.mjs';
import {readProcessStartIdentity} from '../../src/workflow-herdr-client.mjs';

const exec=promisify(execFile),packageRoot=resolve(import.meta.dirname,'../..');
const launchId='123e4567-e89b-42d3-a456-426614174000';
async function fixture(t){
  const home=await fs.mkdtemp(join(tmpdir(),'pdd-keeper-'));t.after(()=>fs.rm(home,{recursive:true,force:true}));
  const cwd=join(home,'repo');await fs.mkdir(cwd);
  const git=async(...args)=>(await exec('git',args,{cwd})).stdout.trim();
  await git('init','-b','main');await git('config','user.name','Synthetic');await git('config','user.email','synthetic@example.invalid');
  await fs.writeFile(join(cwd,'README.md'),'Keep all saved work.\n');await git('add','.');await git('commit','-m','initial');
  await git('remote','add','origin','https://github.com/example/project.git');await git('update-ref','refs/remotes/origin/main',await git('rev-parse','HEAD'));
  const herdrExecutable=join(home,'herdr');await fs.writeFile(herdrExecutable,'#!/bin/sh\nexit 99\n',{mode:0o700});
  const abort=new AbortController(),commands=[],output=[];
  // Only the GitHub/Git network and Herdr service boundaries are synthetic.
  // Git, freeze, strict readers, assignment/lifecycle, native locks, OS identity,
  // controller composition and the public CLI/keeper entry remain real.
  const ports={home,loadGuidance,signal:abort.signal,env:{HOME:home,PDD_TRACE:''},
    stdout:{write(s){output.push(s);}},stderr:{write(s){output.push(s);if(s.includes('this needs the fleet client'))abort.abort();}},
    runtime:{herdr:herdrExecutable,v:1,releaseId:'synthetic',versionRoot:packageRoot,packageRoot,node:process.execPath,bin:join(packageRoot,'bin/pdd.mjs'),pddVersion:'test',alphaDigest:'a'.repeat(64),nodeVersion:process.versions.node,clientDigest:null,credentialHelper:null},
    execFile:async(file,args,opts)=>{
      commands.push([file,args]);
      if(file==='git'&&args[0]==='fetch'){
        const head=(await exec('git',['rev-parse','refs/remotes/origin/main'],opts)).stdout.trim();
        const path=resolve(opts.cwd,(await exec('git',['rev-parse','--git-path','FETCH_HEAD'],opts)).stdout.trim());
        await fs.writeFile(path+'.fixture',head+'\n');await fs.rename(path+'.fixture',path);return {stdout:''};
      }
      if(file==='git'&&!['push','ls-remote'].includes(args[0]))return exec(file,args,opts);
      if(file==='gh'&&args[0]==='repo')return {stdout:JSON.stringify({nameWithOwner:'example/project',defaultBranchRef:{name:'main'},url:'https://github.com/example/project'})};
      if(file==='gh'&&args[0]==='api')return {stdout:JSON.stringify({number:17,html_url:'https://github.com/example/project/issues/17',title:'Synthetic',body:'Retain work.',state:'OPEN',isPullRequest:false})};
      assert.equal(file,herdrExecutable,'No native agent, installer or service startup is permitted');
      assert.deepEqual(args.slice(0,2),['--session','default']);
      const operation=args.slice(2,4).join('.');let result;
      if(operation==='pane.list')result={panes:[{pane_id:'wA:pB'}]};
      else if(operation==='pane.process-info'){
        result={process_info:{pane_id:'wA:pB',shell_pid:process.pid,foreground_processes:[{pid:process.pid,argv:[process.execPath]}]}};
        if(commands.filter(([f,a])=>f===herdrExecutable&&a[2]==='pane'&&a[3]==='process-info').length===2)abort.abort();
      }else assert.fail('Read-only first recovery pass cannot mutate Herdr: '+operation);
      return {stdout:JSON.stringify({result}),code:0};
    }};
  const spec=await prepareWorkflow({cwd,name:'small-change',issue:'17',packageRoot,machineId:'local',agent:'codex'},ports);
  assert.equal(spec.state,'prepared',spec.message);
  return {home,cwd,ports,spec,abort,commands,output};
}

test('pdd runs-keeper composes real factories, physical authority and OS identity; conditional paths explain the fleet prerequisite',async t=>{
  const f=await fixture(t),before=await fs.readFile(join(f.spec.runDir,'journal.jsonl'));
  const local=await createWorkflowKeeperPorts(f.ports);
  for(const name of ['observeQuota','observeHerdr','readManagedLaunch','validateManagedRuntime','validateManagedFlags','validateOwner','restoreNative','readWorkflowJournal','validateLocator','withLifecycleGuard','validateRun','inspectControllerLock','processStartIdentity'])assert.equal(typeof local[name],'function',name);
  const journal=await local.readWorkflowJournal(f.spec),entry={runId:f.spec.runId,runDir:f.spec.runDir,root:f.spec.root,commonDir:journal.state.assignment.commonDir};
  assert.equal(await local.validateLocator(entry),true);
  assert.equal(await local.validateLocator({...entry,root:f.cwd}),false);
  assert.equal(await local.processStartIdentity({pid:process.pid}),await readProcessStartIdentity({pid:process.pid}));
  assert.equal(await runPdd(['runs-keeper'],{home:f.home,cwd:f.cwd,ports:f.ports,stdout:f.ports.stdout,stderr:f.ports.stderr}),0);
  assert.equal(f.abort.signal.aborted,true);
  assert.deepEqual(f.commands.filter(([name])=>name===f.spec.runtime.herdr).map(([,args])=>args.slice(2,4).join('.')),['pane.list','pane.process-info','pane.process-info']);
  assert.equal(await inspectWorkflowLock({path:join(f.home,'.pdd/runs/keeper.lock')}),'free');
  assert.deepEqual(await fs.readFile(join(f.spec.runDir,'journal.jsonl')),before);
  assert.equal(await fs.stat(join(f.spec.runDir,'controller-launch')).then(()=>true,()=>false),false);
  assert.deepEqual(await local.observeQuota({entry,state:journal.state}),{fresh:false,room:false,code:'fleet_client_required',message:'This recovery operation is unavailable: this needs the fleet client.'});
  for(const name of ['readManagedLaunch','validateManagedRuntime','validateManagedFlags','validateOwner','restoreNative'])await assert.rejects(local[name]({launchId}),{code:'fleet_client_required'});
  const restored=await restoreManagedWorkflowSession({launchId,generation:1},f.ports);
  assert.equal(restored.state,'refused');assert.equal(restored.code,'fleet_client_required');assert.match(restored.message,/this needs the fleet client/);
  assert.equal(await fs.stat(join(f.home,'.pdd/claims')).then(()=>true,()=>false),false);
});

test('public keeper reports due quota dependency without controller effects or journal writes',async t=>{
  const f=await fixture(t),j=await readWorkflowJournal(f.spec);
  const state={...j.state,seq:j.seq+1,controlState:'WAIT',quota:{until:Date.now()-1000}};
  await fs.appendFile(join(f.spec.runDir,'journal.jsonl'),JSON.stringify({seq:state.seq,event:'quota.updated',state})+'\n');
  const before=await fs.readFile(join(f.spec.runDir,'journal.jsonl'));
  const timeout=setTimeout(()=>f.abort.abort(),3000);t.after(()=>clearTimeout(timeout));
  assert.equal(await runPdd(['runs-keeper'],{home:f.home,cwd:f.cwd,ports:f.ports,stdout:f.ports.stdout,stderr:f.ports.stderr}),0);
  assert.match(f.output.join(''),/this needs the fleet client/);
  assert.equal(f.commands.some(([name])=>name===f.spec.runtime.herdr),false);
  assert.deepEqual(await fs.readFile(join(f.spec.runDir,'journal.jsonl')),before);
  assert.equal(await fs.stat(join(f.spec.runDir,'controller-launch')).then(()=>true,()=>false),false);
});

test('keeper composition preserves supplied references and refuses missing managed authority before claims',async()=>{
  const supplied={herdr:{},processStartIdentity:async()=>null,observeHerdr:async()=>({complete:false}),observeQuota:async()=>({fresh:false}),future:{exact:true}};
  const local=await createWorkflowKeeperPorts(supplied);
  for(const name of Object.keys(supplied))assert.equal(local[name],supplied[name]);
  assert.equal(supplied.readManagedLaunch,undefined);
  const record={launchId,generation:1,runtime:{saved:true},flags:['saved'],kind:'codex'};
  for(const missing of ['validateManagedRuntime','validateManagedFlags','validateOwner','restoreNative']){
    const ports={...supplied,readManagedLaunch:async()=>record,validateManagedRuntime:async()=>true,validateManagedFlags:async()=>true,validateOwner:async()=>({state:'current'}),restoreNative:async()=>assert.fail('Cannot restore'),acquireLock:()=>assert.fail('Cannot claim with incomplete authority')};
    delete ports[missing];
    const r=await restoreManagedWorkflowSession({launchId,generation:1},ports);
    assert.equal(r.code,'fleet_client_required',missing);assert.match(r.message,/this needs the fleet client/);
  }
  assert.deepEqual(await restoreManagedWorkflowSession({},{}),{state:'unmanaged'});
  assert.deepEqual(await restoreManagedWorkflowSession({launchId:'bad',generation:1},{}),{state:'refused',code:'unsupported'});
});

test('malformed explicit managed restore providers are retained but refused before native claims',async()=>{
  const record={launchId,generation:1,runtime:{saved:true},flags:['saved'],kind:'codex',nativeSessionId:launchId};
  for(const name of ['restoreNative','validateOwner','validateManagedRuntime','validateManagedFlags','readManagedLaunch','accountAdapter']){
    for(const value of [null,{},false]){
      let acquired=0,released=0;
      const ports={readManagedLaunch:async()=>({...record,managedAccount:name==='accountAdapter'}),
        validateManagedRuntime:async()=>true,validateManagedFlags:async()=>true,validateOwner:async()=>({state:'current'}),
        restoreNative:async()=>assert.fail('Invalid binding cannot restore'),
        acquireLock:async()=>{acquired++;return {state:'owned',release:async()=>{released++;}};},[name]:value};
      const local=await createWorkflowKeeperPorts(ports);assert.equal(local[name],value);
      const r=await restoreManagedWorkflowSession({launchId,generation:1},ports);
      assert.equal(acquired,0,`${name}: no claim for ${String(value)}`);assert.equal(released,0);
      assert.equal(r.state,'refused',name);assert.equal(r.code,'unsupported',name);assert.match(r.message,/callable/);
    }
  }
});
