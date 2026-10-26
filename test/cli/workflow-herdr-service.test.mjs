import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {withUpdateLock} from '../../src/update-lock.mjs';
import {provisionHerdrService,herdrServiceFiles,checkHerdrService,startInstalledHerdr} from '../../src/workflow-herdr-service.mjs';
import {ensureDefaultHerdr} from '../../src/workflow-herdr-boot.mjs';
const unit='pdd-herdr-default.service',label='ai.promptdriven.pdd-herdr-default';
const reply=()=>({stdout:JSON.stringify({result:{workspaces:[]}}),code:0});
async function fixture(t,platform='linux'){
 const home=await fs.mkdtemp(join(tmpdir(),'pdd-c19-'));t.after(()=>fs.rm(home,{recursive:true,force:true}));
 const binary=join(home,'Herdr % $ " & tool');await fs.writeFile(binary,'#!/bin/sh\nexit 0\n',{mode:0o700});
 const calls=[],runtime={herdr:binary},state={enabled:true,active:false,linger:true,loaded:false,disabled:false};
 const ports={home,runtime,platform,env:{PATH:'',HOME:home,PDD_TRACE:''},herdrStartupTimeoutMs:500,herdrWait:async()=>{},execFile:async(file,args,options)=>{
  calls.push({file,args,options});assert.equal(options.shell,false);assert.ok(options.timeout>0&&options.timeout<=5000);
  if(file===binary){if(state.active)return reply();throw Object.assign(Error('not running'),{code:1});}
  if(file==='systemctl'){
   if(args.includes('is-enabled'))return {stdout:state.enabled?'enabled\n':'disabled\n',code:state.enabled?0:1};
   if(args.includes('is-active'))return {stdout:state.active?'active\n':'inactive\n',code:state.active?0:3};
   if(args.includes('start'))state.active=true;
  }else if(file==='loginctl'){
   if(args.includes('show-user'))return {stdout:state.linger?'yes\n':'no\n',code:0};
  }else if(file==='launchctl'){
   if(args[0]==='print-disabled')return {stdout:`disabled services = {\n "${label}" => ${state.disabled}\n}`,code:0};
   if(args[0]==='print')return {stdout:state.loaded?'state = '+(state.active?'running':'waiting'):'',code:state.loaded?0:1};
   if(args[0]==='bootstrap'){state.loaded=true;state.active=true;}
   if(args[0]==='kickstart')state.active=true;
  }else assert.fail('unexpected external command '+file);
  return {stdout:'',code:0};
 }};
 const provision=()=>withUpdateLock({home},lease=>provisionHerdrService({home,runtime,lease},ports));
 return {home,binary,runtime,state,ports,calls,provision,file:herdrServiceFiles({home,herdr:binary,platform})[0]};
}
test('C19 setup persists absolute Linux service and verifies enablement plus linger without starting a controller',async t=>{
 const f=await fixture(t);assert.deepEqual(await f.provision(),{code:null});
 const text=await fs.readFile(f.file.path,'utf8');assert.match(text,/WantedBy=default.target/);assert.match(text,/KillMode=process/);assert.match(text,/ExecStart=".*Herdr %% \$\$ \\" & tool" server/);
 assert.equal((await fs.stat(f.file.path)).mode&0o777,0o600);
 assert.ok(f.calls.some(c=>c.file==='loginctl'&&c.args.includes('enable-linger')));
 assert.ok(f.calls.some(c=>c.args.includes('is-enabled')));assert.ok(f.calls.some(c=>c.args.includes('show-user')));
 const before=await fs.stat(f.file.path);assert.deepEqual(await f.provision(),{code:null});assert.equal((await fs.stat(f.file.path)).mtimeMs,before.mtimeMs);
 assert.equal(f.state.active,false);assert.ok(!f.calls.some(c=>c.args.includes('restart')||c.args.includes('stop')));
});
test('C19 after user-manager restart installed service starts once and live read is still required',async t=>{
 const f=await fixture(t);assert.equal((await f.provision()).code,null);f.calls.length=0;
 const result=await ensureDefaultHerdr(f.ports);assert.equal(result.state,'ready');assert.equal(result.executable,f.binary);
 assert.equal(f.calls.filter(c=>c.args.includes('start')).length,1);assert.equal(f.calls.filter(c=>c.file===f.binary).length,2);
 assert.ok(!f.calls.some(c=>c.file==='systemd-run'||c.args.includes('pane')));
 f.calls.length=0;assert.equal((await ensureDefaultHerdr(f.ports)).state,'ready');assert.equal(f.calls.length,1);
});
test('C19 equal Linux file never substitutes for enabled service or linger; denied activation fails',async t=>{
 const f=await fixture(t);f.state.linger=false;assert.equal((await f.provision()).code,'herdr_service_unavailable');
 f.state.linger=true;f.state.enabled=false;assert.equal((await f.provision()).code,'herdr_service_unavailable');
 f.state.enabled=true;f.ports.execFile=async()=>{throw Object.assign(Error('PRIVATE raw'),{code:'EPERM'});};
 const result=await f.provision();assert.equal(result.code,'herdr_service_unavailable');assert.doesNotMatch(result.message,/PRIVATE/);
});
test('C19 setup requires real lease and preserves conflicting files and symlinks',async t=>{
 const f=await fixture(t);assert.equal((await provisionHerdrService({home:f.home,runtime:f.runtime,lease:{}},f.ports)).code,'lock_unavailable');assert.equal(f.calls.length,0);
 await fs.mkdir(dirname(f.file.path),{recursive:true,mode:0o700});await fs.writeFile(f.file.path,'other service',{mode:0o600});
 assert.equal((await f.provision()).code,'herdr_service_unavailable');assert.equal(await fs.readFile(f.file.path,'utf8'),'other service');assert.equal(f.calls.length,0);
 await fs.unlink(f.file.path);const outside=join(f.home,'unrelated');await fs.writeFile(outside,'retained');await fs.symlink(outside,f.file.path);
 assert.equal((await f.provision()).code,'herdr_service_unavailable');assert.equal(await fs.readFile(outside,'utf8'),'retained');assert.equal(f.calls.length,0);
});
test('C19 mismatched persistent executable refuses unmanaged fallback and missing frozen binary keeps exact path',async t=>{
 const f=await fixture(t);await f.provision();await fs.writeFile(f.file.path,'wrong path',{mode:0o600});f.calls.length=0;
 assert.equal((await ensureDefaultHerdr(f.ports)).state,'unavailable');assert.equal(f.calls.length,1);
 await fs.unlink(f.binary);const r=await ensureDefaultHerdr(f.ports);assert.equal(r.code,'herdr_not_found');assert.equal(r.message,`Herdr not found at ${f.binary}`);
});
test('C19 doctor distinguishes enabled/running/linger from absent or stopped without mutations',async t=>{
 const f=await fixture(t);assert.equal((await checkHerdrService(f.ports)).state,'fail');await f.provision();
 assert.equal((await checkHerdrService(f.ports)).state,'fail');f.state.active=true;f.calls.length=0;
 assert.equal((await checkHerdrService(f.ports)).state,'pass');assert.ok(f.calls.every(c=>['is-enabled','is-active','show-user'].some(x=>c.args.includes(x))));
 f.state.linger=false;assert.equal((await checkHerdrService(f.ports)).state,'fail');
});
test('C19 macOS LaunchAgent preserves literal path, enables and bootstraps once; equal setup does not restart',async t=>{
 const f=await fixture(t,'darwin');assert.equal((await f.provision()).code,null);
 assert.match(await fs.readFile(f.file.path,'utf8'),/Herdr % \$ &quot; &amp; tool/);assert.match(f.file.text,/<key>RunAtLoad<\/key><true\/>/);assert.match(f.file.text,/<key>AbandonProcessGroup<\/key><true\/>/);
 assert.equal(f.calls.filter(c=>c.args[0]==='bootstrap').length,1);assert.equal((await f.provision()).code,null);
 assert.equal(f.calls.filter(c=>c.args[0]==='bootstrap').length,1);assert.ok(!f.calls.some(c=>c.args[0]==='bootout'||c.args.includes('-k')));
 assert.equal((await checkHerdrService(f.ports)).state,'pass');f.state.disabled=true;assert.equal((await checkHerdrService(f.ports)).state,'fail');
});
test('C19 unloaded Mac agent is bootstrapped once and stopped loaded agent kickstarts without killing',async t=>{
 const f=await fixture(t,'darwin');await f.provision();f.state.loaded=false;f.state.active=false;f.calls.length=0;
 assert.equal((await ensureDefaultHerdr(f.ports)).state,'ready');assert.equal(f.calls.filter(c=>c.args[0]==='bootstrap').length,1);
 f.state.active=false;f.calls.length=0;assert.equal((await ensureDefaultHerdr(f.ports)).state,'ready');assert.equal(f.calls.filter(c=>c.args[0]==='kickstart').length,1);assert.ok(!f.calls.some(c=>c.args.includes('-k')));
});
test('C19 late startup acknowledgement and late valid read never prove readiness beyond original deadline',async t=>{
 const f=await fixture(t);await f.provision();const original=f.ports.execFile;
 f.ports.herdrStartupTimeoutMs=20;f.ports.execFile=async(file,args,o)=>{if(file==='systemctl'&&args.includes('start'))await new Promise(r=>setTimeout(r,35));return original(file,args,o);};
 assert.equal((await ensureDefaultHerdr(f.ports)).state,'unavailable');assert.equal(f.calls.filter(c=>c.args.includes('start')).length,1);
 f.ports.execFile=async(file,args,o)=>{if(file===f.binary)await new Promise(r=>setTimeout(r,35));return original(file,args,o);};
 assert.equal((await ensureDefaultHerdr(f.ports)).state,'unavailable');
});
test('C19 service start alone is not readiness and never invokes a second startup',async t=>{
 const f=await fixture(t);await f.provision();f.calls.length=0;f.ports.herdrStartupTimeoutMs=30;
 f.ports.execFile=async(file,args)=>{f.calls.push({file,args});return file===f.binary?{stdout:'',code:1}:{stdout:'',code:0};};
 assert.equal((await ensureDefaultHerdr(f.ports)).state,'unavailable');assert.equal(f.calls.filter(c=>c.args.includes('start')).length,1);
 assert.equal((await startInstalledHerdr({...f.ports,home:join(f.home,'absent')},f.binary,100)).installed,false);
});
test('C19 public doctor reports stopped persistent service without starting it',async t=>{
 const {runDoctorCommand}=await import('../../src/doctor.mjs');const f=await fixture(t);await f.provision();f.calls.length=0;
 let output='';const code=await runDoctorCommand(['--json'],{...f.ports,stdout:{write:s=>output+=s},stderr:{write:()=>{}}});
 assert.equal(code,1);const row=JSON.parse(output).checks.find(c=>c.id==='herdr-service');assert.equal(row.state,'fail');assert.match(row.next,/pdd setup/);
 assert.ok(!f.calls.some(c=>c.args.includes('start')||c.args.includes('enable')||c.args.includes('enable-linger')));
});

for(const platform of ['linux','darwin'])test(`C19 private service file required for reuse, startup and doctor: ${platform}`,async t=>{
 const f=await fixture(t,platform);assert.equal((await f.provision()).code,null);
 await fs.chmod(f.home,0o755);await fs.chmod(dirname(f.file.path),0o755);
 const original=await fs.readFile(f.file.path,'utf8');
 for(const mode of [0o644,0o640,0o604,0o700]){
  await fs.chmod(f.file.path,mode);f.calls.length=0;
  assert.equal((await f.provision()).code,'herdr_service_unavailable');
  await assert.rejects(startInstalledHerdr(f.ports,f.binary,500),{code:'herdr_service_unavailable'});
  assert.equal((await checkHerdrService(f.ports)).state,'fail');
  assert.equal(f.calls.length,0);assert.equal(await fs.readFile(f.file.path,'utf8'),original);
  assert.equal((await fs.stat(f.file.path)).mode&0o777,mode);
 }
 await fs.chmod(f.file.path,0o400);f.calls.length=0;
 assert.equal((await f.provision()).code,null);
 assert.equal((await startInstalledHerdr(f.ports,f.binary,500)).installed,true);
 assert.equal((await checkHerdrService(f.ports)).state,'pass');
 assert.equal((await fs.stat(f.file.path)).mode&0o777,0o400);
});
