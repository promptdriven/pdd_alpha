import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {traceHerdrRequest,readHerdrTrace} from '../../src/herdr-trace.mjs';

function fixture(t){const home=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'pdd-herdr-trace-')));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));return {home,env:{PDD_TRACE:'herdr'},now:()=>assert.fail('Workflow clocks are not diagnostic clocks')};}
const path=p=>join(p.home,'.pdd/logs/herdr-trace.jsonl');
const secret='sk-proj-syntheticCredential123';

test('disabled tracing has no filesystem effect and preserves exact results and errors',async t=>{
  const p=fixture(t),reply={unknown:{retained:true}},error=Object.assign(Error(secret),{code:'EACCES'});let count=0;
  for(const env of [{PDD_TRACE:''},{PDD_TRACE:'git'},{PDD_TRACE:'HERDR'}]){
    assert.equal(await traceHerdrRequest({operation:'tab.create',request:{prompt:secret}},()=>{count++;return reply;},{...p,env}),reply);
    await assert.rejects(traceHerdrRequest({operation:'pane.run'},()=>{count++;throw error;},{...p,env}),e=>e===error);
  }
  assert.equal(count,6);assert.equal(fs.existsSync(join(p.home,'.pdd')),false);assert.deepEqual(readHerdrTrace(p),[]);
});

test('trace selector accepts both token orders and process environment when filtered ports omit it',async t=>{
 const prior=process.env.PDD_TRACE;t.after(()=>{if(prior===undefined)delete process.env.PDD_TRACE;else process.env.PDD_TRACE=prior;});
 for(const selector of ['herdr,git','git,herdr',' herdr , git ','unknown,herdr']){
  const p=fixture(t);let calls=0;process.env.PDD_TRACE='';
  const reply={state:'ready'};assert.equal(await traceHerdrRequest({operation:'workspace.list'},()=>{calls++;return reply;},{...p,env:{PDD_TRACE:selector}}),reply);
  assert.equal(calls,1);assert.equal(readHerdrTrace(p).length,2);
 }
 process.env.PDD_TRACE='herdr,git';
 const p=fixture(t);await traceHerdrRequest({operation:'workspace.list'},()=>({state:'ready'}),{...p,env:{PATH:'/synthetic'}});assert.equal(readHerdrTrace(p).length,2);
 const disabled=fixture(t);await traceHerdrRequest({operation:'workspace.list'},()=>({state:'ready'}),{...disabled,env:{PDD_TRACE:''}});assert.equal(fs.existsSync(join(disabled.home,'.pdd')),false);
 const unknown=fixture(t);await traceHerdrRequest({operation:'workspace.list'},()=>({state:'ready'}),{...unknown,env:{PDD_TRACE:'UNKNOWN,git'}});assert.equal(fs.existsSync(join(unknown.home,'.pdd')),false);
});

test('synthetic replies retain useful IDs and timing without prompts, argv, paths or error text',async t=>{
  const p=fixture(t),runId=randomUUID(),launchId=randomUUID();let calls=0;
  const reply={id:'cli:tab:create',result:{type:'tab_created',tab:{tab_id:'w1:t2',pane_id:'w1:p3',terminal_id:'term_abc123',message:secret}},stdout:JSON.stringify({result:{process_info:{pane_id:'w1:p3',foreground_processes:[{pid:321,name:'node',startIdentity:'123456',argv:['/private/node','/private/bin','workflow','drive',runId,'--launch-id',launchId],cmdline:secret,cwd:'/private/repo'}]}}}),stderr:secret};
  assert.equal(await traceHerdrRequest({operation:'tab.create',request:{session:'default',workspaceId:'w1',cwd:'/private/repo',label:secret,command:secret,env:{TOKEN:secret}}},()=>{calls++;return reply;},p),reply);
  const err=Object.assign(Error(secret),{code:'EACCES',stderr:secret});await assert.rejects(traceHerdrRequest({operation:'pane.run',request:{command:secret}},()=>{calls++;throw err;},p),e=>e===err);
  assert.equal(calls,2);const rows=readHerdrTrace(p);assert.deepEqual(rows.map(r=>r.phase),['request','reply','request','error']);
  assert.equal(rows[0].traceId,rows[1].traceId);assert.equal(rows[1].payload.result.tab.pane_id,'w1:p3');
  assert.equal(rows[1].payload.reply.result.process_info.foreground_processes[0].pid,321);
  assert.equal(rows[1].payload.reply.result.process_info.foreground_processes[0].startIdentity,'123456');
  assert.equal(rows[1].payload.reply.result.process_info.foreground_processes[0].runId,runId);
  assert.ok(rows.every(r=>Number.isFinite(r.monotonicMs)&&r.monotonicMs>=0));assert.ok(rows[1].durationMs>=0);assert.ok(rows[1].monotonicMs>=rows[0].monotonicMs);
  assert.equal(rows[3].payload.error.code,'EACCES');
  assert.doesNotMatch(fs.readFileSync(path(p),'utf8'),/syntheticCredential|private\/|TOKEN|cmdline|stderr|label|prompt/);
  assert.equal(fs.statSync(path(p)).mode&0o777,0o600);assert.equal(fs.statSync(join(p.home,'.pdd/logs')).mode&0o777,0o700);
});

