import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {cases,temporary,runtime,pointer,put,repo,seed} from './pkg-fixtures.mjs';
import {readWorkflowRuntime} from '../../src/workflow-runtime.mjs';
import {readWorkflowJournal} from '../../src/workflow-runner.mjs';
const execute=promisify(execFile);

async function packageFixture(root) {
  await fs.mkdir(join(root,'src'),{recursive:true});
  for(const name of (await fs.readdir(join(repo,'src'))).filter(n=>n.endsWith('.mjs')))
    await fs.copyFile(join(repo,'src',name),join(root,'src',name));
  for(const name of ['bin','docs','skills','.pdd','package.json'])
    await fs.cp(join(repo,name),join(root,name),{recursive:true});
  await fs.rename(join(root,'src/workflow-runner.mjs'),join(root,'src/workflow-runner-actual.mjs'));
  await fs.rename(join(root,'src/workflow-controller.mjs'),join(root,'src/workflow-controller-actual.mjs'));
  // Keep entry, CLI, preparation, freeze and controller real. Only command/lock
  // ports are offline stand-ins; no runtime descriptor is injected by this probe.
  await put(join(root,'src/workflow-runner.mjs'), `
import {prepareWorkflow as prepare} from './workflow-runner-actual.mjs';
import {withWorkflowLock,inspectWorkflowLock} from ${JSON.stringify(pathToFileURL(join(repo,'test/cli/workflow-test-lock.mjs')).href)};
import {execFile as callback} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFileSync,appendFileSync,renameSync} from 'node:fs';
import {resolve} from 'node:path';
const exec=promisify(callback);
export async function prepareWorkflow(input,ports){
 writeFileSync(process.env.PREPARE_INPUT,JSON.stringify({input,runtime:ports.runtime??null}));
 const execFile=async(file,args,opts)=>{
  appendFileSync(process.env.COMMANDS,JSON.stringify({file,args})+'\\n');
  if(file==='git'&&args[0]==='fetch'){
   const head=(await exec('git',['rev-parse','refs/remotes/origin/main'],opts)).stdout.trim();
   const path=resolve(opts.cwd,(await exec('git',['rev-parse','--git-path','FETCH_HEAD'],opts)).stdout.trim());
   writeFileSync(path+'.fixture',head+'\\n');renameSync(path+'.fixture',path);return {stdout:''};
  }
  if(file==='git'&&!['push','ls-remote'].includes(args[0]))return exec(file,args,opts);
  if(file==='gh'&&args[0]==='repo'&&args[1]==='view')return {stdout:JSON.stringify({nameWithOwner:'example/project',defaultBranchRef:{name:'main'},url:'https://github.com/example/project'})};
  if(file==='gh'&&args[0]==='api'&&args[1]==='repos/example/project/issues/17')return {stdout:JSON.stringify({number:17,html_url:'https://github.com/example/project/issues/17',title:'Small offline change',body:'Preserve the current result.',state:'OPEN',isPullRequest:false})};
  throw Error('Unexpected offline command');
 };
 const result=await prepare(input,{...ports,execFile,withWorkflowLock,inspectWorkflowLock});
 writeFileSync(process.env.PREPARE_RESULT,JSON.stringify(result));return result;
}
`);
  await put(join(root,'src/workflow-controller.mjs'), `
import {writeFileSync} from 'node:fs';
import {startWorkflowController as start} from './workflow-controller-actual.mjs';
export async function startWorkflowController(input,ports){
 writeFileSync(process.env.CONTROLLER,JSON.stringify({input,runtime:ports.runtime}));
 return start(input,ports);
}
`);
}

