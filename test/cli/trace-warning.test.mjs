import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {traceHerdrRequest,readHerdrTrace} from '../../src/herdr-trace.mjs';
import {traceGitCommand,readGitTrace} from '../../src/git-trace.mjs';
const command={argv:['fetch','origin','main'],cwd:'/synthetic/project'};
const capture=()=>({text:'',write(s){this.text+=s;}});
async function fixture(t,unsafe=false){
 const home=await fs.realpath(await fs.mkdtemp(join(tmpdir(),'pdd-warning-')));t.after(()=>fs.rm(home,{recursive:true,force:true}));
 if(unsafe){await fs.mkdir(join(home,'.pdd'),{mode:0o700});await fs.chmod(join(home,'.pdd'),0o775);}
 return {home,env:{PDD_TRACE:'herdr,git'},stderr:capture()};
}
test('unsafe .pdd gives one combined-sink warning with reason and fix, retaining outcomes and permissions',async t=>{
 const p=await fixture(t,true),value={same:true},error=Error('private token and path');let calls=0;
 for(let i=0;i<2;i++)assert.equal(await traceHerdrRequest({operation:'pane.run'},()=>{calls++;return value;},p),value);
 await assert.rejects(traceGitCommand(command,()=>{calls++;throw error;},p),e=>e===error);
 assert.equal(calls,3);assert.equal(p.stderr.text.split('\n').filter(Boolean).length,1);
 assert.match(p.stderr.text,/^Warning: PDD_TRACE could not write: ~\/\.pdd is group- or world-writable\. Fix: run chmod 700 ~\/\.pdd\.\n$/);
 assert.doesNotMatch(p.stderr.text,/private token|pdd-warning-/);
 assert.equal((await fs.stat(join(p.home,'.pdd'))).mode&0o777,0o775);
 assert.deepEqual(await fs.readdir(join(p.home,'.pdd')),[]);
});
test('concurrent enabled Herdr and Git failures share one warning without repeating actions',async t=>{
 const p=await fixture(t,true);let calls=0;
 await Promise.all(Array.from({length:10},(_,i)=>i%2?traceGitCommand(command,()=>{calls++;return {};},p):traceHerdrRequest({operation:'pane.run'},()=>{calls++;return {};},p)));
 assert.equal(calls,10);assert.equal(p.stderr.text.split('\n').filter(Boolean).length,1);
});
test('disabled writes and read-only reports remain silent on an unsafe home',async t=>{
 const p=await fixture(t,true),off={...p,env:{PDD_TRACE:''}};
 assert.equal(await traceGitCommand(command,()=>17,off),17);
 assert.equal(await traceHerdrRequest({operation:'pane.run'},()=>18,off),18);
 assert.deepEqual(readHerdrTrace(p),[]);assert.deepEqual(await readGitTrace(p),[]);
 assert.equal(p.stderr.text,'');assert.deepEqual(await fs.readdir(join(p.home,'.pdd')),[]);
});
test('successful trace writes do not warn and retain both logs',async t=>{
 const p=await fixture(t);
 await traceHerdrRequest({operation:'pane.run'},()=>({ok:true}),p);await traceGitCommand(command,()=>({code:0}),p);
 assert.equal(p.stderr.text,'');assert.equal(readHerdrTrace(p).length,2);assert.equal((await readGitTrace(p)).length,1);
});
test('a busy Herdr sink warns once with guidance and preserves the existing lock',async t=>{
 const p=await fixture(t);await fs.mkdir(join(p.home,'.pdd/logs'),{recursive:true,mode:0o700});
 const lock=join(p.home,'.pdd/logs/herdr-trace.jsonl.lock');await fs.writeFile(lock,'retained',{mode:0o600});
 for(let i=0;i<2;i++)assert.equal(await traceHerdrRequest({operation:'pane.run'},()=>19,p),19);
 assert.equal(p.stderr.text.split('\n').filter(Boolean).length,1);assert.match(p.stderr.text,/busy.*Fix:.*writer.*lock/);
 assert.equal(await fs.readFile(lock,'utf8'),'retained');
});
test('unsafe trace file warning does not follow aliases or print target data',async t=>{
 const p=await fixture(t);await fs.mkdir(join(p.home,'.pdd/logs'),{recursive:true,mode:0o700});
 const target=join(p.home,'private-target');await fs.writeFile(target,'synthetic-secret',{mode:0o600});
 await fs.symlink(target,join(p.home,'.pdd/logs/git-trace.jsonl'));
 assert.equal(await traceGitCommand(command,()=>23,p),23);
 assert.match(p.stderr.text,/unsafe.*file.*Fix:.*600/);assert.doesNotMatch(p.stderr.text,/private-target|synthetic-secret/);
 assert.equal(await fs.readFile(target,'utf8'),'synthetic-secret');
});
test('safe warning reasons never print raw errors and a broken stderr cannot replace an outcome',async()=>{
 const {warnTraceWriteFailure}=await import('../../src/trace-warning.mjs');
 for(const [error,expected] of [[{code:'ENOSPC',message:'secret'},/space|quota/],[{code:'EACCES',message:'secret'},/permission/i],[Error('secret'),/I\/O/]]){
  const stderr=capture();warnTraceWriteFailure(error,{stderr});warnTraceWriteFailure(error,{stderr});
  assert.equal(stderr.text.split('\n').filter(Boolean).length,1);assert.match(stderr.text,expected);assert.match(stderr.text,/Fix:/);assert.doesNotMatch(stderr.text,/secret/);
 }
 let calls=0;const stderr={write(){calls++;throw Error('broken');}};
 assert.doesNotThrow(()=>{warnTraceWriteFailure(new Proxy({},{get(){throw Error('hostile');}}),{stderr});warnTraceWriteFailure({}, {stderr});});
 assert.equal(calls,1);
});
test('enabled trace failure reaches real process stderr once without an injected stream',async t=>{
 const p=await fixture(t,true);
 const code=`import {traceHerdrRequest} from ${JSON.stringify(new URL('../../src/herdr-trace.mjs',import.meta.url).href)};
 for(let i=0;i<2;i++)await traceHerdrRequest({operation:'pane.run'},()=>({ok:true}),{home:process.argv[1],env:{PDD_TRACE:'herdr'}});`;
 const r=spawnSync(process.execPath,['--input-type=module','-e',code,p.home],{encoding:'utf8',timeout:5000});
 assert.equal(r.error,undefined);assert.equal(r.status,0);assert.equal(r.stdout,'');assert.equal(r.stderr.split('\n').filter(Boolean).length,1);assert.match(r.stderr,/PDD_TRACE.*group- or world-writable.*Fix:.*chmod 700/);
});
test('asynchronous broken stderr preserves both sink actions and identities without leaking listeners',async t=>{
 const p=await fixture(t,true);
 for(const first of ['herdr','git'])for(const mode of ['auto-destroy','keep-open','destroy-without-error','delayed-error','delayed-without-error','delayed-close-without-error'])for(const existing of [false,true]){
  const code=`import assert from 'node:assert/strict';
   import {Writable} from 'node:stream';
   import {traceHerdrRequest} from ${JSON.stringify(new URL('../../src/herdr-trace.mjs',import.meta.url).href)};
   import {traceGitCommand} from ${JSON.stringify(new URL('../../src/git-trace.mjs',import.meta.url).href)};
   const first=${JSON.stringify(first)},mode=${JSON.stringify(mode)},existing=${existing};
   let writes=0,errors=0,calls=0,destroySettled;
   const destruction=new Promise(resolve=>{destroySettled=resolve;});
   const stderr=new Writable({autoDestroy:mode!=='keep-open',emitClose:mode.includes('close'),write(chunk,encoding,done){
    writes++;if(mode.includes('without-error'))this.destroy();
    setImmediate(()=>done(Object.assign(Error('SYNTHETIC_ASYNC_STDERR_FAILURE'),{code:'EPIPE'})));
   },destroy(error,done){
    const finish=()=>{done(error);destroySettled();};
    if(mode.startsWith('delayed'))setTimeout(finish,30);else finish();
   }});
   const listener=()=>{errors++;};if(existing)stderr.on('error',listener);
   const prior=stderr.rawListeners('error'),closePrior=stderr.rawListeners('close');
   const ports={home:process.argv[1],env:{PDD_TRACE:'herdr,git'},stderr},value={},failure=Error('original action');
   const herdr=action=>traceHerdrRequest({operation:'pane.run'},action,ports);
   const git=action=>traceGitCommand({argv:['status'],cwd:'/synthetic'},action,ports);
   const sinks=first==='herdr'?[herdr,git]:[git,herdr];
   assert.equal(await sinks[0](()=>{calls++;return value;}),value);
   await assert.rejects(sinks[1](()=>{calls++;throw failure;}),error=>error===failure);
   if(mode!=='keep-open')await destruction;
   await new Promise(resolve=>setImmediate(resolve));
   const deadline=Date.now()+1000;
   while(stderr.listenerCount('error')!==prior.length||stderr.listenerCount('close')!==closePrior.length){
    assert.ok(Date.now()<deadline,'warning observers were not released after actual stream settlement');
    await new Promise(resolve=>setTimeout(resolve,5));
   }
   assert.equal(calls,2);assert.equal(writes,1);
   assert.equal(errors,existing&&!mode.includes('without-error')?1:0);
   assert.deepEqual(stderr.rawListeners('error'),prior);assert.deepEqual(stderr.rawListeners('close'),closePrior);
   process.stdout.write('retained both actions and stream listeners\\n');`;
  const r=spawnSync(process.execPath,['--input-type=module','-e',code,p.home],{encoding:'utf8',timeout:5000});
  assert.equal(r.error,undefined);assert.equal(r.status,0,`${first}/${mode}/${existing}: ${r.stderr}`);
  assert.equal(r.stdout,'retained both actions and stream listeners\n');assert.equal(r.stderr,'');
 }
});
test('successful asynchronous warning writes remove only their own observers and remain deduplicated',async()=>{
 const {Writable}=await import('node:stream');const {warnTraceWriteFailure}=await import('../../src/trace-warning.mjs');
 let writes=0,errors=0;const stderr=new Writable({write(chunk,encoding,done){writes++;setImmediate(done);}});
 const listener=()=>{errors++;};stderr.on('error',listener);const prior=stderr.rawListeners('error');
 warnTraceWriteFailure({code:'ENOSPC'},{stderr});warnTraceWriteFailure({code:'EACCES'},{stderr});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(writes,1);assert.deepEqual(stderr.rawListeners('error'),prior);
 stderr.emit('error',Error('subsequent independent error'));assert.equal(errors,1);
});
test('unavailable destroyed stderr cannot replace a command or leave a warning listener',async()=>{
 const {Writable}=await import('node:stream');const {warnTraceWriteFailure}=await import('../../src/trace-warning.mjs');
 let writes=0;const stderr=new Writable({write(chunk,encoding,done){writes++;done();}});stderr.destroy();
 const prior=stderr.rawListeners('error');assert.doesNotThrow(()=>warnTraceWriteFailure({code:'ENOSPC'},{stderr}));
 await new Promise(resolve=>setImmediate(resolve));assert.equal(writes,0);assert.deepEqual(stderr.rawListeners('error'),prior);
});
test('a synchronous Writable throw leaves existing stream listeners intact',async()=>{
 const {Writable}=await import('node:stream');const {warnTraceWriteFailure}=await import('../../src/trace-warning.mjs');
 const stderr=new Writable({write(){throw Error('synthetic private stream failure');}});
 const listener=()=>{};stderr.on('error',listener);const prior=stderr.rawListeners('error');
 assert.doesNotThrow(()=>warnTraceWriteFailure({code:'ENOSPC'},{stderr}));
 assert.deepEqual(stderr.rawListeners('error'),prior);
});