test('unavailable, busy and unsafe sinks never change results or touch aliased data',async t=>{
  for(const kind of ['symlink','hardlink','permissions','busy','oversize']){
    const p=fixture(t);fs.mkdirSync(join(p.home,'.pdd/logs'),{recursive:true,mode:0o700});
    const target=join(p.home,'retained');fs.writeFileSync(target,'preserved', {mode:0o600});
    if(kind==='symlink')fs.symlinkSync(target,path(p));
    if(kind==='hardlink')fs.linkSync(target,path(p));
    if(kind==='permissions')fs.writeFileSync(path(p),'preserved',{mode:0o644});
    if(kind==='busy')fs.writeFileSync(path(p)+'.lock','preserved',{mode:0o600});
    if(kind==='oversize')fs.writeFileSync(path(p),'x'.repeat(1024*1024+1),{mode:0o600});
    const before=fs.existsSync(path(p))?fs.readFileSync(path(p)):null;const value={same:true};let calls=0;
    assert.equal(await traceHerdrRequest({operation:'pane.run'},()=>{calls++;return value;},p),value);assert.equal(calls,1);
    assert.equal(fs.readFileSync(target,'utf8'),'preserved');if(before)assert.deepEqual(fs.readFileSync(path(p)),before);
    assert.deepEqual(readHerdrTrace(p),[]);
  }
});

test('redaction never invokes payload, runtime, error or argument accessors',async t=>{
  const p=fixture(t);let gets=0;const getter=()=>{gets++;throw Error('Tracing must not evaluate accessors');};
  const reply={result:{type:'ok'},runtime:{},argv:[]};
  Object.defineProperty(reply,'unknown',{enumerable:true,get:getter});Object.defineProperty(reply,'state',{enumerable:true,get:getter});
  Object.defineProperty(reply.runtime,'nodeVersion',{enumerable:true,get:getter});Object.defineProperty(reply.argv,'0',{get:getter});
  reply.result.argv=['node','bin','workflow','drive',{toString:getter},'--launch-id',{toString:getter}];
  const error=Error(secret);Object.defineProperty(error,'code',{get:getter});
  assert.equal(await traceHerdrRequest({operation:'tab.create',request:reply},()=>reply,p),reply);
  await assert.rejects(traceHerdrRequest({operation:'pane.run'},()=>{throw error;},p),e=>e===error);
  assert.equal(gets,0);assert.equal(readHerdrTrace(p).length,4);assert.equal(gets,0);
});

