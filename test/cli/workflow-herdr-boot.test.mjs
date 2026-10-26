import test from 'node:test';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {EventEmitter} from 'node:events';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {performance} from 'node:perf_hooks';
import {ensureDefaultHerdr,ensureHerdrInstalled as install} from '../../src/workflow-herdr-boot.mjs';
import {readHerdrTrace} from '../../src/herdr-trace.mjs';

const syntheticBinary=Buffer.from('#!/bin/sh\n# synthetic publisher Herdr\nexit 0\n');
const latestAPI='https://api.github.com/repos/herdrdev/herdr/releases/latest';
const assetURL='https://github.com/herdrdev/herdr/releases/download/current-stable/herdr-linux-x86_64';
const metadata=(name='herdr-linux-x86_64',tag='current-stable')=>({tag_name:tag,draft:false,prerelease:false,
  html_url:`https://github.com/herdrdev/herdr/releases/tag/${tag}`,
  assets:[{name,size:syntheticBinary.length,digest:'sha256:'+crypto.createHash('sha256').update(syntheticBinary).digest('hex'),
    browser_download_url:`https://github.com/herdrdev/herdr/releases/download/${tag}/${name}`} ]});
// The publisher response is a network-edge fixture, never a crypto override.
async function ensureHerdrInstalled(p){
  return install({...p,execFile:async(file,args,opts)=>{
    if(file==='curl'&&args.at(-1)===latestAPI){
      assert.equal(opts.maxBuffer,65536);assert.ok(args.includes('--proto-redir'));
      p.metadataCalls=(p.metadataCalls??0)+1;
      return {stdout:JSON.stringify(p.releaseMetadata??metadata(p.platform==='darwin'?'herdr-macos-aarch64':'herdr-linux-x86_64')),code:0};
    }
    return p.execFile(file,args,opts);
  }});
}
const downloadPath=args=>args[args.indexOf('--output')+1];
const answer=()=>({stdout:JSON.stringify({result:{type:'workspace_list',workspaces:[]}}),code:0});
const refused=()=>Object.assign(Error('PRIVATE connection failure token=DO-NOT-LOG'),{code:'ECONNREFUSED',stderr:'PRIVATE credential'});
async function fixture(t){
  const home=await fs.realpath(await fs.mkdtemp(join(tmpdir(),'pdd-herdr-boot-test-')));t.after(()=>fs.rm(home,{recursive:true,force:true}));
  const bin=join(home,'bin');await fs.mkdir(bin,{mode:0o700});
  const binary=join(bin,'herdr');await fs.writeFile(binary,'#!/bin/sh\nexit 0\n',{mode:0o700});
  const calls=[],env=Object.freeze({PATH:bin,PDD_TRACE:'',HOME:home,KEEP:'exact',HERDR_INSTALL_DIR:'/must-not-win'});
  const p={home,env,platform:'linux',arch:'x64',herdrStartupTimeoutMs:100,herdrWait:async()=>{},now:()=>{throw Error('workflow clock must not be read');},
    execFile:async(file,args,opts)=>{calls.push({file,args,opts});return file==='systemd-run'?{stdout:'',code:0}:answer();}};
  return {home,bin,binary,calls,p};
}
test('running default answers without starting or changing caller ports',async t=>{
  const f=await fixture(t),original={...f.p};
  const r=await ensureDefaultHerdr(f.p);assert.equal(r.state,'ready');assert.equal(r.executable,f.binary);
  assert.deepEqual(f.calls.map(c=>[c.file,c.args]),[[f.binary,['--session','default','workspace','list']]]);
  assert.equal(f.calls[0].opts.env,f.p.env);assert.equal(f.calls[0].opts.shell,false);assert.deepEqual(f.p,original);
});
test('stopped Linux default starts once and requires a subsequent real read answer',async t=>{
  const f=await fixture(t);let probes=0;
  f.p.execFile=async(file,args,opts)=>{f.calls.push({file,args,opts});if(file===f.binary&&++probes<3)throw refused();return file===f.binary?answer():{stdout:'',code:0};};
  assert.equal((await ensureDefaultHerdr(f.p)).state,'ready');
  const starts=f.calls.filter(c=>c.file==='systemd-run');assert.equal(starts.length,1);
  assert.deepEqual(starts[0].args,['--user','--collect','--unit=herdr-default',f.binary,'server']);assert.equal(probes,3);
});
test('failed or lost Linux start acknowledgement is reconciled without a second start',async t=>{
  const f=await fixture(t);let ready=false;
  f.p.execFile=async(file,args)=>{f.calls.push({file,args});if(file==='systemd-run'){ready=true;throw Object.assign(Error('lost'),{code:'ETIMEDOUT'});}if(!ready)throw refused();return answer();};
  assert.equal((await ensureDefaultHerdr(f.p)).state,'ready');assert.equal(f.calls.filter(c=>c.file==='systemd-run').length,1);
});
test('startup refusal is finite, explains the failure and exposes no raw subprocess text',async t=>{
  const f=await fixture(t);f.p.execFile=async(file,args)=>{f.calls.push({file,args});if(file==='systemd-run')return {stdout:'',stderr:'PRIVATE password',code:7};throw refused();};
  const start=performance.now(),r=await ensureDefaultHerdr(f.p);
  assert.equal(r.state,'unavailable');assert.equal(r.code,'herdr_not_running');assert.match(r.message,/Herdr is not running and could not be started: startup exited with status 7/);
  assert.ok(performance.now()-start<1000);assert.ok(!JSON.stringify(r).includes('PRIVATE'));assert.equal(f.calls.filter(c=>c.file==='systemd-run').length,1);
});
test('malformed successful probe never starts another server',async t=>{
  const f=await fixture(t);f.p.execFile=async(file,args)=>{f.calls.push({file,args});return {stdout:'{}',code:0};};
  const r=await ensureDefaultHerdr(f.p);assert.equal(r.state,'unavailable');assert.match(r.message,/invalid reply/);assert.equal(f.calls.length,1);
});
test('default installed binary outside inherited PATH refuses boot with PATH repair and no effects',async t=>{
  const f=await fixture(t),local=join(f.home,'.local','bin');await fs.mkdir(local,{recursive:true,mode:0o700});await fs.rename(f.binary,join(local,'herdr'));
  const r=await ensureDefaultHerdr(f.p);assert.equal(r.state,'unavailable');assert.equal(r.code,'herdr_not_on_path');assert.match(r.message,/export PATH/);assert.deepEqual(f.calls,[]);assert.equal(f.p.env.PATH,f.bin);
});
test('missing executable and unsupported OS explain prerequisites without server effects',async t=>{
  const f=await fixture(t);await fs.unlink(f.binary);
  assert.equal((await ensureDefaultHerdr(f.p)).code,'herdr_not_installed');assert.deepEqual(f.calls,[]);
  assert.equal((await ensureDefaultHerdr({...f.p,platform:'win32'})).code,'unsupported_platform');assert.deepEqual(f.calls,[]);
});
test('macOS startup is detached, unrefed and acknowledged only after a successful read',async t=>{
  const f=await fixture(t);f.p.platform='darwin';let spawned=false,unrefs=0;
  f.p.execFile=async()=>{if(!spawned)throw refused();return answer();};
  f.p.spawn=(file,args,opts)=>{assert.equal(file,f.binary);assert.deepEqual(args,['server']);assert.equal(opts.detached,true);assert.equal(opts.stdio,'ignore');assert.equal(opts.env,f.p.env);const child=new EventEmitter();child.unref=()=>unrefs++;queueMicrotask(()=>{spawned=true;child.emit('spawn');});return child;};
  assert.equal((await ensureDefaultHerdr(f.p)).state,'ready');assert.equal(unrefs,1);
});
test('macOS spawn failure does not repeat startup or infer readiness',async t=>{
  const f=await fixture(t);f.p.platform='darwin';let starts=0;f.p.execFile=async()=>{throw refused();};
  f.p.spawn=()=>{starts++;const child=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>child.emit('error',Object.assign(Error('PRIVATE'),{code:'EACCES'})));return child;};
  const r=await ensureDefaultHerdr(f.p);assert.equal(r.state,'unavailable');assert.match(r.message,/permission denied/);assert.equal(starts,1);
});
test('failed default-session reads are traced without changing the outcome or leaking private text',async t=>{
  const f=await fixture(t);f.p.env={...f.p.env,PDD_TRACE:'herdr'};f.p.execFile=async(file,args)=>{f.calls.push({file,args});if(file==='systemd-run')return {stdout:'',code:1};throw refused();};
  assert.equal((await ensureDefaultHerdr(f.p)).state,'unavailable');
  const rows=readHerdrTrace(f.p);assert.ok(rows.some(r=>r.operation==='workspace.list'&&r.phase==='error'));
  assert.ok(rows.some(r=>r.operation==='workspace.list'&&r.phase==='request'));assert.ok(!JSON.stringify(rows).includes('PRIVATE'));assert.ok(!JSON.stringify(rows).includes(f.home));
  assert.equal(f.calls.filter(c=>c.file==='systemd-run').length,1);
});
test('setup reuses an available versioned PATH executable without installation or startup',async t=>{
  const f=await fixture(t);f.p.execFile=async(file,args,opts)=>{f.calls.push({file,args,opts});return {stdout:'herdr 0.9.1\n',code:0};};
  const r=await ensureHerdrInstalled(f.p);assert.equal(r.state,'ready');assert.equal(r.installed,false);assert.deepEqual(f.calls.map(c=>c.args),[['--help']]);
});
test('setup downloads the official installer once and validates its actual installed PATH executable',async t=>{
  const f=await fixture(t);await fs.unlink(f.binary);let downloaded,candidate;
  f.p.execFile=async(file,args,opts)=>{f.calls.push({file,args,opts});if(file==='curl'){
    downloaded=opts;assert.equal(args.at(-1),assetURL);assert.ok(args.includes('--proto-redir'));candidate=downloadPath(args);
    await fs.writeFile(candidate,syntheticBinary,{mode:0o600});return {stdout:'',code:0};
  }
  assert.notEqual(file,'/bin/sh');assert.deepEqual(args,['--help']);assert.equal((await fs.stat(file)).mode&0o777,0o700);return {stdout:'herdr 0.9.1\n',code:0};};
  const r=await ensureHerdrInstalled(f.p);assert.equal(r.state,'ready');assert.equal(r.installed,true);assert.equal(r.executable,f.binary);
  assert.equal(downloaded.env,f.p.env);assert.equal(downloaded.maxBuffer,65536);assert.equal(dirname(dirname(candidate)),f.bin);assert.equal(f.p.env.HERDR_INSTALL_DIR,'/must-not-win');
  assert.equal(f.calls.filter(c=>c.file==='curl').length,1);assert.equal(f.calls.filter(c=>c.file==='/bin/sh').length,0);assert.ok(!f.calls.some(c=>c.file==='systemd-run'));
  assert.deepEqual(await fs.readFile(f.binary),syntheticBinary);await assert.rejects(fs.access(candidate),{code:'ENOENT'});
});
test('setup reuses default install outside PATH but refuses to claim PATH readiness',async t=>{
  const f=await fixture(t),local=join(f.home,'.local','bin');await fs.mkdir(local,{recursive:true});await fs.rename(f.binary,join(local,'herdr'));f.p.execFile=async(file,args)=>{f.calls.push({file,args});return {stdout:'herdr 0.9.1',code:0};};
  const r=await ensureHerdrInstalled(f.p);assert.equal(r.code,'herdr_not_on_path');assert.equal(r.installed,false);assert.match(r.message,/export PATH="\$HOME\/\.local\/bin:\$PATH"/);assert.equal(f.calls.length,1);
});
test('setup does not overwrite a present binary that fails its version check',async t=>{
  const f=await fixture(t);const old=await fs.readFile(f.binary);f.p.execFile=async(file,args)=>{f.calls.push({file,args});throw refused();};
  assert.equal((await ensureHerdrInstalled(f.p)).code,'herdr_unusable');assert.deepEqual(await fs.readFile(f.binary),old);assert.equal(f.calls.length,1);
});
test('installer zero alone never counts as an installed usable executable',async t=>{
  const f=await fixture(t);await fs.unlink(f.binary);f.p.execFile=async(file,args)=>{f.calls.push({file,args});return {stdout:file==='curl'?'#!/bin/sh\n':'',code:0};};
  assert.equal((await ensureHerdrInstalled(f.p)).code,'herdr_install_failed');assert.equal(f.calls.filter(c=>c.file==='/bin/sh').length,0);await assert.rejects(fs.lstat(f.binary),{code:'ENOENT'});
});
test('oversize downloaded bytes are rejected even if a chunked downloader reports success',async t=>{
  const f=await fixture(t);await fs.unlink(f.binary);f.p.execFile=async(file,args)=>{f.calls.push({file,args});return {stdout:'x'.repeat(65537),code:0};};
  assert.equal((await ensureHerdrInstalled(f.p)).code,'herdr_install_failed');assert.deepEqual(f.calls.map(c=>c.file),['curl']);
});
test('real subprocess output is bounded before an oversized installer can reach sh',async t=>{
  const f=await fixture(t);await fs.unlink(f.binary);const curl=join(f.bin,'curl');
  const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
  await fs.writeFile(curl,`#!/bin/sh\nexec ${quote(process.execPath)} -e 'process.stdout.write("x".repeat(70000))'\n`,{mode:0o700});
  const execute=promisify(execFile);let actualError;
  f.p.execFile=async(file,args,opts)=>{f.calls.push({file,args});try{return await execute(file,args,opts);}catch(e){actualError=e.code;throw e;}};
  assert.equal((await ensureHerdrInstalled(f.p)).code,'herdr_install_failed');assert.equal(actualError,'ERR_CHILD_PROCESS_STDIO_MAXBUFFER');assert.deepEqual(f.calls.map(c=>c.file),['curl']);
});
test('installer destinations skip symlinks, shared permissions and relative PATH entries',async t=>{

  const f=await fixture(t);await fs.unlink(f.binary);const shared=join(f.home,'shared'),link=join(f.home,'link');await fs.mkdir(shared,{mode:0o777});await fs.chmod(shared,0o777);await fs.symlink(f.bin,link);
  f.p.env={...f.p.env,PATH:`relative:${shared}:${link}`};let destination;
  f.p.execFile=async(file,args,opts)=>{if(file==='curl'){destination=downloadPath(args);await fs.writeFile(destination,syntheticBinary,{mode:0o600});return {stdout:'',code:0};}return {stdout:'herdr 0.9.1',code:0};};
  assert.equal((await ensureHerdrInstalled(f.p)).code,'herdr_not_on_path');assert.equal(dirname(dirname(destination)),join(f.home,'.local','bin'));assert.deepEqual(await fs.readdir(shared),[]);assert.deepEqual(await fs.readdir(f.bin),[]);
});
test('writable intermediate PATH directories cannot receive an install',async t=>{

  const f=await fixture(t);await fs.unlink(f.binary);const middle=join(f.home,'shared-parent'),leaf=join(middle,'private-bin');await fs.mkdir(leaf,{recursive:true,mode:0o700});await fs.chmod(middle,0o777);
  f.p.env={...f.p.env,PATH:leaf};let destination;
  f.p.execFile=async(file,args,opts)=>{if(file==='curl'){destination=downloadPath(args);await fs.writeFile(destination,syntheticBinary,{mode:0o600});return {stdout:'',code:0};}return {stdout:'herdr 0.9.1',code:0};};
  assert.equal((await ensureHerdrInstalled(f.p)).code,'herdr_not_on_path');assert.equal(dirname(dirname(destination)),join(f.home,'.local','bin'));assert.deepEqual(await fs.readdir(leaf),[]);
});
test('occupied non-executable and broken-symlink targets retain exact identity without installer calls',async t=>{
  for(const broken of [false,true]){
    const f=await fixture(t);await fs.unlink(f.binary);
    if(broken)await fs.symlink('/missing/herdr-target',f.binary);else await fs.writeFile(f.binary,'existing user content',{mode:0o600});
    const before=await fs.lstat(f.binary),bytes=broken?await fs.readlink(f.binary):await fs.readFile(f.binary);
    const r=await ensureHerdrInstalled(f.p);assert.equal(r.code,'herdr_unusable');assert.deepEqual(f.calls,[]);assert.equal((await fs.lstat(f.binary)).ino,before.ino);
    assert.deepEqual(broken?await fs.readlink(f.binary):await fs.readFile(f.binary),bytes);
  }
});
test('a concurrent target created while installing is never overwritten or adopted',async t=>{

  const f=await fixture(t);await fs.unlink(f.binary);let inode;
  f.p.execFile=async(file,args,opts)=>{if(file==='curl'){
    await fs.writeFile(downloadPath(args),syntheticBinary,{mode:0o600});await fs.writeFile(f.binary,'concurrent owner content',{mode:0o600});inode=(await fs.stat(f.binary)).ino;
  }return {stdout:'herdr 0.9.1',code:0};};
  assert.equal((await ensureHerdrInstalled(f.p)).code,'herdr_unusable');assert.equal((await fs.stat(f.binary)).ino,inode);assert.equal(await fs.readFile(f.binary,'utf8'),'concurrent owner content');
});
test('download failures preserve their safe outcome and never execute an installer',async t=>{
  const f=await fixture(t);await fs.unlink(f.binary);f.p.execFile=async(file,args)=>{f.calls.push({file,args});throw Object.assign(Error('PRIVATE secret'),{code:'EACCES'});};
  const r=await ensureHerdrInstalled(f.p);assert.equal(r.code,'herdr_install_failed');assert.match(r.message,/permission denied/);assert.ok(!JSON.stringify(r).includes('PRIVATE'));assert.deepEqual(f.calls.map(c=>c.file),['curl']);
});

