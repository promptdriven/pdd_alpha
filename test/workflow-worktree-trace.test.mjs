import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {allocateIssueWorktree,lookupIssueWorktree} from '../src/workflow-worktree.mjs';
import {readGitTrace} from '../src/git-trace.mjs';
const execute=promisify(execFile);
const errorText="fatal: could not read Username for 'https://github.com': terminal prompts disabled\n";
for(const rejected of [true,false])test(`allocator trace captures recorded transport diagnostic (${rejected?'rejected':'returned'}128) and preserves all work/refusal/claim boundaries`,async t=>{
 const temp=await mkdtemp(join(tmpdir(),'pdd-traced-allocation-'));t.after(()=>rm(temp,{recursive:true,force:true}));
 const cwd=join(temp,'project'),home=join(temp,'home');await mkdir(cwd);await mkdir(home,{mode:0o700});
 const git=(...args)=>execute('git',args,{cwd,encoding:'utf8',env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}});
 await git('init','-b','main');await git('config','user.name','Synthetic allocator');await git('config','user.email','test@example.invalid');
 await writeFile(join(cwd,'file'),'base\n');await git('add','file');await git('commit','-m','base');await git('remote','add','origin','https://github.com/example/project.git');
 const head=(await git('rev-parse','HEAD')).stdout.trim();await git('update-ref','refs/remotes/origin/main',head);
 await writeFile(join(cwd,'file'),'dirty work retained\n');await writeFile(join(cwd,'untracked'),'untracked work retained\n');
 const snapshot=async()=>({status:(await git('status','--porcelain=v1','-z')).stdout,refs:(await git('show-ref')).stdout,worktrees:(await git('worktree','list','--porcelain')).stdout,config:await readFile(join(cwd,'.git/config'),'utf8')});
 const before=await snapshot(),calls=[],runId=randomUUID(),ports={home,env:{PDD_TRACE:'git'},execFile:async(file,args,options)=>{
  assert.equal(file,'git');assert.deepEqual(options,{cwd});calls.push([...args]);
  if(args[0]==='fetch'){const error={stdout:'',stderr:errorText,code:128};if(rejected)throw Object.assign(Error('recorded transport diagnostic'),error);return error;}
  return git(...args);
 }};
 const r=await allocateIssueWorktree({cwd,repository:'example/project',issueNumber:17,runId,workflowName:'small-change',baseRef:'refs/remotes/origin/main'},ports);
 assert.equal(r.state,'recovery_required');assert.equal(r.assignment,null);assert.equal(calls.filter(a=>a[0]==='fetch').length,1);assert.equal(calls.filter(a=>a[0]==='worktree'&&a[1]==='add').length,0);
 assert.deepEqual(await readdir(join(cwd,'.git/pdd/worktree-assignments/runs')),[]);assert.deepEqual(await readdir(join(cwd,'.git/pdd/worktree-assignments/issues')),[]);
 assert.deepEqual(await snapshot(),before);assert.equal(await readFile(join(cwd,'file'),'utf8'),'dirty work retained\n');assert.equal(await readFile(join(cwd,'untracked'),'utf8'),'untracked work retained\n');
 const rows=await readGitTrace({home});assert.equal(rows.length,calls.length);assert.deepEqual(rows.map(r=>r.argv),calls.map(a=>['git',...a]));assert.ok(rows.every(r=>r.cwd===cwd));
 const failed=rows.at(-1);assert.deepEqual(failed.argv,['git','fetch','origin','main']);assert.equal(failed.exit,128);assert.equal(failed.stderr,errorText);assert.equal(failed.outcome,rejected?'rejected':'returned');
 assert.doesNotMatch(r.message,/Username|https:/,'raw diagnostic stays out of the finite public result');
 const traceBytes=await readFile(join(home,'.pdd/logs/git-trace.jsonl'));
 assert.equal((await lookupIssueWorktree({cwd,runId},ports)).state,'recovery_required');
 assert.deepEqual(await readFile(join(home,'.pdd/logs/git-trace.jsonl')),traceBytes,'lookup remains read-only even with trace enabled');
});