test('reader reprojects untrusted records, bounds physical tail and never creates files',async t=>{
  const p=fixture(t);assert.deepEqual(readHerdrTrace(p),[]);assert.equal(fs.existsSync(join(p.home,'.pdd')),false);
  fs.mkdirSync(join(p.home,'.pdd/logs'),{recursive:true,mode:0o700});
  const rows=Array.from({length:220},(_,i)=>({v:1,traceId:randomUUID(),operation:'pane.process_info',phase:'reply',at:i,monotonicMs:i,payload:{pid:i+1,state:'started',message:secret,unknown:secret,runtime:{nodePresent:true,pddVersion:'1.2.3-beta'},argv:[secret]}}));
  fs.writeFileSync(path(p),rows.map(r=>JSON.stringify(r)).join('\n')+'\n'+secret+'\n',{mode:0o600});
  const before=fs.readFileSync(path(p));const safe=readHerdrTrace(p);assert.equal(safe.length,199);assert.equal(safe[0].at,21);assert.equal(safe.at(-1).at,219);assert.equal(safe[0].payload.runtime.nodePresent,true);
  assert.doesNotMatch(JSON.stringify(safe),/syntheticCredential|unknown|message|beta/);assert.deepEqual(fs.readFileSync(path(p)),before);
});

test('bounded compaction keeps recent safe records and file never exceeds one MiB',async t=>{
  const p=fixture(t);await traceHerdrRequest({operation:'pane.run'},()=>({ok:true}),p);
  const sample={v:1,traceId:randomUUID(),operation:'pane.process_info',phase:'reply',at:1,monotonicMs:1,payload:{pid:1}};
  const line=JSON.stringify(sample)+'\n';const size=1024*1024;fs.writeFileSync(path(p),line.repeat(Math.floor((size-20)/Buffer.byteLength(line))),{mode:0o600});
  await traceHerdrRequest({operation:'tab.create'},()=>({ok:true}),p);
  assert.ok(fs.statSync(path(p)).size<=size);const safe=readHerdrTrace(p);assert.equal(safe.length,200);assert.equal(safe.at(-1).operation,'tab.create');assert.equal(safe.at(-1).phase,'reply');
  assert.ok(fs.readFileSync(path(p),'utf8').trim().split('\n').every(r=>Buffer.byteLength(r)<4096));
});


test('reader bounds complete physical lines before filtering and ignores interrupted final writes',async t=>{
  const p=fixture(t);await traceHerdrRequest({operation:'pane.run'},()=>({ok:true}),p);
  const row={v:1,traceId:randomUUID(),operation:'pane.process_info',phase:'reply',at:1,monotonicMs:1,payload:{pid:123}};
  const first=JSON.stringify({...row,at:0})+'\n';
  fs.writeFileSync(path(p),first+'\n'.repeat(199)+JSON.stringify({...row,at:2})+'\n'+JSON.stringify({...row,at:3}),{mode:0o600});
  const before=fs.readFileSync(path(p));
  assert.deepEqual(readHerdrTrace(p).map(r=>r.at),[2]);
  assert.deepEqual(fs.readFileSync(path(p)),before);
});


test('reader refuses a private FIFO without blocking or changing it',{skip:process.platform==='win32'},async t=>{
  const p=fixture(t);fs.mkdirSync(join(p.home,'.pdd'),{mode:0o700});fs.mkdirSync(join(p.home,'.pdd/logs'),{mode:0o700});
  const made=spawnSync('mkfifo',['-m','600',path(p)],{encoding:'utf8'});assert.equal(made.status,0,made.stderr);
  const before=fs.lstatSync(path(p));
  const code=`import {readHerdrTrace} from ${JSON.stringify(new URL('../../src/herdr-trace.mjs',import.meta.url).href)};process.stdout.write(JSON.stringify(readHerdrTrace({home:process.argv[1]})));`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',code,p.home],{encoding:'utf8',timeout:2000});
  assert.equal(child.error,undefined);assert.equal(child.status,0,child.stderr);assert.equal(child.stdout,'[]');
  assert.equal(fs.lstatSync(path(p)).isFIFO(),true);assert.equal(fs.lstatSync(path(p)).ino,before.ino);assert.equal(fs.readdirSync(join(p.home,'.pdd/logs')).length,1);
});

