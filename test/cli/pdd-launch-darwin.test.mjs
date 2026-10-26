import test from 'node:test';
import assert from 'node:assert/strict';
import {localProcessProof,reconcileStartup} from '../../src/pdd-launch.mjs';
import {readInstallRecord} from '../../src/install-record.mjs';
import {temporary,runtime,pointer,seed,start,pending} from './pkg-fixtures.mjs';
const birth='Mon Oct 26 10:00:00 2026';
const proof={pid:4242,birth:`darwin-lstart:${birth}`,bootId:'darwin-boottime:100:12'};
function osPorts({changedAt=Infinity,unreadable=false}={}){
 let reads=0;const calls=[],signals=[];
 return {platform:'darwin',calls,signals,get reads(){return reads;},killProcess(pid,signal){signals.push([pid,signal]);if(signal===0)throw Object.assign(Error('denied'),{code:'EPERM'});},
 async execFile(file,args,options){
  calls.push([file,args]);assert.equal(options.env.LC_ALL,'C');assert.equal(options.env.TZ,'UTC0');assert.equal(options.timeout,5000);assert.equal(options.maxBuffer,4096);
  if(unreadable)throw Object.assign(Error('denied'),{code:'EACCES'});
  if(file==='/usr/sbin/sysctl'){assert.deepEqual(args,['-n','kern.boottime']);return {stdout:'{ sec = 100, usec = 12 } Mon Oct 26\n'};}
  assert.equal(file,'/bin/ps');assert.deepEqual(args,['-p','4242','-o','lstart=']);
  return {stdout:++reads>=changedAt?'Mon Oct 26 10:01:00 2026\n':'Mon Oct 26   10:00:00 2026\n'};
 }};
}
test('Darwin local proof binds normalized lstart and boot with bounded stock commands',async()=>{
 const p=osPorts();assert.deepEqual(await localProcessProof(4242,p),proof);assert.deepEqual(p.signals,[]);
});
test('Darwin missing process requires ESRCH; unreadable or malformed proof remains unknown',async()=>{
 const p=osPorts({unreadable:true});await assert.rejects(localProcessProof(4242,p),/recovery_required/);assert.deepEqual(p.signals,[[4242,0]]);
 p.killProcess=()=>{throw Object.assign(Error('gone'),{code:'ESRCH'});};assert.equal(await localProcessProof(4242,p),null);
 for(const stdout of ['', '{}', '{ sec = bad, usec = 12 }'])await assert.rejects(localProcessProof(4242,{platform:'darwin',execFile:async()=>({stdout}),killProcess:()=>{}}),/recovery_required/);
 for(const pid of [0,-1,1,1.5,'4242'])await assert.rejects(localProcessProof(pid,p),/recovery_required/);
});
for(const [name,changedAt,elapsed,expected,signals]of [
 ['matching expired startup',Infinity,600000,null,[[4242,'SIGKILL']]],
 ['PID replacement at final proof',3,600000,'recovery_required',[]],
 ['live startup before deadline',Infinity,599999,null,[]]
])test(`Darwin deadline ${name} signals only the recorded process`,async t=>{
 const home=await temporary(t),rt=await runtime(home,'R2',{client:true});await pointer(home,'current',rt);
 assert.equal((await seed(home,{starts:{R2:start(rt,0,pending('A2',{bootId:proof.bootId,processProof:proof}))}})).code,null);
 const p=osPorts({changedAt});p.now=()=>({bootId:proof.bootId,elapsedMs:elapsed});p.readReady=()=>null;
 const r=await reconcileStartup({home,attemptId:'A2',deadline:true},p);assert.equal(r.code,expected);assert.deepEqual(p.signals,signals);
 assert.ok(p.calls.every(([file])=>file==='/bin/ps'||file==='/usr/sbin/sysctl'));
 const record=(await readInstallRecord({home})).value;assert.equal(record.starts.R2.consecutiveFailures,elapsed<600000?0:1);
 assert.equal(record.starts.R2.pending.attemptId,'A2');
});
test('Darwin unknown startup proof preserves the record without termination',async t=>{
 const home=await temporary(t),rt=await runtime(home,'R2',{client:true});await pointer(home,'current',rt);
 await seed(home,{starts:{R2:start(rt,0,pending('A2',{bootId:proof.bootId,processProof:proof}))}});
 const before=(await readInstallRecord({home})).value;const p=osPorts({unreadable:true});
 assert.equal((await reconcileStartup({home},p)).code,'recovery_required');assert.deepEqual((await readInstallRecord({home})).value,before);assert.deepEqual(p.signals,[[4242,0]]);
});
test('Linux local process proof retains procfs boot and start identity',async()=>{
 if(process.platform!=='linux')return;
 const p=await localProcessProof();assert.equal(p.pid,process.pid);assert.match(p.birth,/^\d+$/);assert.match(p.bootId,/^[a-f0-9-]+$/);
});
