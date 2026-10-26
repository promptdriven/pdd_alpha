import test from 'node:test';
import assert from 'node:assert/strict';
import {runPdd} from '../../src/pdd-cli.mjs';
const id='123e4567-e89b-42d3-a456-426614174000';
const capture=()=>({text:'',write(s){this.text+=s;}});
const io=()=>({stdout:capture(),stderr:capture()});
test('prepared resume composes actual controller factory once after readiness with exact saved runtime',async()=>{
 const deps=io(),calls=[],runtime={node:'/frozen/node',bin:'/frozen/pdd'},raw={node:'/raw/node'},herdr={same:true};let preparedPorts;
 const factory=async p=>{calls.push('factory');assert.equal(p,preparedPorts);return {...p,herdr};};
 assert.equal(await runPdd(['workflow','resume',id],{...deps,ports:{runtime:raw},workflowHerdrBoot:{ensureDefaultHerdr:async p=>{calls.push('ready');assert.equal(p,preparedPorts);return {state:'ready',code:null};}},workflowRunner:{resumeWorkflow:async(input,p)=>{calls.push('prepare');preparedPorts=p;return {state:'prepared',runId:id,runtime};}},workflowController:{createLocalWorkflowControllerPorts:factory,startWorkflowController:async(input,p)=>{calls.push('start');assert.equal(p.herdr,herdr);assert.equal(p.runtime,raw);assert.equal(input.runtime,runtime);return {state:'started'};}}}),0);
 assert.deepEqual(calls,['prepare','ready','factory','start']);
});
test('failed composition cannot launch, reprepare or leak raw failure details',async()=>{
 const deps=io();let prepared=0,composed=0;
 assert.equal(await runPdd(['workflow','resume',id],{...deps,workflowRunner:{resumeWorkflow:async()=>{prepared++;return {state:'prepared',runId:id};}},workflowController:{createLocalWorkflowControllerPorts:async()=>{composed++;throw Error('private-synthetic-secret');},startWorkflowController:()=>assert.fail('no launch')}}),1);
 assert.equal(prepared,1);assert.equal(composed,1);assert.doesNotMatch(deps.stderr.text,/private-synthetic-secret/);
});
test('drive binds same shared OS identity without Herdr action and preserves supplied callback',async()=>{
 const stages=Object.fromEntries(['runHerdrStage','inspectHerdrStage','attachHerdrStage','closeHerdrStage','resumeHerdrStage'].map(name=>[name,()=>{}]));
 const {readProcessStartIdentity}=await import('../../src/workflow-herdr-client.mjs');
 for(const injected of [false,true]){
  const deps=io(),callback=()=> 'explicit';
  assert.equal(await runPdd(['workflow','drive',id],{...deps,workflowStages:stages,ports:{...(injected?{processStartIdentity:callback}:{}),execFile:()=>assert.fail('No transport in identity read')},workflowRunner:{driveWorkflow:async(input,p)=>{
   if(injected)assert.equal(p.processStartIdentity,callback);
   else assert.equal(await p.processStartIdentity({pid:process.pid}),await readProcessStartIdentity({pid:process.pid},p));
   return {state:'waiting',message:'Synthetic drive complete.',exitCode:2};
  }}}),2);
 }
});
test('injected keeper preserves complete supplied refs without constructing real transport',async()=>{
 const deps=io(),herdr={},processStartIdentity=()=>{},observeHerdr=()=>{};
 assert.equal(await runPdd(['runs-keeper'],{...deps,ports:{herdr,processStartIdentity,observeHerdr,execFile:()=>assert.fail()},workflowController:{createLocalWorkflowControllerPorts:()=>assert.fail('injected keeper seam')},workflowKeeper:{runWorkflowKeeper:async(input,p)=>{assert.equal(p.herdr,herdr);assert.equal(p.processStartIdentity,processStartIdentity);assert.equal(p.observeHerdr,observeHerdr);return {exitCode:0};}}}),0);
});