for(const c of await cases('bin-entry-runtime'))test(c.id,async t=>{
  const home=await temporary(t),cwd=join(home,'project'),local=join(home,'fetched package');
  await fs.mkdir(cwd);await packageFixture(local);
  const git=async(...args)=>(await execute('git',args,{cwd})).stdout.trim();
  await git('init','-b','main');await git('config','user.name','Synthetic');await git('config','user.email','synthetic@example.invalid');
  await put(join(cwd,'README.md'),'Preserved input.\n');await git('add','.');await git('commit','-m','initial');
  await git('remote','add','origin','https://github.com/example/project.git');await git('update-ref','refs/remotes/origin/main',await git('rev-parse','HEAD'));
  const tools=join(home,'tools');await fs.mkdir(tools);
  // SYNTHETIC OFFLINE native status only; every other invocation still refuses.
  await put(join(tools,'codex'),'#!/bin/sh\nprintf "<%s>\\n" "$@" >> "$NATIVE_STATUS_CALLS"\n[ "$#" = 2 ] && [ "$1" = login ] && [ "$2" = status ] || exit 1\nprintf "Logged in using ChatGPT\\n"\n',0o755);
  await put(join(tools,'herdr'),`#!/bin/sh
if [ "$*" != "--session default workspace list" ]; then exit 91; fi
printf '%s\\n' probe >> "$HERDR_PROBES"
printf '%s\\n' '{"result":{"workspaces":[]}}'
`,0o755);
  await put(join(tools,'systemd-run'),'#!/bin/sh\nprintf start >> "$HERDR_STARTS"\nexit 92\n',0o755);
  const paths=Object.fromEntries(['PREPARE_INPUT','PREPARE_RESULT','CONTROLLER','COMMANDS','HERDR_PROBES','HERDR_STARTS'].map(n=>[n,join(home,n+'.json')]));
  const nativeStatusCalls=join(home,'native-status-calls');
  const env={...process.env,HOME:home,PATH:tools+':'+process.env.PATH,...paths,NATIVE_STATUS_CALLS:nativeStatusCalls,PDD_PINNED_RUNTIME:'1'};
  let selected,entry=join(local,'bin/pdd.mjs');
  if(c.given.current){
    const version=JSON.parse(await fs.readFile(join(repo,'package.json'))).version;
    selected=await runtime(home,'R1',{version,nodeVersion:process.versions.node});
    selected.future=c.given.extension??{retained:true};await packageFixture(selected.versionRoot);
    await put(join(selected.versionRoot,'runtime.json'),JSON.stringify(selected));
    const current=c.given.current==='R2'?await runtime(home,'R2',{version,nodeVersion:process.versions.node}):selected;
    await pointer(home,'current',current);
    await seed(home);
    if(c.given.entry==='R1')entry=selected.bin;
    if(c.given.invalidNode)await put(join(selected.versionRoot,'runtime.json'),JSON.stringify({...selected,node:c.given.invalidNode}));
  }
  let result;
  try{result=await execute(process.execPath,[entry,'workflow','run','small-change','17','--agent','codex'],{cwd,env,timeout:20000});}
  catch(e){result=e;}
  const exists=async path=>fs.stat(path).then(()=>true,()=>false);
  // Existing version probes still fail; require exactly one successful status query.
  if(!c.given.invalidNode)assert.equal((await fs.readFile(nativeStatusCalls,'utf8')).replaceAll('<--version>\n',''),'<login>\n<status>\n');
  if(c.expected.prepared){
    const observed=JSON.parse(await fs.readFile(paths.PREPARE_INPUT));assert.deepEqual(observed.runtime,selected);
    const prepared=JSON.parse(await fs.readFile(paths.PREPARE_RESULT));assert.equal(prepared.state,'prepared',prepared.message);
    assert.equal(prepared.runtime.releaseId,c.expected.runtimeRelease);
    const frozen=await readWorkflowRuntime({runDir:prepared.runDir});
    for(const [k,v] of Object.entries(selected))assert.deepEqual(frozen.runtime[k],v,k);
    assert.equal(frozen.runtime.packageRoot,selected.versionRoot);assert.equal(frozen.seed.issue.number,17);
    for(const [k,v] of Object.entries(c.expected.canonicalAdditions))assert.deepEqual(frozen.runtime[k],v,k);
    assert.deepEqual(prepared.runtime,frozen.runtime);assert.deepEqual((await readWorkflowJournal({runDir:prepared.runDir})).state.runtime,frozen.runtime);
    const controller=JSON.parse(await fs.readFile(paths.CONTROLLER));assert.deepEqual(controller.runtime,selected);assert.deepEqual(controller.input.runtime,frozen.runtime);
    assert.equal(result.code,1);assert.match(result.stderr,/Workflow controller not started: refused \(unsupported\)/);
    // No Herdr/process authority is supplied: the real controller must refuse.
    assert.equal((await git('worktree','list','--porcelain')).match(/^worktree /gm).length,2);
  } else {
    assert.equal(result.code,c.expected.exitCode);
    if(c.expected.message){assert.match(result.stdout,new RegExp(c.expected.message));assert.equal(JSON.parse(await fs.readFile(paths.PREPARE_RESULT)).state,'failed');assert.equal(await exists(paths.COMMANDS),false);}
    else {assert.match(result.stderr,new RegExp(c.expected.code));assert.equal(await exists(paths.PREPARE_INPUT),false);}
    assert.equal(await exists(paths.CONTROLLER),c.expected.controllerRequested);assert.equal(await exists(join(cwd,'.git/pdd')),false);
    assert.equal((await git('worktree','list','--porcelain')).match(/^worktree /gm).length,1);
  }
  assert.equal(await exists(paths.HERDR_STARTS),false);
  assert.equal(await exists(paths.HERDR_PROBES),c.expected.prepared===true);
  if(c.expected.prepared)assert.equal((await fs.readFile(paths.HERDR_PROBES,'utf8')).trim().split('\n').length,1);
  assert.equal(await git('status','--porcelain'),'');assert.equal(await fs.readFile(join(cwd,'README.md'),'utf8'),'Preserved input.\n');
  const commands=await exists(paths.COMMANDS)?(await fs.readFile(paths.COMMANDS,'utf8')).trim().split('\n').map(JSON.parse):[];
  assert.equal(commands.filter(x=>!['git','gh'].includes(x.file)).length,c.expected.nativeEffects);
  assert.equal(commands.filter(x=>x.file==='git'&&x.args[0]==='push'||x.file==='gh'&&x.args[0]==='pr').length,0);
});