test('failed default-session probes and server startup retain safe connection diagnostics once',async t=>{
  const p=fixture(t);let calls=0;
  const failures=[Object.assign(Error('connect '+secret+' /private/socket'),{code:'ECONNREFUSED',stderr:secret}),Object.assign(Error(secret),{code:1,stderr:secret}),secret];
  for(const error of failures)await assert.rejects(traceHerdrRequest({operation:'workspace.list',request:{session:'default'}},()=>{calls++;return Promise.reject(error);},p),e=>e===error);
  const reply={code:0,stdout:'ignored'};
  assert.equal(await traceHerdrRequest({operation:'server.start'},()=>{calls++;return reply;},p),reply);
  const rows=readHerdrTrace(p);assert.equal(calls,4);assert.equal(rows.length,8);
  assert.equal(rows[1].payload.error.code,'ECONNREFUSED');assert.equal(rows[1].payload.error.kind,'command_failed');
  assert.equal(rows[3].payload.error.exitCode,1);assert.equal(rows[3].payload.error.kind,'command_failed');
  assert.deepEqual(rows[5].payload.error,{kind:'command_failed'});assert.equal(rows.at(-1).operation,'server.start');
  for(let i=0;i<rows.length;i+=2){assert.equal(rows[i].traceId,rows[i+1].traceId);assert.ok(rows[i+1].durationMs>=0);}
  assert.doesNotMatch(fs.readFileSync(path(p),'utf8'),/syntheticCredential|private|stderr|connect /);
});

test('diagnostic projection failures preserve the exact rejected value without retry',async t=>{
 const p=fixture(t);let calls=0;
 const error=new Proxy({}, {getOwnPropertyDescriptor(){throw Error('synthetic projection fault');}});
 await assert.rejects(traceHerdrRequest({operation:'workspace.list'},()=>{calls++;return Promise.reject(error);},p),e=>e===error);
 assert.equal(calls,1);
});

test('issue21 C11 waits for another process writer then retains both request and outcome without warning or redelivery',async t=>{
 const {spawn}=await import('node:child_process');
 for(const outcome of ['reply','error']){
  const p=fixture(t),warnings=[];p.stderr={write:text=>{warnings.push(text);return true;}};
  fs.mkdirSync(join(p.home,'.pdd/logs'),{recursive:true,mode:0o700});
  const lock=path(p)+'.lock';
  // An independent process holds the same exclusive lock as a CLI/drive writer.
  // IPC releases it only after the contender has started waiting.
  const child=spawn(process.execPath,['--input-type=module','-e',`import * as fs from 'node:fs';const lock=process.argv[1];const fd=fs.openSync(lock,'wx',0o600);process.send('locked');process.on('message',()=>{fs.closeSync(fd);fs.unlinkSync(lock);process.disconnect();});`,lock],{stdio:['ignore','ignore','pipe','ipc']});
  t.after(()=>{if(child.exitCode===null)child.kill();});
  await new Promise((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);child.once('exit',code=>{if(code!==null&&code!==0)reject(Error(`writer exited ${code}`));});});
  let calls=0;const value={same:true},error=Object.assign(Error('synthetic private error'),{code:'EACCES'});
  const pending=traceHerdrRequest({operation:'pane.run'},()=>{calls++;assert.equal(fs.existsSync(lock),false);if(outcome==='error')throw error;return value;},p);
  assert.equal(calls,0,'contender yields without invoking the operation before its request record');
  child.send('release');
  if(outcome==='reply')assert.equal(await pending,value);else await assert.rejects(pending,e=>e===error);
  assert.equal(calls,1);assert.deepEqual(warnings,[]);
  const rows=readHerdrTrace(p);assert.deepEqual(rows.map(r=>r.phase),['request',outcome]);assert.equal(rows[0].traceId,rows[1].traceId);
  await new Promise((resolve,reject)=>{if(child.exitCode!==null)return child.exitCode===0?resolve():reject(Error('writer exit'));child.once('exit',code=>code===0?resolve():reject(Error('writer exit')));});
 }
});

test('issue21 C11 persistent contention remains bounded, warns once and never steals a lock or retries an effect',async t=>{
 const p=fixture(t),warnings=[];p.stderr={write:text=>{warnings.push(text);return true;}};
 fs.mkdirSync(join(p.home,'.pdd/logs'),{recursive:true,mode:0o700});
 const lock=path(p)+'.lock';fs.writeFileSync(lock,'another writer',{mode:0o600});const before=fs.statSync(lock);
 let calls=0;const value={same:true},started=performance.now();
 assert.equal(await traceHerdrRequest({operation:'pane.run'},()=>{calls++;return value;},p),value);
 const elapsed=performance.now()-started;assert.ok(elapsed>=450);assert.ok(elapsed<2000,`bounded contention took ${elapsed}ms`);
 assert.equal(calls,1);assert.equal(warnings.length,1);assert.match(warnings[0],/busy.*Fix:/);
 assert.equal(fs.statSync(lock).ino,before.ino);assert.equal(fs.readFileSync(lock,'utf8'),'another writer');assert.deepEqual(readHerdrTrace(p),[]);
});

