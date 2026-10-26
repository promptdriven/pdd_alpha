import test from 'node:test';
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

test('public setup composes with real install helper and synthetic existing, installed and off-PATH executables',async t=>{
 const {mkdtemp,mkdir,writeFile,rm}=await import('node:fs/promises');
 const {join}=await import('node:path');const {tmpdir}=await import('node:os');
 const workflowHerdrBoot=await import('../../src/workflow-herdr-boot.mjs');
 for(const mode of ['existing','install','off-path']){
  const home=await mkdtemp(join(tmpdir(),'pdd-setup-herdr-'));t.after(()=>rm(home,{recursive:true,force:true}));
  const bin=join(home,'bin');await mkdir(bin,{mode:0o700});
  if(mode==='existing')await writeFile(join(bin,'herdr'),'synthetic executable',{mode:0o700});
  const calls=[],commands=[],deps=io();const env={PATH:mode==='off-path'?'/synthetic/missing':bin,HOME:home};
  const code=await runPdd(['setup'],{...deps,home,workflowHerdrBoot,setupModules:setup(calls),ports:{env,platform:'linux',execFile:async(file,args,options)=>{
   commands.push([file,args]);assert.equal(options.shell,false);
   if(file==='curl'){
    return {stdout:'synthetic installer bytes',code:0};
   }
   if(file==='/bin/sh'){await writeFile(join(options.env.HERDR_INSTALL_DIR,'herdr'),'synthetic executable',{mode:0o700});return {stdout:'',code:0};}
   assert.equal(args[0],'--version');return {stdout:'herdr 0.9.1\n',code:0};
  }}});
  if(mode==='off-path'){
   // Installation outside the invocation PATH cannot count as setup success.
   assert.equal(code,1);assert.deepEqual(calls,['runtime']);assert.match(deps.stderr.text,/Herdr is installed but is not on PATH/);
  }else{
   assert.equal(code,0,deps.stderr.text);assert.deepEqual(calls,['runtime','lock','support','recovery']);
   assert.equal(commands.filter(([file])=>file==='curl').length,mode==='install'?1:0);
   assert.equal(commands.filter(([file])=>file==='/bin/sh').length,mode==='install'?1:0);
  }
  assert.equal(commands.some(([file,args])=>file==='systemd-run'||args.includes('server')),false);
 }
});

test('unverified PDD runtime cannot trigger Herdr installation',async()=>{
 const deps=io();assert.equal(await runPdd(['setup'],{...deps,workflowHerdrBoot:{ensureHerdrInstalled:()=>assert.fail('No installation before verified runtime')},setupModules:{versions:{resolveRuntime:async()=>{throw Error('unverified');}},lock:{withUpdateLock:()=>assert.fail('No lock')},launcher:{}}}),1);
 assert.match(deps.stderr.text,/verified PDD installer/);
});
