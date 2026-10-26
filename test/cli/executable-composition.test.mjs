import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,cpSync,readdirSync,symlinkSync,existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {execFileSync,spawnSync} from 'node:child_process';
import {runPdd} from '../../src/pdd-cli.mjs';
import {createLocalWorkflowModelPorts,listWorkflowModels,resolveWorkflowModel} from '../../src/workflow-models.mjs';
import {createLocalWorkflowProjectPorts,listWorkflowProjects,resolveWorkflowProject} from '../../src/workflow-projects.mjs';
const root=dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const capture=()=>({text:'',write(s){this.text+=s;}});
function fixture(t) {
  const temp=mkdtempSync(join(tmpdir(),'pdd-executable-'));t.after(()=>rmSync(temp,{recursive:true,force:true}));
  const tools=join(temp,'tools'),cwd=join(temp,'demo'),home=join(temp,'home'),log=join(temp,'protocol.jsonl');
  for(const dir of [tools,cwd,home])mkdirSync(dir);
  const executable=join(tools,'codex');
  writeFileSync(executable,`#!${process.execPath}
import {createInterface} from 'node:readline';
import {appendFileSync} from 'node:fs';
if(process.argv[2]==='--version'){console.log('codex-cli 1.2.3');process.exit(0);}
if(process.argv.slice(2).join(' ')!=='app-server')process.exit(9);
const mode=process.env.PROBE_MODE;
createInterface({input:process.stdin}).on('line',line=>{
 const r=JSON.parse(line);appendFileSync(process.env.PROBE_LOG,JSON.stringify({method:r.method,params:r.params,cwd:process.cwd()})+'\\n');
 if(!['initialize','initialized','config/read','model/list'].includes(r.method))process.exit(8);
 if(r.method==='initialized')return;
 if(mode==='timeout')return;
 let result={};
 if(r.method==='config/read')result={config:{model:mode==='bad-default'?'unobserved':null,model_reasoning_effort:null},origins:{}};
 if(r.method==='model/list'){
  const row=(model,hidden,isDefault)=>({id:'picker-'+model,model,displayName:model,hidden,isDefault,defaultReasoningEffort:'deep',supportedReasoningEfforts:[{reasoningEffort:'quick'},{reasoningEffort:'deep'}]});
  result=r.params.cursor?{data:[row('synthetic-hidden',true,false)],nextCursor:null}:{data:[row('synthetic-native',false,true)],nextCursor:'second'};
 }
 console.log(JSON.stringify({id:r.id,result}));
});
`,{mode:0o755});
  const herdrLog=join(temp,'herdr-probes.jsonl'),startLog=join(temp,'herdr-starts');
  writeFileSync(join(tools,'herdr'),`#!/bin/sh
if [ "$*" != "--session default workspace list" ]; then exit 91; fi
printf '%s\\n' probe >> "$PROBE_HERDR_LOG"
printf '%s\\n' '{"result":{"workspaces":[]}}'
`,{mode:0o755});
  writeFileSync(join(tools,'systemd-run'),'#!/bin/sh\nprintf start >> "$PROBE_HERDR_STARTS"\nexit 92\n',{mode:0o755});
  const env={...process.env,PATH:tools+':'+process.env.PATH,HOME:home,PROBE_LOG:log,PROBE_HERDR_LOG:herdrLog,PROBE_HERDR_STARTS:startLog};
  return {temp,tools,cwd,home,log,env,executable,herdrLog,startLog};
}
test('installed Codex adapter pages native models and uses observed defaults and Settings without guessing',async t=>{
  const f=fixture(t),ports=createLocalWorkflowModelPorts({machineId:'local',cwd:f.cwd,executable:f.executable,env:f.env});
  const result=await listWorkflowModels({machineId:'local',agent:'codex'},ports);
  assert.equal(result.state,'listed');assert.equal(result.catalog.cliVersion,'1.2.3');
  assert.deepEqual(result.catalog.defaults,{model:'synthetic-native',effort:'deep'});
  assert.deepEqual(result.catalog.models.map(m=>m.id),['synthetic-native']);
  assert.match(result.catalog.revision,/^[a-f0-9]{64}$/);
  const methods=readFileSync(f.log,'utf8').trim().split('\n').map(l=>JSON.parse(l).method);
  assert.deepEqual(methods,['initialize','initialized','config/read','model/list','model/list']);
  const configured=createLocalWorkflowModelPorts({machineId:'local',cwd:f.cwd,executable:f.executable,env:f.env,settings:{read:async()=>({model:'synthetic-native',effort:'quick'})}});
  assert.equal((await resolveWorkflowModel({machineId:'local',agent:'codex'},configured)).selection.effort,'quick');
  assert.equal((await listWorkflowModels({machineId:'other',agent:'codex'},ports)).code,'catalog_unavailable');
  assert.equal((await listWorkflowModels({machineId:'local',agent:'claude'},ports)).code,'catalog_unavailable');
});
test('unobserved defaults, probe timeout and unsupported overrides refuse before preparation',async t=>{
  const f=fixture(t);
  for(const mode of ['bad-default','timeout']){
    const ports=createLocalWorkflowModelPorts({machineId:'local',cwd:f.cwd,executable:f.executable,env:{...f.env,PROBE_MODE:mode},timeoutMs:300});
    assert.equal((await listWorkflowModels({machineId:'local',agent:'codex'},ports)).code,'catalog_unavailable');
  }
  const io={stdout:capture(),stderr:capture()};
  assert.equal(await runPdd(['workflow','run','feature','7','--model','synthetic-hidden'],{...io,cwd:f.cwd,localModelOptions:{executable:f.executable,env:f.env},workflowRunner:{prepareWorkflow:()=>assert.fail('No preparation')}}),2);
});
test('actual bin composes default local model and project adapters for workflow preparation offline',async t=>{
  const f=fixture(t),pkg=join(f.temp,'alpha');mkdirSync(pkg);mkdirSync(join(pkg,'src'));
  // Public top-level modules only. Controlled runner/controller replace effects
  // in this temporary executable fixture, leaving discovery and CLI unchanged.
  for(const name of readdirSync(join(root,'src')).filter(n=>n.endsWith('.mjs')))cpSync(join(root,'src',name),join(pkg,'src',name));
  for(const name of ['bin','docs','skills','.pdd','package.json'])cpSync(join(root,name),join(pkg,name),{recursive:true});
  writeFileSync(join(pkg,'src/workflow-runner.mjs'),`import {writeFileSync} from 'node:fs';export async function prepareWorkflow(input,ports){
    if(input.machineId!==input.launchSelection.machineId||typeof ports.nativeCatalog?.read!=='function'||typeof ports.toolDefaults?.read!=='function')throw Error();
    writeFileSync(process.env.PREPARED,JSON.stringify(input));return {state:'prepared',runId:'synthetic-run'};
  }`);
  writeFileSync(join(pkg,'src/workflow-controller.mjs'),`export const startWorkflowController=async()=>({state:'started'});`);
  writeFileSync(join(pkg,'src/workflow-run-records.mjs'),`export const readRunIndex=async()=>({entries:[],dropped:0});`);
  const prepared=join(f.temp,'prepared.json');
  const result=spawnSync(process.execPath,[join(pkg,'bin/pdd.mjs'),'workflow','run','feature','7','--project','demo'],{cwd:f.cwd,env:{...f.env,PREPARED:prepared},encoding:'utf8',timeout:5000});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/Started workflow synthetic-run/);
  assert.equal(readFileSync(f.herdrLog,'utf8').trim().split('\n').length,1);assert.equal(existsSync(f.startLog),false);
  const input=JSON.parse(readFileSync(prepared,'utf8'));
  assert.equal(input.machineId,'local');assert.equal(input.cwd,f.cwd);assert.deepEqual(input.project,{id:`local:${f.cwd}`,name:'demo'});
  assert.equal(input.launchSelection.model,'synthetic-native');assert.equal(input.launchSelection.effort,'deep');assert.equal(input.launchSelection.source,'defaults');
  const catalog=spawnSync(process.execPath,[join(pkg,'bin/pdd.mjs'),'models','--agent','codex'],{cwd:f.cwd,env:f.env,encoding:'utf8',timeout:5000});
  assert.equal(catalog.status,0,catalog.stderr);assert.match(catalog.stdout,/synthetic-native/);assert.doesNotMatch(catalog.stdout,/synthetic-hidden/);
});
test('project factory composes cwd, configured scans and run roots with canonical Git identity',async t=>{
  const f=fixture(t),scan=join(f.temp,'projects'),other=join(scan,'other');mkdirSync(scan);mkdirSync(other);
  execFileSync('git',['init','--quiet',other]);
  execFileSync('git',['-C',other,'-c','user.name=Synthetic','-c','user.email=synthetic@example.invalid','commit','--quiet','--allow-empty','-m','fixture']);
  execFileSync('git',['-C',other,'remote','add','origin','git@example.invalid:synthetic/project.git']);
  const ports=createLocalWorkflowProjectPorts({machineId:'local',cwd:f.cwd,home:f.home,settings:{readProjectRoots:async()=>[scan]},readRunIndex:async()=>({entries:[{root:other,startedAt:500}]})});
  const result=await listWorkflowProjects({machineId:'local'},ports);
  assert.equal(result.projects.length,2);const project=result.projects.find(p=>p.name==='other');
  assert.equal(project.repository.url,'https://example.invalid/synthetic/project');assert.match(project.repository.ref,/^[a-f0-9]{40}$/);
  assert.deepEqual(project.sources,['runs','usualPlaces']);assert.equal(project.lastUsedAt,500);
  assert.equal((await resolveWorkflowProject({machineId:'local',query:'other'},ports)).state,'selected');
  rmSync(other,{recursive:true});symlinkSync(f.cwd,other);
  assert.equal(await ports.checkLocal({id:project.id,root:other,machineId:'local'}),false);
  assert.deepEqual((await listWorkflowProjects({machineId:'other'},ports)).projects,[]);
});