test('publisher latest Herdr digest mismatch never executes downloaded bytes or publishes a binary',async t=>{
 const f=await fixture(t);await fs.unlink(f.binary);
 f.p.execFile=async(file,args)=>{f.calls.push({file,args});assert.equal(file,'curl');await fs.writeFile(downloadPath(args),'tampered executable',{mode:0o600});return {stdout:'',code:0};};
 assert.equal((await ensureHerdrInstalled(f.p)).code,'herdr_install_failed');assert.equal(f.calls.length,1);await assert.rejects(fs.lstat(f.binary),{code:'ENOENT'});assert.deepEqual(await fs.readdir(f.bin),[]);
});
test('publisher latest Herdr accepts a different version label without a version gate',async t=>{
 const f=await fixture(t);await fs.unlink(f.binary);f.p.releaseMetadata=metadata('herdr-linux-x86_64','future-release');
 f.p.execFile=async(file,args)=>{f.calls.push({file,args});if(file==='curl'){assert.equal(args.at(-1),'https://github.com/herdrdev/herdr/releases/download/future-release/herdr-linux-x86_64');await fs.writeFile(downloadPath(args),syntheticBinary,{mode:0o600});return {stdout:'',code:0};}assert.deepEqual(args,['--help']);return {stdout:'Herdr usage: server workspace; future version',code:0};};
 assert.equal((await ensureHerdrInstalled(f.p)).state,'ready');assert.equal(f.p.metadataCalls,1);assert.deepEqual(await fs.readFile(f.binary),syntheticBinary);assert.equal(f.calls.length,3);
});
test('publisher latest Herdr architecture selection refuses unsupported hosts before download',async t=>{
 const f=await fixture(t);await fs.unlink(f.binary);f.p.arch='unknown';
 assert.equal((await ensureHerdrInstalled(f.p)).code,'unsupported_platform');assert.deepEqual(f.calls,[]);
});
test('publisher latest Darwin Herdr selects the arm64 release and rejects Linux bytes before execution',async t=>{
 const f=await fixture(t);await fs.unlink(f.binary);f.p.platform='darwin';f.p.arch='arm64';
 f.p.execFile=async(file,args)=>{f.calls.push({file,args});assert.equal(file,'curl');assert.equal(args.at(-1),'https://github.com/herdrdev/herdr/releases/download/current-stable/herdr-macos-aarch64');await fs.writeFile(downloadPath(args),'ELF substitute',{mode:0o600});return {stdout:'',code:0};};
 assert.equal((await ensureHerdrInstalled(f.p)).code,'herdr_install_failed');assert.equal(f.calls.length,1);await assert.rejects(fs.lstat(f.binary),{code:'ENOENT'});
});

