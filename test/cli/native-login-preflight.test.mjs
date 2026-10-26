import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runPdd} from '../../src/pdd-cli.mjs';
import * as nativeAgentAuth from '../../src/native-agent-auth.mjs';

const advice='Agents need a sign-in: run `pdd accounts add codex` (or claude) when ready.\n';
const runId='3ba0c0c3-1c26-4a3c-8db6-39d988d3f85b';
function output(){return {text:'',write(value){this.text+=value;}};}
function io(){return {stdout:output(),stderr:output(),cwd:'/selected/repo'};}
const workflowModels={resolveWorkflowLaunchModel:async()=>({state:'selected',selection:{model:null,effort:null}})};
const reply=(agent,state='ready',code=null)=>({agent,state,code,message:'private-synthetic-payload'});
function start(deps={}) {
  return {...io(),workflowModels,workflowController:{startWorkflowController:async()=>({state:'started'})},
    workflowRunner:{prepareWorkflow:async()=>({state:'prepared',runId})},...deps};
}
function setup(calls) {
  return {versions:{resolveRuntime:async()=>{calls.push('runtime');return {};}},
    herdrRuntime:{recordHerdrRuntime:async({runtime})=>{calls.push('record');return runtime;}},
    lock:{withUpdateLock:async(_,action)=>{calls.push('lease');return action({});}},
    launcher:{installLauncherSupport:async()=>{calls.push('support');return {code:null};},
      provisionRecoveryService:async()=>{calls.push('service');return {code:null};}}};
}
for(const agent of ['codex','claude'])test(`new ${agent} workflow checks login before prepare exactly once`,async()=>{
  const calls=[],deps=start({nativeAgentAuth:{checkNativeAgentAuth:async input=>{calls.push('auth');assert.deepEqual(input,{agent,cwd:'/selected/repo'});return reply(agent);}},
    workflowRunner:{prepareWorkflow:async()=>{calls.push('prepare');return {state:'prepared',runId};}},
    workflowController:{startWorkflowController:async()=>{calls.push('controller');return {state:'started'};}}});
  assert.equal(await runPdd(['workflow','run','small-change','20','--agent',agent],deps),0);
  assert.deepEqual(calls,['auth','prepare','controller']);assert.equal(deps.stderr.text,'');assert.equal(deps.stdout.text,`Started workflow ${runId}.\n`);
});
for(const [state,code,expected] of [
  ['blocked','agent_sign_in_required',advice],
  ['unavailable','native_agent_missing','codex is not installed. Install it and run codex login.\n'],
  ['unavailable','agent_auth_status_unavailable','codex sign-in status is unavailable. Check codex login status before starting a workflow.\n']
])test(`workflow ${code} refuses before preparation and Herdr effects`,async()=>{
  let checks=0;const deps=start({nativeAgentAuth:{checkNativeAgentAuth:async()=>{checks++;return reply('codex',state,code);}},
    workflowRunner:{prepareWorkflow:()=>assert.fail('No preparation')},workflowHerdrBoot:{ensureDefaultHerdr:()=>assert.fail('No Herdr')},
    workflowController:{startWorkflowController:()=>assert.fail('No delivery')}});
  assert.equal(await runPdd(['workflow','run','small-change','20'],deps),1);
  assert.equal(checks,1);assert.equal(deps.stdout.text,'');assert.equal(deps.stderr.text,expected);
});
test('malformed, wrong-tool and thrown status cannot print private messages or grant admission',async()=>{
  for(const checkNativeAgentAuth of [async()=>({state:'ready',agent:'claude',code:null}),async()=>reply('codex','ready','bad'),async()=>{throw Error('synthetic-secret');},async()=>null]){
    const deps=start({nativeAgentAuth:{checkNativeAgentAuth},workflowRunner:{prepareWorkflow:()=>assert.fail('No preparation')}});
    assert.equal(await runPdd(['workflow','run','small-change','20'],deps),1);
    assert.match(deps.stderr.text,/sign-in status is unavailable/);assert.doesNotMatch(deps.stderr.text,/synthetic-secret|private-synthetic/);
  }
});
test('setup skips native probes and preserves installation/recovery/client ordering',async()=>{
  const calls=[],deps={...io(),setupModules:setup(calls),nativeAgentAuth:{checkNativeAgentAuth:async({agent})=>{calls.push(agent);return reply(agent,agent==='codex'?'ready':'unavailable',agent==='codex'?null:'native_agent_missing');}},
    workflowHerdrBoot:{ensureHerdrInstalled:async()=>{calls.push('herdr');return {state:'ready',code:null,executable:'/absolute/herdr'};}},
    clientAdapter:{runSetupCommand:async()=>{calls.push('client');return 0;}}};
  assert.equal(await runPdd(['setup'],deps),0);assert.deepEqual(calls,['runtime','herdr','lease','record','support','service','client']);
  assert.equal(deps.stderr.text,'');
});
for(const status of ['signed-out','missing','unknown','throws'])test(`setup ${status} native tools do not prevent provisioning or continuation`,async()=>{
  const calls=[];let probes=0;
  const deps={...io(),setupModules:setup(calls),nativeAgentAuth:{checkNativeAgentAuth:async({agent})=>{
    probes++;if(status==='throws')throw Error('private-payload');
    return reply(agent,status==='signed-out'?'blocked':'unavailable',status==='signed-out'?'agent_sign_in_required':status==='missing'?'native_agent_missing':'agent_auth_status_unavailable');}},
    workflowHerdrBoot:{ensureHerdrInstalled:async()=>{calls.push('herdr');return {state:'ready',code:null,executable:'/absolute/herdr'};}},
    clientAdapter:{runSetupCommand:async()=>{calls.push('client');return 0;}}};
  assert.equal(await runPdd(['setup'],deps),0);assert.equal(probes,0);
  assert.deepEqual(calls,['runtime','herdr','lease','record','support','service','client']);
  assert.equal(deps.stderr.text,'');assert.equal(deps.stdout.text,advice);
});
test('setup preserves nonzero and malformed private outcomes without completion advice',async()=>{
  for(const exit of [1,2,130,undefined,{},-1,256]){
    const calls=[],deps={...io(),setupModules:setup(calls),
      nativeAgentAuth:{checkNativeAgentAuth:()=>assert.fail('No native probe')},
      workflowHerdrBoot:{ensureHerdrInstalled:async()=>({state:'ready',code:null,executable:'/absolute/herdr'})},
      clientAdapter:{runSetupCommand:async()=>exit}};
    assert.equal(await runPdd(['setup'],deps),Number.isInteger(exit)&&exit>0&&exit<256?exit:1);
    assert.equal(deps.stdout.text,'');
  }
});
for(const agent of ['codex','claude'])test(`signed-out ${agent} foreground session refuses without launching or waiting`,async()=>{
  let probes=0;const deps={...io(),workflowModels,nativeAgentAuth:{checkNativeAgentAuth:async()=>{probes++;return reply(agent,'blocked','agent_sign_in_required');}},
    nativeSession:()=>assert.fail('No native launch')};
  assert.equal(await runPdd(['session','--agent',agent],deps),1);
  assert.equal(probes,1);assert.equal(deps.stdout.text,'');assert.equal(deps.stderr.text,advice);
});
test('setup readiness is not cached for a later new workflow',async()=>{
  let run=false;const calls=[],deps=start({setupModules:setup(calls),nativeAgentAuth:{checkNativeAgentAuth:async({agent})=>run?reply(agent,'blocked','agent_sign_in_required'):reply(agent)},
    workflowHerdrBoot:{ensureHerdrInstalled:async()=>({state:'ready',code:null,executable:'/absolute/herdr'})},workflowRunner:{prepareWorkflow:()=>assert.fail('No preparation')}});
  assert.equal(await runPdd(['setup'],deps),0);run=true;
  assert.equal(await runPdd(['workflow','run','small-change','20'],deps),1);assert.equal(deps.stderr.text,advice);
});
test('discovery, malformed input and remote source refusal never query native auth',async()=>{
  const deps=start({nativeAgentAuth:{checkNativeAgentAuth:()=>assert.fail('No native probe')}});
  for(const args of [['--help'],['--version'],['workflow','run','--help']])assert.equal(await runPdd(args,deps),0);
  assert.equal(await runPdd(['workflow','run'],deps),2);
  assert.equal(await runPdd(['workflow','run','small-change','20','--on','desktop'],deps),1);
});
test('default production workflow route uses real status helper and blocks signed-out saved scenario',async t=>{
  const root=await fs.mkdtemp(join(tmpdir(),'pdd-cli-login-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const binary=join(root,'codex');
  await fs.writeFile(binary,`#!${process.execPath}\nif(process.argv.slice(2).join(' ')!=='login status')process.exit(99);process.stderr.write('Not logged in\\n');process.exitCode=1;\n`,{mode:0o700});
  const deps={...io(),cwd:root,workflowModels,ports:{env:{PATH:root,HOME:root}},workflowHerdrBoot:{ensureDefaultHerdr:()=>assert.fail('No Herdr')},
    workflowController:{startWorkflowController:()=>assert.fail('No controller')}};
  assert.equal(await runPdd(['workflow','run','small-change','20'],deps),1);
  assert.equal(deps.stdout.text,'');assert.equal(deps.stderr.text,advice);
  assert.deepEqual((await fs.readdir(root)),['codex']);
});
test('real helper is usable through explicit offline-owner seam with native HOME preserved',async t=>{
  const root=await fs.mkdtemp(join(tmpdir(),'pdd-cli-ready-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.writeFile(join(root,'claude'),'stub',{mode:0o700});
  const env={PATH:root,HOME:join(root,'native-login')};let called=0;
  const deps=start({nativeAgentAuth,ports:{env,execFile:async(file,args,options)=>{called++;assert.equal(file,join(root,'claude'));assert.deepEqual(args,['auth','status','--json']);assert.equal(options.env,env);return {stdout:'{"loggedIn":true}',stderr:''};}}});
  assert.equal(await runPdd(['workflow','run','small-change','20','--agent','claude'],deps),0);assert.equal(called,1);
});
