import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {cleanWorkflowRuns} from '../../src/workflow-clean.mjs';
import vectors from '../../vectors/cli/workflow-clean.json' with {type:'json'};
const exec=promisify(execFile),DAY=86400000,now=Date.parse('2026-10-25T00:00:00Z');
async function fixture(t,options={}) {
  const tmp=await fs.mkdtemp(join(tmpdir(),'pdd-clean-')),cwd=join(tmp,'repo'),home=join(tmp,'home');await fs.mkdir(cwd);await fs.mkdir(home);
  t.after(()=>fs.rm(tmp,{recursive:true,force:true}));
  const git=async(root,...args)=>(await exec('git',args,{cwd:root})).stdout;
  await git(cwd,'init','-b','main');await git(cwd,'config','user.email','test@example.invalid');await git(cwd,'config','user.name','Test');
  await fs.writeFile(join(cwd,'tracked.txt'),'retained\n');await git(cwd,'add','.');await git(cwd,'commit','-m','base');
  const runId=randomUUID(),worktreePath=join(tmp,'worktree'),branch='pdd/test-1';await git(cwd,'worktree','add','-b',branch,worktreePath);
  const commonDir=join(cwd,'.git'),gitDir=(await git(worktreePath,'rev-parse','--absolute-git-dir')).trim(),head=(await git(worktreePath,'rev-parse','HEAD')).trim();
  const assignment={version:1,runId,commonDir,gitDir,worktreePath,branch,sourceRoot:cwd,repository:'example/app',issueNumber:1,baseRef:'main',baseSha:head,workflowName:'feature'};
  const index=join(commonDir,'pdd','worktree-assignments');await fs.mkdir(join(index,'runs'),{recursive:true});await fs.mkdir(join(index,'issues'));
  await fs.writeFile(join(index,'runs',runId+'.json'),JSON.stringify(assignment));await fs.link(join(index,'runs',runId+'.json'),join(index,'issues','1.json'));
  const runDir=join(gitDir,'pdd','workflows',runId);await fs.mkdir(runDir,{recursive:true});await fs.mkdir(join(runDir,'artifacts'));await fs.writeFile(join(runDir,'artifacts','evidence.txt'),'exact evidence\n');
  const state={version:2,seq:1,runId,root:worktreePath,gitDir,assignment,name:'feature',agent:'codex',definition:{name:'feature',stages:[]},definitions:[],index:0,completed:[{kind:'pr',pr:{number:2,url:'https://github.com/example/app/pull/2'}}],controlState:'completed',pending:null};
  const write=async()=>fs.writeFile(join(runDir,'journal.jsonl'),JSON.stringify({seq:1,event:'completed',state})+'\n');await write();
  const held=[],calls=[];
  const ports={home,lookupIssueWorktree:async()=>({state:'ready',assignment}),withWorkflowLock:async({path},fn)=>{held.push(path);try{return await fn();}finally{assert.equal(held.pop(),path);}},inspectWorkflowLock:async()=>options.claim??'free',execFile:async(file,args,opts)=>{
    calls.push([file,args]);
    if(file==='gh')return {stdout:JSON.stringify({number:2,url:'https://github.com/example/app/pull/2',state:options.merged===false?'CLOSED':'MERGED',closedAt:new Date(now-(options.days??8)*DAY).toISOString()})};
    if(args[0]==='ls-remote') {if(options.remoteUnavailable)throw Error('remote unavailable');return {stdout:`${options.unpushed?'0'.repeat(40):head}\trefs/heads/${branch}\n`};}
    if(args[0]==='worktree'&&args[1]==='remove') {
      assert.equal(held.length,1);assert.match(held[0],/run-lifecycle/);
      assert.equal(await fs.readFile(join(home,'.pdd','runs','archive',runId,'artifacts','evidence.txt'),'utf8'),'exact evidence\n');
      assert.equal(JSON.parse(await fs.readFile(join(commonDir,'pdd','run-lifecycle',runId+'.json'),'utf8')).state,'removing');
    }
    return exec(file,args,opts);
  }};
  if(options.race) {let count=0;const orig=ports.lookupIssueWorktree;ports.lookupIssueWorktree=async input=>{if(++count===4)await fs.writeFile(join(worktreePath,'new.txt'),'new work');return orig(input);};}
  return {tmp,cwd,home,worktreePath,runId,runDir,state,write,ports,calls,held};
}
for(const c of vectors.cases)test(c.id,async t=>{
  const g=c.given,options={days:g.prClosedDays??g.prMergedDays??8,unpushed:!!(g.uniqueUnpushedCommits||g.uniqueWork||g.unpushedCommits),merged:g.merged,remoteUnavailable:g.remoteRead==='failed',race:g.newDirtyFileBeforeRemove};
  const f=await fixture(t,options);
  if(g.freeGB!==undefined)f.ports.statfs=async()=>({bavail:g.freeGB*1e9,bsize:1});
  if(g.controlState) {f.state.controlState=g.controlState;await f.write();}
  if(g.untracked)await fs.writeFile(join(f.worktreePath,'notes.txt'),'keep');
  if(g.ignoredUnique) {await fs.writeFile(join(f.cwd,'.git','info','exclude'),'local-output.bin\n');await fs.writeFile(join(f.worktreePath,'local-output.bin'),'keep');}
  if(g.archiveFsync)f.ports.appendRunIndex=async()=>({ok:false,code:'ENOSPC'});
  if(g.indexAppend)f.ports.appendRunIndex=async()=>({ok:false,code:'EIO'});
  const result=await cleanWorkflowRuns({cwd:f.cwd,now,dryRun:g.dryRun??false},f.ports);
  if(c.expected.removed!==undefined)assert.equal(result.removed.length>0,c.expected.removed,JSON.stringify(result));
  if(c.expected.alert)assert.ok(result.warnings.some(w=>w.includes('below 2 GB')));
  if(c.expected.reason)assert.ok(result.retained[0].reason.includes(c.expected.reason));
  if(c.expected.personChoice)assert.match(result.retained[0].reason,/Needs you/);
  if(c.expected.archiveRetained)await fs.access(join(f.home,'.pdd','runs','archive',f.runId,'journal.jsonl'));
  if(c.expected.originalJournalIntact)await fs.access(join(f.runDir,'journal.jsonl'));
  if(c.expected.worktreeRemoves===0)assert.ok(!f.calls.some(([file,args])=>file==='git'&&args[0]==='worktree'&&args[1]==='remove'));
  if(c.expected.fileWrites===0)assert.equal(await fs.stat(join(f.home,'.pdd')).then(()=>true,()=>false),false);
  assert.equal(f.held.length,0);
  if(!result.removed.length)await fs.access(f.worktreePath);
});
test('damaged historical record retains even when the last record looks terminal',async t=>{
  const f=await fixture(t);await fs.writeFile(join(f.runDir,'journal.jsonl'),'{bad}\n'+JSON.stringify({seq:1,event:'done',state:f.state})+'\n');
  const result=await cleanWorkflowRuns({cwd:f.cwd,now},f.ports);assert.equal(result.removed.length,0);await fs.access(f.worktreePath);
});
test('busy lifecycle never enters controller/stage or removes a worktree',async t=>{
  const f=await fixture(t);f.ports.withWorkflowLock=async()=>{throw Error('busy');};
  assert.equal((await cleanWorkflowRuns({cwd:f.cwd,now},f.ports)).removed.length,0);await fs.access(f.worktreePath);
});
test('archive failure leaves original evidence intact and does not remove',async t=>{
  const f=await fixture(t);await fs.mkdir(join(f.home,'.pdd','runs'),{recursive:true});await fs.writeFile(join(f.home,'.pdd','runs','archive'),'blocked');
  assert.equal((await cleanWorkflowRuns({cwd:f.cwd,now},f.ports)).removed.length,0);assert.equal(await fs.readFile(join(f.runDir,'artifacts','evidence.txt'),'utf8'),'exact evidence\n');
});

