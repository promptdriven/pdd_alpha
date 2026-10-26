import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,cpSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {runPdd} from '../../src/pdd-cli.mjs';
const repo=dirname(dirname(dirname(fileURLToPath(import.meta.url))));
// A worker checkout can explicitly supply reviewed dependency sources. In the
// integrated tree the same tests use ordinary public modules from this package.
const runnerRoot=process.env.PDD_CLI_RUNNER_ROOT??repo,pkgRoot=process.env.PDD_CLI_PACKAGING_ROOT??repo,placementRoot=process.env.PDD_CLI_PLACEMENT_ROOT??repo;
const capture=()=>({text:'',write(s){this.text+=s;}});
const runId='123e4567-e89b-42d3-a456-426614174000',decisionId='223e4567-e89b-42d3-a456-426614174000';
function temp(t){const path=mkdtempSync(join(tmpdir(),'pdd-owner-composition-'));t.after(()=>rmSync(path,{recursive:true,force:true}));return path;}
for(const legacy of [false,true])test('CLI human resume composes with actual public controller and fake Herdr process proof'+(legacy?' including legacy expectations':'' ),{skip:!existsSync(join(runnerRoot,'src/workflow-controller.mjs'))},async t=>{
 const controller=await import(pathToFileURL(join(runnerRoot,'src/workflow-controller.mjs')));
 const runDir=join(temp(t),runId);mkdirSync(runDir);const runtime={node:'/saved/node',bin:'/saved/bin/pdd.mjs'};
 const prepared={state:'prepared',runId,runDir,root:'/assigned',workflow:'feature',issueNumber:7,runtime};
 const state={runId,runtime,controlState:'waiting_person',rev:57,waitingPerson:{decisions:['approve']}},calls=[];let proof;
 const stdout=capture(),stderr=capture();
 const code=await runPdd(['workflow','resume',runId,'--decision','approve','--id',decisionId,'--rev','57',...(legacy?['--expect-stage','review','--expect-seq','4']:[])],{stdout,stderr,
  workflowRunner:{resumeWorkflow:async()=>prepared},workflowController:controller,
  ports:{acquireLock:async()=>({state:'owned',release:async()=>{}}),now:()=>60000,withLifecycleGuard:async(spec,op)=>op(),
   validateRun:async()=>true,inspectControllerLock:async()=> 'free',readWorkflowJournal:async()=>({state,seq:2}),herdr:{
    supportsProcessIdentity:async()=>true,listWorkspaces:async()=>[{workspaceId:'workspace',cwd:'/assigned'}],
    createWorkspace:async()=>assert.fail('The existing workspace must be reused; no creation is allowed'),
    createTab:async()=>({tabId:'tab',paneId:'pane',terminalId:'terminal'}),
    paneRun:async input=>{calls.push(input);const intent=(await controller.readControllerLaunches(prepared)).at(-1);
     state.controller={started:true,launchId:intent.launchId,generation:1,pid:123,startIdentity:'synthetic:start',paneId:'pane'};
     proof={pid:123,startIdentity:'synthetic:start',paneId:'pane',executable:runtime.node,argv:intent.argv};},processInfo:async()=>proof
   }}});
 assert.equal(code,0,stderr.text);assert.equal(calls.length,1);
 const intent=(await controller.readControllerLaunches(prepared)).at(-1);
 assert.deepEqual(intent.decision,{decision:'approve',id:decisionId,rev:57,...(legacy?{expectStage:'review',expectSeq:4}:{})});
 if(legacy){assert.ok(intent.argv.includes('--expect-stage'));assert.equal(intent.argv.at(-1),'4');}
 assert.ok(intent.argv.includes('--rev'));assert.ok(intent.proof);assert.match(stdout.text,/Started workflow/);
});
test('Alpha-only setup uses actual packaging runtime, update lease, launcher and recovery provisioning',{skip:!existsSync(join(pkgRoot,'src/pdd-launch.mjs'))},async t=>{
 const setupModules={};for(const [key,file] of [['versions','versions'],['lock','update-lock'],['launcher','pdd-launch']])setupModules[key]=await import(pathToFileURL(join(pkgRoot,'src',file+'.mjs')));
 const home=temp(t),versionRoot=join(home,'.pdd/versions/synthetic'),node=join(home,'.pdd/tools/node/22.0.0/bin/node');
 mkdirSync(join(versionRoot,'bin'),{recursive:true});mkdirSync(dirname(node),{recursive:true});
 writeFileSync(node,'#!/bin/sh\nexit 0\n',{mode:0o755});writeFileSync(join(versionRoot,'bin/pdd.mjs'),'// synthetic candidate');
 writeFileSync(join(versionRoot,'package.json'),JSON.stringify({type:'module',version:'1.0.0'}));
 const runtime={v:1,releaseId:'synthetic',versionRoot,node,bin:join(versionRoot,'bin/pdd.mjs'),pddVersion:'1.0.0',nodeVersion:'22.0.0',alphaDigest:'synthetic',clientDigest:null,credentialHelper:null};
 writeFileSync(join(versionRoot,'runtime.json'),JSON.stringify(runtime));mkdirSync(join(versionRoot,'src'));
 for(const name of ['pdd-launch','detached-updater','update-lock','install-record','owned-node','versions'])cpSync(join(pkgRoot,'src',name+'.mjs'),join(versionRoot,'src',name+'.mjs'));
 cpSync(join(pkgRoot,'launcher'),join(versionRoot,'launcher'),{recursive:true});
 const stdout=capture(),stderr=capture();let activations=0;
 const deps={home,packageRoot:versionRoot,stdout,stderr,setupModules,workflowHerdrBoot:{ensureHerdrInstalled:async()=>({state:'ready',code:null})},ports:{activateRecoveryService:async({files})=>{activations++;assert.equal(files.length,1);}}};
 assert.equal(await runPdd(['setup'],deps),0,stderr.text);assert.match(stdout.text,/Public recovery service ready/);
 const files=setupModules.launcher.recoveryServiceFiles({home}),service=readFileSync(files[0].path,'utf8');
 assert.match(service,/runs-keeper/);assert.ok(existsSync(join(home,'.pdd/launcher/pdd-launch')));
 assert.equal(await runPdd(['setup'],deps),0,stderr.text);assert.equal(readFileSync(files[0].path,'utf8'),service);assert.equal(activations,2);
});

test('actual placement owner refuses every named target without client and preserves explicit auto local route',{skip:!existsSync(join(placementRoot,'src/workflow-placement.mjs'))},async()=>{
 const workflowPlacement=await import(pathToFileURL(join(placementRoot,'src/workflow-placement.mjs')));
 for(const on of ['local','desktop','auto']){
  let launches=0;const stdout=capture(),stderr=capture();
  const code=await runPdd(['session','--on',on],{stdout,stderr,workflowPlacement,machineId:'local',nativeSession:async()=>{launches++;return 0;}});
  assert.equal(code,on==='auto'?0:1);assert.equal(launches,on==='auto'?1:0);
  if(on!=='auto')assert.match(stderr.text,/remote_unsupported/);
 }
});
