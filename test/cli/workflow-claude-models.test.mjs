import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createLocalWorkflowModelPorts,listWorkflowModels,resolveWorkflowModel,resolveWorkflowLaunchModel} from '../../src/workflow-models.mjs';
import {nativeArgs} from '../../src/native-flags.mjs';
const input={machineId:'local-synthetic',agent:'claude'};
const rows=()=>[
 {value:'default',resolvedModel:'synthetic-native-7',displayName:'Native default',supportsEffort:true,supportedEffortLevels:['gentle','thorough']},
 {value:'synthetic-fast',displayName:'Fast',supportsEffort:true,supportedEffortLevels:['brief']},
 {value:'synthetic-fixed',displayName:'Fixed',supportsEffort:false},
 {value:'synthetic-hidden',displayName:'Hidden',supportsEffort:false,hidden:true}
];
async function fixture(t,{models=rows(),mode='ok',version='2.1.310 (Claude Code)',bodyVersion='2.1.310'}={}){
 const home=await fs.mkdtemp(join(tmpdir(),'pdd-claude-models-'));t.after(()=>fs.rm(home,{recursive:true,force:true}));
 const cwd=join(home,'project'),log=join(home,'requests.jsonl'),config=join(home,'fixture.json'),executable=join(home,'synthetic-claude.mjs');
 await fs.mkdir(cwd);await fs.writeFile(config,JSON.stringify({models,mode,version,bodyVersion}));
 await fs.writeFile(executable,`#!${process.execPath}
// SYNTHETIC OFFLINE capability process. No native account or model call.
import {readFileSync,appendFileSync} from 'node:fs';
import {createInterface} from 'node:readline';
const c=JSON.parse(readFileSync(process.env.FIXTURE_CONFIG,'utf8'));
const log=value=>appendFileSync(process.env.FIXTURE_LOG,JSON.stringify(value)+'\\n');
const argv=process.argv.slice(2);log({argv,cwd:process.cwd(),home:process.env.HOME,pid:process.pid});
if(argv.length===1&&argv[0]==='--version'){
 if(c.mode==='version-timeout'){process.on('SIGTERM',()=>{});setInterval(()=>{},1000);}
 else {console.log(c.version);process.exit(0);}
}else{
 createInterface({input:process.stdin}).on('line',line=>{
  const r=JSON.parse(line);log({request:r});
  if(c.mode==='exit'){process.exit(23);return;}
  if(c.mode==='timeout')return;
  if(c.mode==='oversize'){process.stdout.write('x'.repeat(2*1024*1024+1));return;}
  if(c.mode==='malformed'){console.log('{not json');return;}
  if(c.mode==='permission'){console.log(JSON.stringify({type:'control_request',request_id:'permission',request:{subtype:'can_use_tool'}}));return;}
  const reply={type:'control_response',response:{subtype:c.mode==='error'?'error':'success',request_id:c.mode==='wrong-id'?'wrong':r.request_id,response:{claude_code_version:c.bodyVersion,models:c.models,account:{secret:'PRIVATE-ACCOUNT-SENTINEL'},description:'PRIVATE-DESCRIPTION-SENTINEL'}}};
  console.error('PRIVATE-STDERR-SENTINEL');
  console.log(JSON.stringify(reply));
 });
}
`,{mode:0o700});
 const env={PATH:home,HOME:home,FIXTURE_CONFIG:config,FIXTURE_LOG:log};
 const options={machineId:input.machineId,cwd,claudeExecutable:executable,env,timeoutMs:1500};
 return {home,cwd,log,config,executable,env,options,ports:createLocalWorkflowModelPorts(options),
  events:async()=>{try{return (await fs.readFile(log,'utf8')).trim().split('\n').map(JSON.parse);}catch(e){if(e.code==='ENOENT')return [];throw e;}}};
}
async function assertStopped(pid){
 for(let i=0;i<100;i++){
  try{process.kill(pid,0);}catch(e){assert.equal(e.code,'ESRCH');return;}
  await new Promise(r=>setTimeout(r,5));
 }
 assert.fail('owned capability subprocess remained alive');
}
test('Claude native discovery performs only version and one initialize, projects per-model efforts and preserves cwd/home',async t=>{
 const f=await fixture(t);assert.deepEqual(await f.events(),[]);
 const result=await listWorkflowModels(input,f.ports);assert.equal(result.state,'listed');
 assert.equal(result.catalog.cliVersion,'2.1.310');assert.match(result.catalog.revision,/^[a-f0-9]{64}$/);
 assert.deepEqual(result.catalog.models,[
  {id:'default',label:'Native default',efforts:['gentle','thorough'],defaultEffort:null},
  {id:'synthetic-fast',label:'Fast',efforts:['brief'],defaultEffort:null},
  {id:'synthetic-fixed',label:'Fixed',efforts:[],defaultEffort:null}
 ]);assert.deepEqual(result.catalog.defaults,{model:'default',effort:null});
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE|account|description/);
 const events=await f.events();assert.equal(events.length,3);assert.deepEqual(events[0].argv,['--version']);
 assert.deepEqual(events[1].argv,['--print','--verbose','--input-format','stream-json','--output-format','stream-json','--no-session-persistence','--safe-mode','--permission-mode','dontAsk','--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}']);
 assert.equal(events[1].cwd,f.cwd);assert.equal(events[1].home,f.home);
 assert.match(events[2].request.request_id,/^[a-f0-9-]{36}$/);
 assert.deepEqual(events[2].request,{type:'control_request',request_id:events[2].request.request_id,request:{subtype:'initialize',hooks:{}}});
 await assertStopped(events[1].pid);
});
test('Claude omitted effort uses native flag omission; explicit and per-model choices remain strict',async t=>{
 const f=await fixture(t);
 const selected=await resolveWorkflowModel(input,f.ports);assert.equal(selected.selection.effort,null);
 assert.deepEqual(nativeArgs({agent:'claude',cwd:f.cwd,selection:selected.selection}),['--dangerously-skip-permissions','--model','default']);
 const explicit=await resolveWorkflowModel({...input,selection:{model:'synthetic-fast',effort:'brief'}},f.ports);
 assert.equal(explicit.state,'selected');assert.deepEqual(nativeArgs({agent:'claude',cwd:f.cwd,selection:explicit.selection}),['--dangerously-skip-permissions','--model','synthetic-fast','--effort','brief']);
 for(const selection of [{model:'synthetic-fast',effort:'thorough'},{model:'synthetic-hidden'},{model:'unobserved'},{model:'synthetic-fixed',effort:'brief'},{effort:'high'}]){
  assert.deepEqual(await resolveWorkflowModel({...input,selection},f.ports),{state:'refused',code:'bad_args'});
 }
});
test('Claude Settings defaults and model override use only native supported effort values',async t=>{
 const f=await fixture(t),ports=createLocalWorkflowModelPorts({...f.options,settings:{read:async()=>({model:'default',effort:'thorough'})}});
 assert.equal((await resolveWorkflowModel(input,ports)).selection.effort,'thorough');
 const fast=await resolveWorkflowModel({...input,selection:{model:'synthetic-fast'}},ports);
 assert.equal(fast.selection.effort,null);assert.equal(fast.selection.model,'synthetic-fast');
 const invalid=createLocalWorkflowModelPorts({...f.options,settings:{read:async()=>({model:'default',effort:'guessed'})}});
 assert.deepEqual(await resolveWorkflowLaunchModel(input,invalid),{state:'refused',code:'catalog_unavailable'});
});
test('Claude explicit native default evidence works without concrete default alias guesses',async t=>{
 const models=rows().slice(1);models[0].isDefault=true;models[0].defaultEffort='brief';
 const f=await fixture(t,{models});const r=await listWorkflowModels(input,f.ports);
 assert.equal(r.state,'listed');assert.deepEqual(r.catalog.defaults,{model:'synthetic-fast',effort:'brief'});
});
for(const [name,change] of [
 ['duplicate model',m=>m.push(m[0])],['missing effort evidence',m=>delete m[0].supportedEffortLevels],
 ['duplicate efforts',m=>m[0].supportedEffortLevels.push('gentle')],['unsupported default effort',m=>m[0].defaultEffort='guessed'],
 ['false effort flag with levels',m=>m[0].supportsEffort=false],['missing effort flag',m=>delete m[0].supportsEffort],
 ['invalid hidden',m=>m[0].hidden='false'],['ambiguous default',m=>m[1].isDefault=true],
 ['missing default',m=>m[0].value='synthetic-other'],['invalid default flag',m=>m[0].isDefault='yes'],
 ['hidden default',m=>m[0].hidden=true],['empty models',m=>m.splice(0)],
 ['malformed label',m=>m[0].displayName='bad\nlabel']
])test(`Claude catalog refuses ${name} without guessing`,async t=>{
 const models=rows();change(models);const f=await fixture(t,{models});
 assert.deepEqual(await listWorkflowModels(input,f.ports),{state:'refused',code:'catalog_unavailable'});
});
for(const mode of ['wrong-id','error','malformed','permission','exit','timeout','oversize','version-timeout'])test(`Claude discovery bounds and refuses ${mode}`,async t=>{
 const f=await fixture(t,{mode});const start=performance.now();
 const ports=createLocalWorkflowModelPorts({...f.options,timeoutMs:300});
 assert.deepEqual(await listWorkflowModels(input,ports),{state:'refused',code:'catalog_unavailable'});
 assert.ok(performance.now()-start<2500);const events=await f.events();
 assert.ok(events.filter(e=>e.request).length<=1);
 for(const event of events.filter(e=>e.pid))await assertStopped(event.pid);
});
test('Claude missing executable, non-Claude version, mismatched reply version and wrong target refuse finitely',async t=>{
 const f=await fixture(t,{version:'codex-cli 2.1.310'});
 assert.deepEqual(await listWorkflowModels(input,f.ports),{state:'refused',code:'catalog_unavailable'});
 assert.equal((await f.events()).length,1);
 const g=await fixture(t,{bodyVersion:'2.1.309'});assert.equal((await listWorkflowModels(input,g.ports)).code,'catalog_unavailable');
 const absent=createLocalWorkflowModelPorts({...g.options,claudeExecutable:join(g.home,'missing')});
 assert.equal((await listWorkflowModels(input,absent)).code,'catalog_unavailable');
 const h=await fixture(t);assert.equal((await listWorkflowModels({...input,machineId:'foreign'},h.ports)).code,'catalog_unavailable');assert.deepEqual(await h.events(),[]);
});
test('Claude capability revision binds resolved alias but excludes unrelated account data',async t=>{
 const f=await fixture(t),a=await listWorkflowModels(input,f.ports);
 const models=rows();models[0].resolvedModel='synthetic-native-8';
 await fs.writeFile(f.config,JSON.stringify({models,mode:'ok',version:'2.1.310 (Claude Code)',bodyVersion:'2.1.310'}));
 const b=await listWorkflowModels(input,f.ports);assert.equal(b.state,'listed');assert.notEqual(a.catalog.revision,b.catalog.revision);assert.deepEqual(a.catalog.models,b.catalog.models);
});
test('Claude unavailable discovery keeps Rule10 native omission and frozen choice without reading changed Settings',async t=>{
 const f=await fixture(t);const frozen=(await resolveWorkflowLaunchModel({...input,selection:{model:'synthetic-fast',effort:'brief'}},f.ports)).selection;
 const noCatalog=createLocalWorkflowModelPorts({...f.options,claudeExecutable:join(f.home,'absent')});
 const fallback=await resolveWorkflowLaunchModel(input,noCatalog);assert.equal(fallback.selection.source,'native-defaults');
 assert.deepEqual(nativeArgs({agent:'claude',cwd:f.cwd,selection:fallback.selection}),['--dangerously-skip-permissions']);
 noCatalog.toolDefaults.read=()=>assert.fail('frozen recovery must not read Settings');
 assert.deepEqual((await resolveWorkflowLaunchModel({...input,frozenSelection:frozen},noCatalog)).selection,frozen);
 const models=rows();models[1].supportedEffortLevels=['different'];
 await fs.writeFile(f.config,JSON.stringify({models,mode:'ok',version:'2.1.310 (Claude Code)',bodyVersion:'2.1.310'}));
 assert.deepEqual(await resolveWorkflowLaunchModel({...input,frozenSelection:frozen},f.ports),{state:'refused',code:'bad_args'});
});
