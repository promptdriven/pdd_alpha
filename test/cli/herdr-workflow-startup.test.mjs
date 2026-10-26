import test from 'node:test';
import assert from 'node:assert/strict';
import {runPdd} from '../../src/pdd-cli.mjs';
const id='123e4567-e89b-42d3-a456-426614174000';
const capture=()=>({text:'',write(s){this.text+=s;}});
const io=()=>({stdout:capture(),stderr:capture()});
const workflowModels={resolveWorkflowLaunchModel:async()=>({state:'selected',selection:{agent:'codex'}})};
test('prepared local run and resume ensure default Herdr once before unchanged controller input',async()=>{
 for(const mode of ['run','resume']){
  const calls=[],deps=io(),raw={node:'/raw/node',unknown:{same:true}},frozen={node:'/frozen/node',bin:'/frozen/bin',unknown:{frozen:true}},callback=()=>{};
  const prepared={state:'prepared',runId:id,root:'/assigned',runDir:'/saved',runtime:frozen,unknown:{same:true}};let seenPorts;
  const prepare=async(input,p)=>{calls.push('prepare');seenPorts=p;assert.equal(p.runtime,raw);return prepared;};
  const workflowHerdrBoot={ensureDefaultHerdr:async p=>{calls.push('ready');assert.equal(p,seenPorts);assert.equal(p.callback,callback);return {state:'ready',code:null};}};
  const workflowController={startWorkflowController:async(input,p)=>{calls.push('controller');assert.equal(p,seenPorts);assert.equal(input.runtime,frozen);assert.equal(input.unknown,prepared.unknown);assert.equal(p.runtime,raw);return {state:'started'};}};
  assert.equal(await runPdd(['workflow',mode,...(mode==='run'?['small-change','17']:[id])],{...deps,workflowModels,workflowHerdrBoot,workflowController,workflowRunner:{prepareWorkflow:prepare,resumeWorkflow:prepare},ports:{runtime:raw,callback}}),0);
  assert.deepEqual(calls,['prepare','ready','controller']);assert.equal(deps.stdout.text,`Started workflow ${id}.\n`);
 }
});
test('failed Herdr startup gives one actionable error and never launches a controller',async()=>{
 for(const mode of ['run','resume']){
  const deps=io();let probes=0;const message='Herdr is not running and could not be started: permission denied.';
  assert.equal(await runPdd(['workflow',mode,...(mode==='run'?['small-change','17']:[id])],{...deps,workflowModels,workflowRunner:{prepareWorkflow:async()=>({state:'prepared',runId:id}),resumeWorkflow:async()=>({state:'prepared',runId:id})},workflowHerdrBoot:{ensureDefaultHerdr:async()=>{probes++;return {state:'unavailable',code:'herdr_not_running',message};}},workflowController:{startWorkflowController:()=>assert.fail('No launch on unavailable server')}}),1);
  assert.equal(probes,1);assert.equal(deps.stderr.text,message+'\n');assert.equal(deps.stdout.text,'');
 }
});
test('duplicate and allocation refusal return unchanged without Herdr startup',async()=>{
 for(const result of [{state:'waiting',exitCode:2,message:'Resume the existing original run.'},{state:'recovery_required',exitCode:1,message:'Repository identity unavailable.'}]){
  const deps=io();assert.equal(await runPdd(['workflow','resume',id],{...deps,workflowRunner:{resumeWorkflow:async()=>result},workflowHerdrBoot:{ensureDefaultHerdr:()=>assert.fail('No startup')},workflowController:{startWorkflowController:()=>assert.fail('No launch')}}),result.exitCode);
  assert.equal(deps.stdout.text,result.message+'\n');assert.equal(deps.stderr.text,'');
 }
});
test('thrown startup failure cannot leak error details or retry workflow owners',async()=>{
 const deps=io();let preparations=0,boots=0;
 assert.equal(await runPdd(['workflow','resume',id],{...deps,workflowRunner:{resumeWorkflow:async()=>{preparations++;return {state:'prepared',runId:id};}},workflowHerdrBoot:{ensureDefaultHerdr:async()=>{boots++;throw Error('sk-synthetic-secret /private/socket');}},workflowController:{startWorkflowController:()=>assert.fail('No launch')}}),1);
 assert.equal(preparations,1);assert.equal(boots,1);assert.match(deps.stderr.text,/Herdr is not running and could not be started/);assert.doesNotMatch(deps.stderr.text,/synthetic-secret|private|launch unconfirmed/);
});

test('real readiness probe does not manufacture strict controller capability',async t=>{
 const {mkdtemp,mkdir,writeFile,rm}=await import('node:fs/promises');
 const {join}=await import('node:path');const {tmpdir}=await import('node:os');
 const {readHerdrTrace}=await import('../../src/herdr-trace.mjs');
 const home=await mkdtemp(join(tmpdir(),'pdd-ready-not-proof-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const bin=join(home,'bin');await mkdir(bin,{mode:0o700});await writeFile(join(bin,'herdr'),'synthetic executable',{mode:0o700});
 const deps=io();let commands=0;
 assert.equal(await runPdd(['workflow','resume',id],{...deps,home,workflowRunner:{resumeWorkflow:async()=>({state:'prepared',runId:id,root:'/synthetic/root',runDir:'/synthetic/run',workflow:'small-change',issueNumber:17,runtime:{node:'/synthetic/node',bin:'/synthetic/pdd'}})},ports:{herdr:{supportsProcessIdentity:async()=>false},env:{PATH:bin,PDD_TRACE:'herdr'},platform:'linux',execFile:async(file,args)=>{commands++;assert.equal(file,join(bin,'herdr'));assert.deepEqual(args,['--session','default','workspace','list']);return {stdout:JSON.stringify({result:{workspaces:[]}}),code:0};}}}),1);
 assert.equal(commands,1);const rows=readHerdrTrace({home});assert.equal(rows.at(-1).operation,'controller.start');assert.equal(rows.at(-1).payload.state,'refused');assert.equal(rows.at(-1).payload.code,'unsupported');
 assert.equal(rows.some(r=>r.operation==='server.start'||r.operation==='pane.run'||r.operation==='tab.create'),false);
 assert.doesNotMatch(deps.stdout.text,/Started workflow/);
});
