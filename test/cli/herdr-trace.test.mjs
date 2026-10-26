import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {traceHerdrRequest,readHerdrTrace} from '../../src/herdr-trace.mjs';

function fixture(t){const home=fs.mkdtempSync(join(tmpdir(),'pdd-herdr-trace-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));return {home,env:{PDD_TRACE:'herdr'},now:()=>assert.fail('Workflow clocks are not diagnostic clocks')};}
const path=p=>join(p.home,'.pdd/logs/herdr-trace.jsonl');
const secret='sk-proj-syntheticCredential123';

test('disabled tracing has no filesystem effect and preserves exact results and errors',async t=>{
  const p=fixture(t),reply={unknown:{retained:true}},error=Object.assign(Error(secret),{code:'EACCES'});let count=0;
  for(const env of [{},{PDD_TRACE:'git'},{PDD_TRACE:'HERDR'}]){
    assert.equal(await traceHerdrRequest({operation:'tab.create',request:{prompt:secret}},()=>{count++;return reply;},{...p,env}),reply);
    await assert.rejects(traceHerdrRequest({operation:'pane.run'},()=>{count++;throw error;},{...p,env}),e=>e===error);
  }
  assert.equal(count,6);assert.equal(fs.existsSync(join(p.home,'.pdd')),false);assert.deepEqual(readHerdrTrace(p),[]);
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