test('actual local remote retention refuses an unpushed commit and permits cleanup only after nonforce push',async t=>{
  const f=await fixture(t),remote=join(f.tmp,'remote.git');await exec('git',['init','--bare',remote],{cwd:f.cwd});await exec('git',['remote','add','origin',remote],{cwd:f.cwd});
  await exec('git',['push','origin','pdd/test-1'],{cwd:f.worktreePath});await fs.writeFile(join(f.worktreePath,'tracked.txt'),'unique local commit\n');await exec('git',['add','.'],{cwd:f.worktreePath});await exec('git',['commit','-m','Unpushed work'],{cwd:f.worktreePath});
  const original=f.ports.execFile;f.ports.execFile=(file,args,opts)=>args[0]==='ls-remote'?exec(file,args,opts):original(file,args,opts);
  const retained=await cleanWorkflowRuns({cwd:f.cwd,now},f.ports);assert.equal(retained.removed.length,0);assert.match(retained.retained[0].reason,/unpushed work/);await fs.access(f.worktreePath);
  await exec('git',['push','origin','pdd/test-1'],{cwd:f.worktreePath});const removed=await cleanWorkflowRuns({cwd:f.cwd,now},f.ports);assert.equal(removed.removed.length,1,JSON.stringify(removed));assert.equal(await fs.stat(f.worktreePath).then(()=>true,()=>false),false);assert.equal((await exec('git',['show-ref','--verify','refs/heads/pdd/test-1'],{cwd:f.cwd})).stdout.length>0,true,'branch retained');
});

test('dry run checks live native claims without creating missing guards or archive metadata',async t=>{
  const f=await fixture(t),nativeId=randomUUID(),claim=join(f.home,'.pdd','claims',`codex-${nativeId}.lock`);await fs.mkdir(join(f.home,'.pdd','claims'),{recursive:true});await fs.writeFile(claim,'');f.state.completed.push({backend:{phase:'closed',agent:'codex',attemptId:randomUUID(),backendGen:2,nativeSession:{kind:'id',value:nativeId}}});await f.write();
  const inspected=[];f.ports.inspectWorkflowLock=async({path})=>{inspected.push(path);return path===claim?'held':'free';};
  const result=await cleanWorkflowRuns({cwd:f.cwd,now,dryRun:true},f.ports);assert.equal(result.removed.length,0);assert.match(result.retained[0].reason,/session claim/);assert.deepEqual(inspected,[claim]);assert.equal(await fs.stat(join(f.home,'.pdd','runs')).then(()=>true,()=>false),false);
});

test('unresolved controller launches retain work until the exact stopped controller is proved',async t=>{
  const f=await fixture(t);await fs.mkdir(join(f.runDir,'controller-launch'));f.ports.readControllerLaunches=async()=>[{phase:'proved',launchId:randomUUID()}];
  let result=await cleanWorkflowRuns({cwd:f.cwd,now},f.ports);assert.equal(result.removed.length,0);assert.match(result.retained[0].reason,/unresolved controller/);
  f.ports.verifyStoppedController=async()=>true;result=await cleanWorkflowRuns({cwd:f.cwd,now},f.ports);assert.equal(result.removed.length,1,JSON.stringify(result));
});
