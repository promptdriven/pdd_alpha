import test from 'node:test';
const hostFixtureSkip = process.platform === 'darwin' && process.env.PDD_MACOS_INTEGRATION !== '1';
import assert from 'node:assert/strict';
import {runPdd} from '../../src/pdd-cli.mjs';
const capture=()=>({text:'',write(s){this.text+=s;}});
const io=()=>({stdout:capture(),stderr:capture()});
function setup(calls){return {
 herdrRuntime:{recordHerdrRuntime:async({runtime,herdr})=>({...runtime,herdr})},
 versions:{resolveRuntime:async()=>{calls.push('runtime');return {releaseId:'synthetic'};}},
 lock:{withUpdateLock:async(input,op)=>{calls.push('lock');return op({});}},
 launcher:{installLauncherSupport:async()=>{calls.push('support');return {code:null};},provisionRecoveryService:async()=>{calls.push('recovery');return {code:null};}}
};}
test('public setup verifies Herdr PATH before recovery and optional client with complete ports',async()=>{
 const calls=[],deps=io(),runtime={kept:true},env={PATH:'/synthetic/bin'},callback=()=>{};
 const workflowHerdrBoot={ensureHerdrInstalled:async p=>{
  calls.push('herdr');assert.equal(p.home,'/synthetic/home');assert.equal(p.runtime,runtime);assert.equal(p.env,env);assert.equal(p.unknownCallback,callback);
  return {state:'ready',code:null,message:null,installed:true,executable:'/synthetic/bin/herdr'};
 }};
 assert.equal(await runPdd(['setup','--no-phone'],{...deps,home:'/synthetic/home',workflowHerdrBoot,setupModules:setup(calls),ports:{env,runtime,unknownCallback:callback},clientAdapter:{runSetupCommand:async argv=>{calls.push('client');assert.deepEqual(argv,['--no-phone']);return 0;}}}),0);
 assert.deepEqual(calls,['runtime','herdr','lock','support','recovery','client']);assert.equal(deps.stderr.text,'');
});
test('missing or off-PATH Herdr fails public setup without provisioning or optional client',async()=>{
 for(const code of ['herdr_not_installed','herdr_install_failed','herdr_not_on_path']){
  const calls=[],deps=io();let attempts=0;const message='Herdr is unavailable. Add its installation directory to PATH and rerun pdd setup.';
  assert.equal(await runPdd(['setup'],{...deps,workflowHerdrBoot:{ensureHerdrInstalled:async()=>{attempts++;return {state:'unavailable',code,message,installed:true};}},setupModules:setup(calls),clientAdapter:{runSetupCommand:()=>assert.fail('No optional continuation')}}),1);
  assert.equal(attempts,1);assert.deepEqual(calls,['runtime']);assert.equal(deps.stdout.text,'');assert.equal(deps.stderr.text,message+'\n');
 }
});
test('setup never treats installer exit or thrown details as readiness',async()=>{
 for(const mode of ['invalid','throw']){
  const calls=[],deps=io();let attempts=0;
  assert.equal(await runPdd(['setup'],{...deps,workflowHerdrBoot:{ensureHerdrInstalled:async()=>{attempts++;if(mode==='throw')throw Error('sk-synthetic-secret /private/path');return {state:'ready',code:0};}},setupModules:setup(calls)}),1);
  assert.equal(attempts,1);assert.deepEqual(calls,['runtime']);assert.match(deps.stderr.text,/Herdr installation or PATH could not be confirmed/);assert.doesNotMatch(deps.stderr.text,/synthetic-secret|private/);
 }
});
test('local discovery never invokes Herdr setup or startup',async()=>{
 for(const argv of [['--help'],['workflow','--help'],['--version']]){
  const deps=io();assert.equal(await runPdd(argv,{...deps,workflowHerdrBoot:{ensureHerdrInstalled:()=>assert.fail('No installation'),ensureDefaultHerdr:()=>assert.fail('No service')}}),0);
 }
});