test('oversized artifact and symlink download refuse without executing or changing outside modes',async t=>{
 for(const kind of ['oversized','symlink']){
  const f=await fixture(t);await fs.unlink(f.binary);const outside=join(f.home,'outside');await fs.writeFile(outside,'keep',{mode:0o600});const before=await fs.stat(outside);
  f.p.execFile=async(file,args)=>{f.calls.push({file,args});assert.equal(file,'curl');const path=downloadPath(args);if(kind==='symlink')await fs.symlink(outside,path);else{await fs.writeFile(path,'x');await fs.truncate(path,32*1024*1024+1);}return {stdout:'',code:0};};
  assert.equal((await ensureHerdrInstalled(f.p)).code,'herdr_install_failed');assert.equal(f.calls.length,1);await assert.rejects(fs.lstat(f.binary),{code:'ENOENT'});assert.equal((await fs.stat(outside)).mode,before.mode);assert.equal(await fs.readFile(outside,'utf8'),'keep');
 }
});

for(const [name,alter] of [
 ['missing digest',r=>delete r.assets[0].digest],
 ['bad digest',r=>r.assets[0].digest='sha256:bogus'],
 ['foreign URL',r=>r.assets[0].browser_download_url='https://example.test/herdr'],
 ['duplicate asset',r=>r.assets.push({...r.assets[0]})],
 ['missing asset',r=>r.assets=[]],
 ['draft release',r=>r.draft=true],
 ['prerelease',r=>r.prerelease=true],
 ['unsafe tag',r=>r.tag_name='../escape'],
 ['foreign release',r=>r.html_url='https://example.test/release'],
 ['zero size',r=>r.assets[0].size=0],
 ['oversize metadata asset',r=>r.assets[0].size=32*1024*1024+1]
])test(`Rule18 publisher metadata refuses ${name} before artifact download`,async t=>{
 const f=await fixture(t);await fs.unlink(f.binary);f.p.releaseMetadata=metadata();alter(f.p.releaseMetadata);
 assert.equal((await ensureHerdrInstalled(f.p)).code,'herdr_install_failed');assert.deepEqual(f.calls,[]);assert.equal(f.p.metadataCalls,1);await assert.rejects(fs.lstat(f.binary),{code:'ENOENT'});
});
test('Rule18 size mismatch refuses even when the publisher digest matches the bytes',async t=>{
 const f=await fixture(t);await fs.unlink(f.binary);f.p.releaseMetadata=metadata();f.p.releaseMetadata.assets[0].size++;
 f.p.execFile=async(file,args)=>{f.calls.push({file,args});assert.equal(file,'curl');await fs.writeFile(downloadPath(args),syntheticBinary,{mode:0o600});return {stdout:'',code:0};};
 assert.equal((await ensureHerdrInstalled(f.p)).code,'herdr_install_failed');assert.equal(f.calls.length,1);await assert.rejects(fs.lstat(f.binary),{code:'ENOENT'});
});
test('Rule18 failed or malformed publisher metadata has no fallback download',async t=>{
 for(const stdout of ['not JSON','x'.repeat(65537),JSON.stringify({tag_name:'latest'})]){
  const f=await fixture(t);await fs.unlink(f.binary);f.p.execFile=async(file,args)=>{f.calls.push({file,args});assert.equal(args.at(-1),latestAPI);return {stdout,code:0};};
  assert.equal((await install(f.p)).code,'herdr_install_failed');assert.equal(f.calls.length,1);await assert.rejects(fs.lstat(f.binary),{code:'ENOENT'});
 }
 const f=await fixture(t);await fs.unlink(f.binary);f.p.execFile=async()=>{throw Object.assign(Error('private details'),{code:'EACCES'});};
 const r=await install(f.p);assert.equal(r.code,'herdr_install_failed');assert.match(r.message,/permission denied/);assert.ok(!JSON.stringify(r).includes('private details'));
});