test('issue21 C11 revalidates safety after contention instead of writing through changed directories',async t=>{
 const p=fixture(t),warnings=[];p.stderr={write:text=>{warnings.push(text);return true;}};
 const logs=join(p.home,'.pdd/logs');fs.mkdirSync(logs,{recursive:true,mode:0o700});
 const lock=path(p)+'.lock';fs.writeFileSync(lock,'retained',{mode:0o600});
 let calls=0;const pending=traceHerdrRequest({operation:'pane.run'},()=>{calls++;return 'ok';},p);
 fs.chmodSync(logs,0o775);
 assert.equal(await pending,'ok');assert.equal(calls,1);assert.equal(warnings.length,1);assert.match(warnings[0],/permissions/);
 assert.equal(fs.existsSync(path(p)),false);assert.equal(fs.readFileSync(lock,'utf8'),'retained');
});

test('issue21 C11 waits on outcome-record contention and preserves the original rejected value',async t=>{
 const p=fixture(t),warnings=[];p.stderr={write:text=>{warnings.push(text);return true;}};
 const error=Object.assign(Error('synthetic private error'),{code:'EACCES'});let calls=0;
 await assert.rejects(traceHerdrRequest({operation:'pane.run'},()=>{
  calls++;const lock=path(p)+'.lock';fs.writeFileSync(lock,'reply writer',{mode:0o600});
  setTimeout(()=>fs.unlinkSync(lock),20);throw error;
 },p),e=>e===error);
 assert.equal(calls,1);assert.deepEqual(warnings,[]);assert.deepEqual(readHerdrTrace(p).map(r=>r.phase),['request','error']);
});

test('slow initial directory validation is not writer contention and preserves request and outcome',t=>{
 const p=fixture(t);
 // Delay actual filesystem validation in an isolated child; no competing writer
 // exists, and no production clock or filesystem port bypasses the safety checks.
 const script=`import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
const home=process.argv[1],original=fs.realpathSync,wait=new Int32Array(new SharedArrayBuffer(4));
let validations=0;
fs.realpathSync=function(path,...args){if(path===home){validations++;Atomics.wait(wait,0,0,300);}return original.call(this,path,...args);};
syncBuiltinESMExports();
const {traceHerdrRequest,readHerdrTrace}=await import(${JSON.stringify(new URL('../../src/herdr-trace.mjs',import.meta.url).href)});
const warnings=[],ports={home,env:{PDD_TRACE:'herdr'},stderr:{write:text=>warnings.push(text)}};
let calls=0;const reply={same:true},error=Object.assign(Error('private error'),{code:'ECONNREFUSED'});
const result=await traceHerdrRequest({operation:'workspace.list'},()=>{calls++;return reply;},ports);
let caught;try{await traceHerdrRequest({operation:'workspace.list'},()=>{calls++;throw error;},ports);}catch(e){caught=e;}
fs.realpathSync=original;syncBuiltinESMExports();
const rows=readHerdrTrace(ports);
console.log(JSON.stringify({validations,calls,sameReply:result===reply,sameError:caught===error,warnings,phases:rows.map(r=>r.phase),paired:rows.length===4&&rows[0].traceId===rows[1].traceId&&rows[2].traceId===rows[3].traceId}));`;
 const child=spawnSync(process.execPath,['--input-type=module','-e',script,p.home],{encoding:'utf8',timeout:15000});
 assert.equal(child.error,undefined);assert.equal(child.status,0,child.stderr);assert.equal(child.stderr,'');
 assert.deepEqual(JSON.parse(child.stdout),{validations:4,calls:2,sameReply:true,sameError:true,warnings:[],phases:['request','reply','request','error'],paired:true});
});
