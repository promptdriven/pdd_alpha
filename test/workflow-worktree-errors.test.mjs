import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {allocateIssueWorktree,lookupIssueWorktree} from '../src/workflow-worktree.mjs';
import * as diagnostics from '../src/git-trace.mjs';
import vectors from '../vectors/cli/workflow-worktree.json' with {type:'json'};
const execute=promisify(execFile);
const auth=vectors.cases.find(c=>c.id==='fetch-auth-diagnostic');
async function fixture(t) {
 const temp=await realpath(await mkdtemp(join(tmpdir(),'pdd-git-failure-')));t.after(()=>rm(temp,{recursive:true,force:true}));
 const cwd=join(temp,'project'),home=join(temp,'home');await mkdir(cwd);await mkdir(home,{mode:0o700});
 const gitAt=(path,...args)=>execute('git',args,{cwd:path,encoding:'utf8',env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}});
 const git=(...args)=>gitAt(cwd,...args);
 await git('init','-b','main');await git('config','user.name','Synthetic failure');await git('config','user.email','test@example.invalid');
 await writeFile(join(cwd,'file'),'base\n');await git('add','file');await git('commit','-m','base');
 await git('remote','add','origin','https://github.com/example/project.git');
 const head=(await git('rev-parse','HEAD')).stdout.trim();await git('update-ref','refs/remotes/origin/main',head);
 await writeFile(join(cwd,'file'),'dirty retained\n');await writeFile(join(cwd,'untracked'),'untracked retained\n');
 const snapshot=async()=>({status:(await git('status','--porcelain=v1','-z')).stdout,refs:(await git('show-ref')).stdout,worktrees:(await git('worktree','list','--porcelain')).stdout,config:await readFile(join(cwd,'.git/config'),'utf8')});
 return {cwd,home,git,gitAt,head,snapshot,input:{cwd,repository:'example/project',issueNumber:17,runId:randomUUID(),workflowName:'small-change',baseRef:'refs/remotes/origin/main'}};
}
for(const rejected of [false,true])for(const trace of [false,true])test(`auth fetch reports recorded real step/stderr without retry or work loss (${rejected?'reject':'return'}, trace ${trace})`,async t=>{
 const f=await fixture(t),before=await f.snapshot(),calls=[];
 const ports={home:f.home,env:{PDD_TRACE:trace?'git':''},execFile:async(file,args,opts)=>{
  assert.equal(file,'git');assert.deepEqual(opts,{cwd:f.cwd});calls.push([...args]);
  if(args[0]==='fetch') {const failure={code:128,stdout:'stdout must not be printed',stderr:auth.given.stderr};if(rejected)throw Object.assign(Error('unproved exception ghp_private123'),failure);return failure;}
  return f.git(...args);
 }};
 const r=await allocateIssueWorktree(f.input,ports);
 assert.equal(r.state,auth.expected.state);assert.equal(r.assignment,null);
 for(const expected of auth.expected.messageIncludes)assert.ok(r.message.includes(expected),r.message);
 assert.match(r.message,/128/);assert.doesNotMatch(r.message,/stdout must|unproved exception|private123/);
 assert.equal(calls.filter(a=>a[0]==='fetch').length,1);assert.equal(calls.filter(a=>a[0]==='worktree'&&a[1]==='add').length,0);
 assert.ok(calls.every(a=>!['config','credential','reset','clean','checkout','switch'].includes(a[0])));
 assert.deepEqual(await readdir(join(f.cwd,'.git/pdd/worktree-assignments/runs')),[]);
 assert.deepEqual(await readdir(join(f.cwd,'.git/pdd/worktree-assignments/issues')),[]);
 assert.deepEqual(await f.snapshot(),before);assert.equal(await readFile(join(f.cwd,'file'),'utf8'),'dirty retained\n');assert.equal(await readFile(join(f.cwd,'untracked'),'utf8'),'untracked retained\n');
 if(trace){const rows=await diagnostics.readGitTrace({home:f.home});const failed=rows.at(-1);assert.deepEqual(failed.argv,['git','fetch','origin','main']);assert.equal(failed.exit,128);assert.equal(failed.stderr,auth.given.stderr);assert.equal(rows.length,calls.length);}
 else assert.deepEqual(await readdir(f.home),[]);
});
test('lookup exposes the safe failing read step while remaining read-only',async t=>{
 const f=await fixture(t),before=await f.snapshot(),calls=[];
 const r=await lookupIssueWorktree(f.input,{home:f.home,env:{PDD_TRACE:'git'},execFile:async(file,args)=>{calls.push(args);throw Object.assign(Error('opaque private text'),{code:128,stderr:'fatal: not a git repository (or any of the parent directories): .git\n'});}});
 assert.equal(r.state,'recovery_required');assert.equal(r.assignment,null);assert.match(r.message,/git rev-parse --show-toplevel failed/);assert.match(r.message,/fatal: not a git repository/);
 assert.equal(calls.length,1);assert.deepEqual(await readdir(f.home),[]);assert.deepEqual(await f.snapshot(),before);
});
test('public Git formatter shares privacy projection, omits unproved text and bounds diagnostics',()=>{
 const argv=['fetch','https://user:secretPassword@github.com/example/project.git?token=querySecret#fragmentSecret','ghp_privateToken123','--password','argumentSecret'];
 const response={code:128,stdout:'stdoutSecret',stderr:"fatal: Authentication failed for 'https://user:secretPassword@github.com/example/project.git?token=querySecret'\nopaqueSecret\n",message:'exceptionSecret'};
 const original=structuredClone({argv,response});const value=diagnostics.formatGitFailure({argv},response);
 for(const secret of ['secretPassword','querySecret','fragmentSecret','privateToken123','argumentSecret','stdoutSecret','opaqueSecret','exceptionSecret'])assert.ok(!value.includes(secret),secret);
 assert.match(value,/git fetch https:\/\/github.com\/example\/project.git/);assert.match(value,/Authentication failed/);assert.match(value,/\[redacted\]/);assert.match(value,/gh auth setup-git/);assert.deepEqual({argv,response},original);
 const large=diagnostics.formatGitFailure({argv:['fetch','x'.repeat(9000)+'tailSecret']},{stderr:'x'.repeat(9000)+'stderrSecret'});
 assert.ok(large.length<1000);assert.doesNotMatch(large,/tailSecret|stderrSecret/);
 assert.doesNotMatch(diagnostics.formatGitFailure({argv:['fetch','origin\nmain']},response),/[\r\n\t]/);
});
test('unknown rejected exit and rejected zero retain failure context without guessing an exit or stderr',()=>{
 for(const response of [{message:'hidden'},{code:0,stderr:'unproved secret'},{code:'ENOENT'}]){
  const message=diagnostics.formatGitFailure({argv:['fetch','origin','main']},response);
  assert.match(message,/git fetch origin main failed/);assert.doesNotMatch(message,/hidden|unproved secret/);
 }
});
for(const lostReply of [false,true])test(`add failure retains original intent and never repeats add; proven ready wins (${lostReply?'lost reply':'refused add'})`,async t=>{
 const f=await fixture(t),calls=[],stderr="fatal: 'synthetic worktree' already exists\n";
 const ports={home:f.home,env:{PDD_TRACE:''},execFile:async(file,args,options)=>{
  calls.push([...args]);
  if(args[0]==='fetch'){await writeFile(join(f.cwd,'.git/FETCH_HEAD'),f.head+'\n');return {stdout:''};}
  if(args[0]==='worktree'&&args[1]==='add'){
   if(lostReply)await f.git(...args);
   throw Object.assign(Error('unproved add exception'),{code:128,stderr,stdout:'stdout not public'});
  }
  return f.gitAt(options.cwd,...args);
 }};
 const first=await allocateIssueWorktree(f.input,ports);
 assert.equal(first.state,lostReply?'ready':'recovery_required',first.message);
 assert.equal(calls.filter(a=>a[0]==='worktree'&&a[1]==='add').length,1);
 const run=join(f.cwd,'.git/pdd/worktree-assignments/runs',f.input.runId+'.json'),claim=join(f.cwd,'.git/pdd/worktree-assignments/issues/17.json');
 const intent=await readFile(run);assert.deepEqual(await readFile(claim),intent);
 if(lostReply){assert.ok(first.assignment);assert.doesNotMatch(first.message,/failed|synthetic worktree/);}
 else {assert.equal(first.assignment,null);assert.match(first.message,/git worktree add -b/);assert.ok(first.message.includes(stderr.trim()));}
 calls.length=0;const second=await allocateIssueWorktree(f.input,ports);
 assert.equal(second.state,first.state);assert.equal(calls.filter(a=>a[0]==='worktree'&&a[1]==='add').length,0);assert.equal(calls.filter(a=>a[0]==='fetch').length,0);
 assert.deepEqual(await readFile(run),intent);assert.deepEqual(await readFile(claim),intent);assert.equal(await readFile(join(f.cwd,'file'),'utf8'),'dirty retained\n');
});
test('unexpected branch-probe exit keeps conflict and reports its safe Git cause without a claim or add',async t=>{
 const f=await fixture(t),before=await f.snapshot(),calls=[];
 const r=await allocateIssueWorktree(f.input,{home:f.home,env:{PDD_TRACE:''},execFile:async(file,args,options)=>{
  calls.push([...args]);
  if(args[0]==='fetch'){await writeFile(join(f.cwd,'.git/FETCH_HEAD'),f.head+'\n');return {stdout:''};}
  if(args[0]==='show-ref')return {code:128,stdout:'',stderr:'fatal: not a git repository (or any of the parent directories): .git\n'};
  return f.gitAt(options.cwd,...args);
 }});
 assert.equal(r.state,'conflict');assert.equal(r.assignment,null);assert.match(r.message,/git show-ref --verify --quiet refs\/heads\/pdd\//);assert.match(r.message,/fatal: not a git repository/);
 assert.equal(calls.filter(a=>a[0]==='worktree'&&a[1]==='add').length,0);assert.deepEqual(await readdir(join(f.cwd,'.git/pdd/worktree-assignments/runs')),[]);assert.deepEqual(await readdir(join(f.cwd,'.git/pdd/worktree-assignments/issues')),[]);assert.deepEqual(await f.snapshot(),before);assert.deepEqual(await readdir(f.home),[]);
});
