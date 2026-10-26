import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {inspectHerdrVersion} from '../../src/workflow-herdr-version.mjs';
import {runDoctorCommand} from '../../src/doctor.mjs';
import {recordHerdrRuntime} from '../../src/workflow-herdr-executable.mjs';
import {withUpdateLock} from '../../src/update-lock.mjs';
const methods=['workspace.list','workspace.create','tab.create','pane.list','pane.process_info','pane.send_text','pane.send_keys','pane.read','agent.get','agent.prompt','server.live_handoff'];
const schema=()=>({schemas:{request:{oneOf:methods.map(method=>({properties:{method:{const:method}}}))}}});
async function fixture(t){
 const home=await fs.mkdtemp(join(tmpdir(),'pdd-herdr-features-'));t.after(()=>fs.rm(home,{recursive:true,force:true}));
 const binary=join(home,"Herdr '$ tool");await fs.writeFile(binary,'#!/bin/sh\nexit 97\n',{mode:0o700});
 const calls=[],status={client:{version:'0.9.1',protocol:22,binary,session:'default'},server:{running:true,status:'running',version:'0.9.1',protocol:22,session:'default',compatible:true,endpoint_compatible:true,capabilities:{live_handoff:true}}};
 const body={schema:schema(),help:'Usage: herdr pane run <PANE_ID> <COMMAND>...\n',workspace:{result:{workspaces:[]}}};
 const ports={home,herdrExecutable:binary,env:{PATH:'',HOME:home},execFile:async(file,args,options)=>{
  calls.push({file,args,options});assert.equal(file,binary);assert.equal(options.shell,false);assert.equal(options.cwd,home);assert.ok(options.timeout>0&&options.timeout<=5000);
  if(args.join(' ')==='--session default status --json')return {stdout:JSON.stringify(status)};
  if(args.join(' ')==='api schema --json')return {stdout:JSON.stringify(body.schema)};
  if(args.join(' ')==='pane run --help')return {stdout:body.help};
  if(args.join(' ')==='--session default workspace list')return {stdout:JSON.stringify(body.workspace)};
  assert.fail('effectful or unexpected command: '+JSON.stringify(args));
 }};
 return {home,binary,calls,status,body,ports};
}
test('REUSE18 features pass on older, newer, development and absent version labels without protocol pinning',async t=>{
 const f=await fixture(t);
 for(const [client,server,protocol] of [['0.1.0','0.1.0',1],['999.0.0','998.0.0',123],['nightly-dev','future+custom',999],[undefined,undefined,undefined]]){
  f.status.client.version=client;f.status.server.version=server;f.status.client.protocol=protocol;f.status.server.protocol=protocol;
  const r=await inspectHerdrVersion({},f.ports);assert.equal(r.state,'compatible');assert.equal(r.compatible,true);assert.equal(r.handoff,null);assert.equal(r.next,null);
 }
 assert.equal(f.calls.length,16);assert.ok(f.calls.every(c=>!c.args.includes('create')&&!c.args.includes('live-handoff')));
});
test('REUSE18 incompatible transport offers exact quoted live handoff only with both declarations',async t=>{
 const f=await fixture(t);f.status.server.compatible=false;
 const r=await inspectHerdrVersion({},f.ports);assert.equal(r.state,'incompatible');assert.equal(r.code,'herdr_incompatible');
 assert.deepEqual(r.handoff.args,['--session','default','server','live-handoff','--import-exe',f.binary]);assert.equal(r.handoff.executable,f.binary);
 assert.match(r.handoff.command,/'\\''/);assert.match(r.next,/without closing its panes/);assert.equal(f.calls.length,3);
 f.status.server.capabilities.live_handoff=false;assert.equal((await inspectHerdrVersion({},f.ports)).handoff,null);
 f.status.server.capabilities.live_handoff=true;f.body.schema.schemas.request.oneOf.pop();assert.equal((await inspectHerdrVersion({},f.ports)).handoff,null);
});
test('REUSE18 missing used method fails by feature name without inventing a version requirement',async t=>{
 const f=await fixture(t);f.body.schema.schemas.request.oneOf=f.body.schema.schemas.request.oneOf.filter(x=>x.properties.method.const!=='pane.process_info');
 const r=await inspectHerdrVersion({},f.ports);assert.equal(r.state,'incompatible');assert.deepEqual(r.missingFeatures,['pane.process_info']);assert.equal(r.handoff,null);
 assert.match(r.next,/publisher's latest/);assert.doesNotMatch(r.detail,/0\.9\.1|protocol 22/);assert.equal(f.calls.length,3);
});
test('REUSE18 pane run is a CLI feature and must have its usage, never a guessed socket method',async t=>{
 const f=await fixture(t);f.body.help='Usage: herdr pane\n';const r=await inspectHerdrVersion({},f.ports);
 assert.equal(r.state,'incompatible');assert.deepEqual(r.missingFeatures,['pane run CLI']);assert.equal(r.handoff,null);
});
test('REUSE18 explicit server absence stays absent, and does not start or read a workspace',async t=>{
 const f=await fixture(t);f.status.server={running:false,status:'not_running',session:'default'};
 const r=await inspectHerdrVersion({},f.ports);assert.equal(r.state,'absent');assert.equal(r.compatible,null);assert.equal(r.server,null);assert.equal(r.handoff,null);assert.equal(f.calls.length,3);
});
for(const [name,change] of [
 ['foreign client session',f=>f.status.client.session='other'],['foreign server session',f=>f.status.server.session='other'],
 ['unproved running flag',f=>delete f.status.server.running],['unknown compatibility',f=>delete f.status.server.compatible],
 ['contradictory running status',f=>f.status.server.status='not_running'],['invalid endpoint flag',f=>f.status.server.endpoint_compatible='true'],
 ['malformed schema',f=>f.body.schema={}],['malformed workspace reply',f=>f.body.workspace={result:{workspaces:null}}]
])test(`REUSE18 refuses ${name} without unsafe repair`,async t=>{
 const f=await fixture(t);change(f);const r=await inspectHerdrVersion({},f.ports);
 assert.equal(r.state,'unavailable');assert.equal(r.compatible,null);assert.equal(r.handoff,null);assert.equal(r.client,null);
});
test('REUSE18 reported foreign executable cannot choose a handoff target',async t=>{
 const f=await fixture(t),other=join(f.home,'other');await fs.writeFile(other,'#!/bin/sh\nexit 0\n',{mode:0o700});
 f.status.client.binary=other;f.status.server.compatible=false;
 assert.equal((await inspectHerdrVersion({},f.ports)).state,'unavailable');assert.equal(f.calls.length,1);
});
test('REUSE18 explicit and saved missing executable never use PATH fallback',async t=>{
 const f=await fixture(t),ports={...f.ports,runtime:{herdr:join(f.home,'missing')},env:{PATH:f.home}};
 assert.equal((await inspectHerdrVersion({},ports)).state,'unavailable');assert.equal(f.calls.length,0);
 await withUpdateLock({home:f.home},lease=>recordHerdrRuntime({home:f.home,runtime:{},herdr:f.binary,lease},f.ports));
 const saved={...f.ports};delete saved.herdrExecutable;
 assert.equal((await inspectHerdrVersion({},saved)).state,'compatible');
 await fs.unlink(f.binary);f.calls.length=0;
 assert.equal((await inspectHerdrVersion({},saved)).state,'unavailable');assert.equal(f.calls.length,0);
});
test('REUSE18 numeric incompatible exit can report status, but signal/timeout cannot grant handoff',async t=>{
 const f=await fixture(t);f.status.server.compatible=false;const original=f.ports.execFile;
 f.ports.execFile=async(file,args,o)=>{if(args.includes('status'))throw Object.assign(Error('PRIVATE'),{code:1,stdout:JSON.stringify(f.status)});return original(file,args,o);};
 assert.equal((await inspectHerdrVersion({},f.ports)).state,'incompatible');
 f.ports.execFile=async()=>{throw Object.assign(Error('PRIVATE'),{code:1,killed:true,stdout:JSON.stringify(f.status)});};
 const r=await inspectHerdrVersion({},f.ports);assert.equal(r.state,'unavailable');assert.doesNotMatch(JSON.stringify(r),/PRIVATE/);
});
test('REUSE18 late status/schema/workspace replies never pass beyond original budget',async t=>{
 for(const delayed of ['status','schema','list']){
  const f=await fixture(t),original=f.ports.execFile;
  f.ports.timeoutMs=30;f.ports.execFile=async(file,args,o)=>{if(args.includes(delayed))await new Promise(r=>setTimeout(r,50));return original(file,args,o);};
  assert.equal((await inspectHerdrVersion({},f.ports)).state,'unavailable');
 }
});
test('REUSE18 bounded malformed or oversized output remains finite and private',async t=>{
 const f=await fixture(t);
 for(const stdout of ['not json','x'.repeat(65537),JSON.stringify({error:{message:'PRIVATE'}})]){
  f.ports.execFile=async()=>({stdout});const r=await inspectHerdrVersion({},f.ports);assert.equal(r.state,'unavailable');assert.doesNotMatch(JSON.stringify(r),/PRIVATE|not json/);
 }
});
test('REUSE18 actual disposable executable and public doctor compose read-only capability queries',async t=>{
 const f=await fixture(t),log=join(f.home,'calls.jsonl'),data=join(f.home,'status.json');
 await fs.writeFile(data,JSON.stringify({status:f.status,schema:f.body.schema}));
 await fs.writeFile(f.binary,`#!${process.execPath}
import * as fs from 'node:fs';const d=JSON.parse(fs.readFileSync(process.env.FIXTURE_DATA,'utf8'));const a=process.argv.slice(2);fs.appendFileSync(process.env.FIXTURE_LOG,JSON.stringify(a)+'\\n');
if(a.join(' ')==='--session default status --json')console.log(JSON.stringify(d.status));
else if(a.join(' ')==='api schema --json')console.log(JSON.stringify(d.schema));
else if(a.join(' ')==='pane run --help')console.log('Usage: herdr pane run <PANE_ID> <COMMAND>...');
else if(a.join(' ')==='--session default workspace list')console.log(JSON.stringify({result:{workspaces:[]}}));
else process.exit(98);
`);
 const env={PATH:'',HOME:f.home,FIXTURE_DATA:data,FIXTURE_LOG:log};
 const actual=promisify(execFile),observed=[];const execute=async(file,args,options)=>{try{const r=await actual(file,args,options);observed.push({args,stdout:r.stdout});return r;}catch(e){observed.push({args,error:e.message,stderr:e.stderr});throw e;}};
 let output='';await runDoctorCommand(['--json'],{home:f.home,herdrExecutable:f.binary,env,execFile:execute,stdout:{write:s=>output+=s},stderr:{write:()=>{}}});
 const r=JSON.parse(output).checks.find(x=>x.id==='herdr-version');assert.equal(r.state,'pass',JSON.stringify(observed));
 const calls=(await fs.readFile(log,'utf8')).trim().split('\n').map(JSON.parse);assert.equal(calls.length,4);
 assert.deepEqual(calls.map(x=>x.join(' ')),['--session default status --json','api schema --json','pane run --help','--session default workspace list']);
 output='';assert.equal(await runDoctorCommand(['--check-only'],{home:f.home,herdrExecutable:f.binary,env,stdout:{write:s=>output+=s},stderr:{write:()=>{}}}),0);
 assert.match(output,/SKIP herdr-version/);assert.equal((await fs.readFile(log,'utf8')).trim().split('\n').length,4);
});
test('REUSE18 support report strips exact handoff paths and raw status metadata',async t=>{
 const f=await fixture(t);f.status.server.compatible=false;f.status.server.socket='PRIVATE';let output='';
 await runDoctorCommand(['--report'],{...f.ports,stdout:{write:s=>output+=s},stderr:{write:()=>{}}});
 assert.doesNotMatch(output,/PRIVATE|Herdr '\$ tool|--import-exe|live-handoff/);assert.ok(JSON.parse(output).checks.some(c=>c.state==='fail'));
});

test('REUSE18 report preserves public feature check identity and outcome without exposing repair details',async t=>{
 const f=await fixture(t);
 for(const scenario of ['compatible','incompatible','missing']){
  const compatible=scenario==='compatible';
  f.status.server.compatible=compatible;let output='';
  const exit=await runDoctorCommand(['--report'],{...f.ports,...(scenario==='missing'?{runtime:{herdr:join(f.home,'missing')}}:{}),stdout:{write:s=>output+=s},stderr:{write:()=>{}}});
  const report=JSON.parse(output),rows=report.checks.filter(c=>c.id==='herdr-version');
  assert.equal(rows.length,1);assert.equal(rows[0].state,compatible?'pass':'fail');
  assert.equal(rows[0].detail,compatible?'Local check passed.':'Local check failed.');
  assert.equal(rows[0].next,compatible?null:'Inspect this check locally with pdd doctor.');
  assert.equal(report.ok,false);assert.equal(exit,1); // Separate absent service remains failed.
  assert.doesNotMatch(output,/--import-exe|live-handoff|Herdr '\$ tool/);
 }
});