test('public setup composes with real install helper and synthetic existing, installed and off-PATH executables',{skip:hostFixtureSkip},async t=>{
 const {mkdtemp,mkdir,writeFile,rm}=await import('node:fs/promises');
 const {join}=await import('node:path');const {tmpdir}=await import('node:os');
 const workflowHerdrBoot=await import('../../src/workflow-herdr-boot.mjs');
 const {createHash}=await import('node:crypto');const bytes=Buffer.from('synthetic executable');
 const release={tag_name:'current-stable',draft:false,prerelease:false,html_url:'https://github.com/herdrdev/herdr/releases/tag/current-stable',assets:[{name:'herdr-linux-x86_64',size:bytes.length,digest:'sha256:'+createHash('sha256').update(bytes).digest('hex'),browser_download_url:'https://github.com/herdrdev/herdr/releases/download/current-stable/herdr-linux-x86_64'}]};
 for(const mode of ['existing','install','off-path']){
  const home=await mkdtemp(join(tmpdir(),'pdd-setup-herdr-'));t.after(()=>rm(home,{recursive:true,force:true}));
  const bin=join(home,'bin');await mkdir(bin,{mode:0o700});
  if(mode==='existing')await writeFile(join(bin,'herdr'),'synthetic executable',{mode:0o700});
  const calls=[],commands=[],deps=io();const env={PATH:mode==='off-path'?'/synthetic/missing':bin,HOME:home};
  const code=await runPdd(['setup'],{...deps,home,workflowHerdrBoot,setupModules:setup(calls),ports:{env,platform:'linux',arch:'x64',execFile:async(file,args,options)=>{
   commands.push([file,args]);assert.equal(options.shell,false);
   if(file==='curl'){
    if(args.at(-1)==='https://api.github.com/repos/herdrdev/herdr/releases/latest')return {stdout:JSON.stringify(release),code:0};
    assert.equal(args.at(-1),release.assets[0].browser_download_url);await writeFile(args[args.indexOf('--output')+1],bytes,{mode:0o600});return {stdout:'',code:0};
   }
   assert.notEqual(file,'/bin/sh');assert.deepEqual(args,['--help']);return {stdout:'Herdr usage: server workspace\n',code:0};
  }}});
  if(mode==='off-path'){
   // Installation outside the invocation PATH cannot count as setup success.
   assert.equal(code,1);assert.deepEqual(calls,['runtime']);assert.match(deps.stderr.text,/Herdr is installed but is not on PATH/);
  }else{
   assert.equal(code,0,deps.stderr.text);assert.deepEqual(calls,['runtime','lock','support','recovery']);
   assert.equal(commands.filter(([file])=>file==='curl').length,mode==='install'?2:0);
   assert.equal(commands.filter(([file])=>file==='/bin/sh').length,0);
  }
  assert.equal(commands.some(([file,args])=>file==='systemd-run'||args.includes('server')),false);
 }
});

test('unverified PDD runtime cannot trigger Herdr installation',async()=>{
 const deps=io();assert.equal(await runPdd(['setup'],{...deps,workflowHerdrBoot:{ensureHerdrInstalled:()=>assert.fail('No installation before verified runtime')},setupModules:{versions:{resolveRuntime:async()=>{throw Error('unverified');}},lock:{withUpdateLock:()=>assert.fail('No lock')},launcher:{}}}),1);
 assert.match(deps.stderr.text,/verified PDD installer/);
});

test('C19 setup binds persistent Herdr under lease before recovery and requires readiness before optional client',async()=>{
 const calls=[],deps=io(),modules=setup(calls),runtime={herdr:'/synthetic/bin/herdr'};
 modules.herdrService={provisionHerdrService:async input=>{calls.push('persistent');assert.equal(input.runtime.herdr,runtime.herdr);assert.ok(input.lease);return {code:null};}};
 const workflowHerdrBoot={ensureHerdrInstalled:async()=>({state:'ready',code:null,executable:runtime.herdr}),ensureDefaultHerdr:async p=>{calls.push('ready');assert.equal(p.runtime.herdr,runtime.herdr);return {state:'ready',code:null};}};
 assert.equal(await runPdd(['setup'],{...deps,setupModules:modules,workflowHerdrBoot,clientAdapter:{runSetupCommand:async()=>{calls.push('client');return 0;}}}),0);
 assert.deepEqual(calls,['runtime','lock','persistent','support','recovery','ready','client']);
});
test('C19 service enablement failure stops recovery and optional client with actionable service message',async()=>{
 const calls=[],deps=io(),modules=setup(calls);
 modules.herdrService={provisionHerdrService:async()=>{calls.push('persistent');return {code:'herdr_service_unavailable',message:'Herdr user service could not be verified. Inspect its definition and user-manager permissions, then rerun pdd setup.'};}};
 assert.equal(await runPdd(['setup'],{...deps,setupModules:modules,workflowHerdrBoot:{ensureHerdrInstalled:async()=>({state:'ready',code:null,executable:'/synthetic/herdr'}),ensureDefaultHerdr:()=>assert.fail('no startup')},clientAdapter:{runSetupCommand:()=>assert.fail('no continuation')}}),1);
 assert.deepEqual(calls,['runtime','lock','persistent']);assert.match(deps.stderr.text,/Herdr user service.*rerun pdd setup/);assert.equal(deps.stdout.text,'');
});
test('C19 persistent definition is not setup success when fresh transport readiness fails',async()=>{
 const calls=[],deps=io(),modules=setup(calls);modules.herdrService={provisionHerdrService:async()=>({code:null})};
 assert.equal(await runPdd(['setup'],{...deps,setupModules:modules,workflowHerdrBoot:{ensureHerdrInstalled:async()=>({state:'ready',code:null,executable:'/synthetic/herdr'}),ensureDefaultHerdr:async()=>({state:'unavailable',code:'herdr_not_running',message:'Herdr is not running and could not be started: startup timed out.'})},clientAdapter:{runSetupCommand:()=>assert.fail('no continuation')}}),1);
 assert.match(deps.stderr.text,/Herdr is not running/);assert.equal(deps.stdout.text,'');
});
