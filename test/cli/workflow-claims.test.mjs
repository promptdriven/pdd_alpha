import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {execFileSync,spawn} from 'node:child_process';
import {join} from 'node:path';
import {once} from 'node:events';
import vectors from '../../vectors/cli/workflow-claims.json' with {type:'json'};
import {claimWorkflowSession,promoteWorkflowClaim,withWorkflowLock,inspectWorkflowLock,runWorkflowClaimCommand} from '../../src/workflow-claims.mjs';
import {runId,attemptId,nativeId,folder,fakeLocks} from './runner-a-fixtures.mjs';
let helper,helperDir;
test.before(async()=>{helperDir=await fs.mkdtemp('/tmp/fleet-claims-helper-');helper=join(helperDir,'pdd-flock');execFileSync('cc',['-O2','-Wall','-Wextra','-Werror','-o',helper,new URL('../../src/workflow-flock.c',import.meta.url).pathname]);});
test.after(()=>fs.rm(helperDir,{recursive:true,force:true}));
const owner={runId,attemptId,backendGen:1};
for(const c of vectors.cases)test(`claims vector: ${c.id}`,async t=>{
  const home=await folder(t),ports={home,flockHelper:helper,validateOwner:async()=>({state:'current'})};
  const spec={kind:'codex',nativeSessionId:nativeId,owner};
  if(c.id==='unknown-lock')ports.flockHelper='/absent/helper';
  if(c.id==='late-restore-retired')ports.validateOwner=async()=>({state:'retired'});
  if(c.id==='successor-not-stopped'||c.id==='shared-switch-keeps-agent-exclusion')ports.validateOwner=async()=>({state:'current',oldProcessStopped:false});
  if(c.id==='provisional-id'||c.id.startsWith('provisional-promotion'))spec.nativeSessionId=null;
  const first=await claimWorkflowSession(spec,ports);t.after(()=>first.release?.());
  switch(c.id){
    case 'held-across-exec':{
      await first.release();const path=join(home,'.pdd','claims',`codex-${nativeId}.lock`);
      const child=spawn(helper,['exec',path,'--',process.execPath,'-e','process.stdout.write("working\\n");process.stdin.resume();'],{stdio:['pipe','pipe','pipe']});
      t.after(()=>child.kill());await once(child.stdout,'data');assert.equal(await inspectWorkflowLock({path},ports),'held');
      const second=await claimWorkflowSession(spec,ports);assert.equal(second.state,c.expected.secondState);assert.equal(child.exitCode,null);
      child.stdin.end();await once(child,'exit');assert.equal(await inspectWorkflowLock({path},ports),'free');break;
    }
    case 'process-exit':await first.release();assert.equal(await inspectWorkflowLock({path:first.path},ports),c.expected.kernelLock);assert.ok(await fs.stat(first.path));break;
    case 'pid-reuse':assert.equal(first.state,'owned');await first.release();assert.equal(await inspectWorkflowLock({path:first.path},ports),'free');break;
    case 'unknown-lock':assert.equal(first.state,c.expected.state);break;
    case 'provisional-id':assert.equal(first.state,'owned');assert.match(first.path,/stage-/);assert.equal(first.nativeSessionId,null);break;
    case 'late-restore-retired':assert.equal(first.state,c.expected.oldStart);break;
    case 'successor-not-stopped':case 'shared-switch-keeps-agent-exclusion':assert.notEqual(first.state,'owned');break;
    case 'same-live-reattach':assert.equal((await claimWorkflowSession(spec,ports)).state,'busy');assert.equal(first.owner.backendGen,1);break;
    case 'provisional-promotion-atomic':{
      const order=[];ports.bindClaim=async()=>{order.push('durable');assert.equal(await inspectWorkflowLock({path:first.path},ports),'held');return {ok:true};};
      const promoted=await promoteWorkflowClaim({claim:first,kind:'codex',nativeSessionId:nativeId},ports);assert.equal(promoted,first);assert.deepEqual(order,['durable']);assert.equal(await inspectWorkflowLock({path:join(home,'.pdd','claims',`codex-${nativeId}.lock`)},ports),'held');assert.equal(await inspectWorkflowLock({path:first.path},ports),'free');break;
    }
    case 'provisional-promotion-busy':{
      const other=await claimWorkflowSession({...spec,nativeSessionId:nativeId},ports);t.after(()=>other.release());
      ports.bindClaim=async()=>assert.fail('busy promotion cannot bind');assert.equal((await promoteWorkflowClaim({claim:first,kind:'codex',nativeSessionId:nativeId},ports)).state,'busy');assert.equal(await inspectWorkflowLock({path:first.path},ports),'held');break;
    }
  }
});
test('kernel lock reentry is local to the owning async call and leaves inode stable',async t=>{
  const home=await folder(t),path=join(home,'controller.lock'),ports={flockHelper:helper};
  await withWorkflowLock({path},async()=>{await withWorkflowLock({path},async()=>{},ports);assert.equal(await inspectWorkflowLock({path},ports),'held');},ports);
  const inode=(await fs.stat(path)).ino;assert.equal(await inspectWorkflowLock({path},ports),'free');assert.equal((await fs.stat(path)).ino,inode);
});
test('promotion failed durability retains provisional and newly acquired native claims',async t=>{
  const home=await folder(t),ports={home,flockHelper:helper,validateOwner:async()=>({state:'current'}),bindClaim:async()=>{throw Error('fsync failed');}};
  const claim=await claimWorkflowSession({kind:'claude',nativeSessionId:null,owner},ports);t.after(()=>claim.release());
  assert.equal((await promoteWorkflowClaim({claim,kind:'claude',nativeSessionId:nativeId},ports)).state,'uncertain');
  assert.equal(await inspectWorkflowLock({path:claim.path},ports),'held');assert.equal(await inspectWorkflowLock({path:join(home,'.pdd','claims',`claude-${nativeId}.lock`)},ports),'held');
});
test('generic claim entry uses argv and reports contention without invoking another CLI',async t=>{
  const home=await folder(t),ports={home,flockHelper:helper,validateOwner:async()=>({state:'current'}),stderr:{write:s=>assert.match(s,/already runs here/)}};
  const claim=await claimWorkflowSession({kind:'codex',nativeSessionId:nativeId,owner},ports);t.after(()=>claim.release());
  assert.equal((await runWorkflowClaimCommand([`codex:${nativeId}`,'--',process.execPath,'-e','process.exit(99)'],ports)).code,'busy');
  await claim.release();assert.equal((await runWorkflowClaimCommand([`codex:${nativeId}`,'--',process.execPath,'-e','process.exit(7)'],ports)).exitCode,7);
});
test('claim rejects path traversal, retired authority after lock, and unsupported helpers',async t=>{
  const home=await folder(t);assert.equal((await claimWorkflowSession({kind:'codex',nativeSessionId:'../x',owner},{home,acquireLock:()=>assert.fail()})).state,'uncertain');
  let n=0;assert.equal((await claimWorkflowSession({kind:'codex',nativeSessionId:nativeId,owner},{home,acquireLock:fakeLocks(),validateOwner:async()=>({state:++n===1?'current':'retired'})})).state,'retired');
});
test('promotion checks current generation again before binding an observed native id',async t=>{
  const home=await folder(t),ports={home,flockHelper:helper,validateOwner:async()=>({state:'current'}),bindClaim:async()=>assert.fail('retired owner cannot bind')};
  const claim=await claimWorkflowSession({kind:'codex',nativeSessionId:null,owner},ports);t.after(()=>claim.release());ports.validateOwner=async()=>({state:'retired'});
  assert.equal((await promoteWorkflowClaim({claim,kind:'codex',nativeSessionId:nativeId},ports)).state,'retired');assert.equal(await inspectWorkflowLock({path:claim.path},ports),'held');
});
