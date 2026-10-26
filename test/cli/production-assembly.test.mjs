import test from 'node:test';
const hostFixtureSkip = process.platform === 'darwin' && process.env.PDD_MACOS_INTEGRATION !== '1';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,dirname,resolve,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {runPdd,createPddCliPorts} from '../../src/pdd-cli.mjs';
import {resolveRuntime} from '../../src/versions.mjs';
import {withUpdateLock} from '../../src/update-lock.mjs';
import {readRunIndex} from '../../src/workflow-run-records.mjs';
import {readWorkflowJournal} from '../../src/workflow-runner.mjs';
import {readControllerLaunches} from '../../src/workflow-controller.mjs';
import {readHerdrTrace} from '../../src/herdr-trace.mjs';
const execute=promisify(execFile),repo=resolve(import.meta.dirname,'../..');
const capture=()=>({text:'',write(text){this.text+=text;}});
async function fixture(t){
 const home=await fs.realpath(await fs.mkdtemp(join(tmpdir(),'pdd-real-cli-')));t.after(()=>fs.rm(home,{recursive:true,force:true}));
 const cwd=join(home,'project'),tools=join(home,'tools'),versionRoot=join(home,'.pdd/versions/synthetic');
 await fs.mkdir(cwd);await fs.mkdir(tools);await fs.mkdir(join(home,'.pdd'),{mode:0o700});await fs.mkdir(versionRoot,{recursive:true});
 for(const name of ['src','bin','launcher','docs','skills','.pdd','package.json']){
  if(name==='src'){
   await fs.mkdir(join(versionRoot,'src'));
   for(const entry of await fs.readdir(join(repo,'src')))if(entry.endsWith('.mjs'))await fs.copyFile(join(repo,'src',entry),join(versionRoot,'src',entry));
  }else await fs.cp(join(repo,name),join(versionRoot,name),{recursive:true});
 }
 const node=join(home,'.pdd/tools/node',process.versions.node,'bin/node');await fs.mkdir(dirname(node),{recursive:true});
 await fs.copyFile(process.execPath,node,constants.COPYFILE_FICLONE);
 const descriptor={v:1,releaseId:'synthetic',versionRoot,node,bin:join(versionRoot,'bin/pdd.mjs'),pddVersion:JSON.parse(await fs.readFile(join(repo,'package.json'))).version,nodeVersion:process.versions.node,alphaDigest:'a'.repeat(64),clientDigest:null,credentialHelper:null};
 await fs.writeFile(join(versionRoot,'runtime.json'),JSON.stringify(descriptor));
 const runtime=await resolveRuntime({home,versionRoot});
 const git=async(...args)=>(await execute('git',args,{cwd})).stdout.trim();
 await git('init','--quiet','-b','main');await git('config','user.name','Synthetic');await git('config','user.email','synthetic@example.invalid');
 await fs.writeFile(join(cwd,'README.md'),'Retain this checkout.\n');await git('add','.');await git('commit','--quiet','-m','initial');
 await git('remote','add','origin','https://github.com/example/project.git');
 const remote=join(home,'remote.git');await git('clone','--quiet','--bare',cwd,remote);
 await git('update-ref','refs/remotes/origin/main',await git('rev-parse','HEAD'));
 const codex=join(tools,'codex'),authLog=join(home,'native-status.jsonl');await fs.writeFile(codex,`#!${process.execPath}
const {createInterface}=await import('node:readline');
// SYNTHETIC OFFLINE native status; the real public auth helper still executes.
if(process.argv.length===4&&process.argv[2]==='login'&&process.argv[3]==='status'){
 const fs=await import('node:fs');fs.appendFileSync(process.env.AUTH_EDGE_LOG,JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),home:process.env.HOME})+'\\n');
 console.log('Logged in using ChatGPT');process.exit(0);
}
if(process.argv[2]==='--version'){console.log('codex-cli 1.2.3');process.exit(0);}
if(process.argv[2]!=='app-server')process.exit(92);
createInterface({input:process.stdin}).on('line',text=>{const r=JSON.parse(text);if(r.method==='initialized')return;
let result={};if(r.method==='config/read')result={config:{model:'synthetic',model_reasoning_effort:null}};
if(r.method==='model/list')result={data:[{model:'synthetic',displayName:'Synthetic',hidden:false,isDefault:true,defaultReasoningEffort:null,supportedReasoningEfforts:[]}],nextCursor:null};
if(!['initialize','config/read','model/list'].includes(r.method))process.exit(93);console.log(JSON.stringify({id:r.id,result}));});
`,{mode:0o700});
 await fs.writeFile(join(tools,'herdr'),'#!/bin/sh\nexit 94\n',{mode:0o700});
 // Keep native status probes inside disposable tools, including absent Claude.
 const gitBinary=(await execute('/bin/sh',['-c','command -v git'])).stdout.trim();
 await fs.symlink(gitBinary,join(tools,'git'));
 const env={...process.env,HOME:home,PATH:tools,AUTH_EDGE_LOG:authLog,PDD_TRACE:'herdr,git'};
 const stdout=capture(),stderr=capture(),calls=[];let broken=false,panes=[];
 const ports={home,env,runtime,execFile:async(file,args,options={})=>{
  calls.push([basename(file),args]);
  if(file==='gh'){
   if(args[0]==='repo')return {stdout:JSON.stringify({nameWithOwner:'example/project',defaultBranchRef:{name:'main'},url:'https://github.com/example/project'})};
   if(args[0]==='api')return {stdout:JSON.stringify({number:17,html_url:'https://github.com/example/project/issues/17',title:'Synthetic issue',body:'Retain files.',state:'open'})};
   assert.fail('Unexpected GitHub request');
  }
  if(basename(file)==='herdr'){
   assert.deepEqual(args.slice(0,2),['--session','default']);const op=args.slice(2,4).join('.');
   if(op==='workspace.list')return {stdout:JSON.stringify({result:{workspaces:[{workspace_id:'wA'}]}})};
   if(op==='pane.list'){
    if(broken)throw Object.assign(Error('synthetic-secret'),{code:'ECONNRESET'});
    return {stdout:JSON.stringify({result:{panes}})};
   }
   if(op==='workspace.create')return {stdout:JSON.stringify({result:{workspace:{workspace_id:'wB'}}})};
   if(op==='tab.create')return {stdout:JSON.stringify({result:{tab:{tab_id:'wB:t1'},root_pane:{tab_id:'wB:t1',pane_id:'wB:p1',terminal_id:'synthetic-terminal'}}})};
   if(op==='pane.process-info'){
    if(broken)throw Object.assign(Error('synthetic-secret'),{code:'ECONNRESET'});
    return {stdout:JSON.stringify({result:{process_info:{pane_id:args.at(-1),...(panes.length?{shell_pid:process.pid,foreground_processes:[{pid:process.pid,argv:[process.execPath,'synthetic-child']}]}:{foreground_processes:[]})}}})};
   }
   assert.fail('No native mutation was authorized: '+op);
  }
  // Only the remote transport is redirected: Git itself performs a genuine
  // fetch, FETCH_HEAD/tracking update, worktree creation and identity reads.
  if(file===codex){assert.deepEqual(args,['login','status']);return execute(file,args,options);}
  if(file==='git'&&args[0]==='fetch')return execute(file,['fetch',remote,`+refs/heads/${args[2]}:refs/remotes/origin/${args[2]}`],options);
  assert.equal(file,'git','Only external GitHub/Herdr requests may be faked');
  assert.ok(!['push','pull','clone','ls-remote'].includes(args[0]),'No other Git network operation is authorized');
  return execute(file,args,options);
 }};
 return {home,cwd,tools,authLog,versionRoot,runtime,env,stdout,stderr,calls,ports,git,
  deps:{home,cwd,packageRoot:versionRoot,stdout,stderr,ports},setBroken:x=>{broken=x;},setPanes:x=>{panes=x;}};
}

test('real CLI factories compose discovery, prepared run/resume, strict authority and failed Herdr trace with network edges only',{skip:hostFixtureSkip},async t=>{
 const f=await fixture(t);
 assert.equal(await runPdd(['models','--agent','codex'],f.deps),0,f.stderr.text);assert.match(f.stdout.text,/synthetic/);
 f.stdout.text='';assert.equal(await runPdd(['projects'],f.deps),0);assert.match(f.stdout.text,/project/);
 f.stdout.text='';f.stderr.text='';
 assert.equal(await runPdd(['workflow','run','small-change','17'],f.deps),1,f.stderr.text);
 assert.match(f.stderr.text,/Workflow controller not started: refused \(herdr_identity_unavailable\)/);
 assert.deepEqual((await fs.readFile(f.authLog,'utf8')).trim().split('\n').map(JSON.parse),[{args:['login','status'],cwd:f.cwd,home:f.home}]);
 const index=await readRunIndex({home:f.home});assert.equal(index.entries.length,1);const entry=index.entries[0];
 const spec={runDir:entry.runDir},journal=await readWorkflowJournal(spec);
 assert.equal(journal.state.controlState,'running');assert.equal(journal.state.runtime.node,f.runtime.node);
 assert.equal((await fs.readFile(join(f.cwd,'README.md'),'utf8')),'Retain this checkout.\n');
 const launches=await readControllerLaunches(spec);assert.equal(launches.length,1);
 assert.equal(launches[0].phase,'herdr.identity_unavailable');assert.equal(launches[0].paneId,'wB:p1');
 assert.match(f.stderr.text,/No controller command was sent/);
 assert.equal(f.calls.filter(([,args])=>args.slice(2,4).join('.')==='tab.create').length,1);
 const before=await fs.readFile(join(entry.runDir,'journal.jsonl'));
 f.stderr.text='';f.setBroken(true);
 const failedLocal=await createPddCliPorts(f.ports,{capability:'controller'});
 assert.equal(await failedLocal.herdr.supportsProcessIdentity({session:'default',paneId:'wB:p1'}),false);
 assert.equal(await runPdd(['workflow','resume',entry.runId],f.deps),1);assert.match(f.stderr.text,/Workflow controller not started: refused \(herdr_identity_unavailable\)/);
 assert.deepEqual(await fs.readFile(join(entry.runDir,'journal.jsonl')),before);
 assert.equal((await readRunIndex({home:f.home})).entries.length,1,'resume retains original allocation');
 const rows=readHerdrTrace({home:f.home});
 assert.ok(rows.some(r=>r.operation==='controller.start'&&r.payload.code==='herdr_identity_unavailable'),JSON.stringify(rows));
 assert.ok(rows.some(r=>r.operation==='pane.process_info'&&r.phase==='error'));
 assert.doesNotMatch(JSON.stringify(rows),/synthetic-secret/);
 assert.equal(f.calls.filter(([,args])=>args.slice(2,4).join('.')==='tab.create').length,1,'resume never creates a replacement pane');
 assert.equal(f.calls.filter(([,args])=>args.slice(2,4).join('.')==='pane.run').length,0);
 f.setBroken(false);f.setPanes([{pane_id:'wA:pZ'}]);
 const local=await createPddCliPorts(f.ports,{capability:'controller'});
 assert.equal(local.runtime,f.runtime);assert.equal(local.env,f.env);assert.equal(local.execFile,f.ports.execFile);
 assert.equal(await local.herdr.supportsProcessIdentity(),true);
 const process=await local.herdr.processInfo({session:'default',paneId:'wA:pZ'});
 assert.equal(process.pid,globalThis.process.pid);assert.match(process.startIdentity,/^(linux:|darwin:)/);
 const state=journal.state;
 assert.equal(await local.validateRun({runId:entry.runId,runDir:entry.runDir,root:state.root,runtime:state.runtime,workflow:state.name,issueNumber:17},state),true);
 assert.equal(await local.inspectControllerLock({runId:entry.runId,runDir:entry.runDir,root:state.root,runtime:state.runtime,workflow:state.name,issueNumber:17}),'free');
 assert.ok(f.calls.filter(([file,args])=>file==='herdr').every(([,args])=>['workspace.list','workspace.create','tab.create','pane.list','pane.process-info'].includes(args.slice(2,4).join('.'))));
});

test('fleet conditional CLI paths explicitly refuse without importing or creating client state',async t=>{
 const home=await fs.realpath(await fs.mkdtemp(join(tmpdir(),'pdd-no-client-')));t.after(()=>fs.rm(home,{recursive:true,force:true}));
 for(const argv of [['phone'],['link','status'],['fleet','status'],['join'],['accounts'],['settings'],['models','--on','desktop','--agent','codex'],['projects','--on','desktop'],['session','--on','desktop']]){
  const stdout=capture(),stderr=capture();
  assert.equal(await runPdd(argv,{home,cwd:home,stdout,stderr}),1,JSON.stringify(argv));
  assert.match(stderr.text,/this needs the fleet client/,JSON.stringify(argv));assert.equal(stdout.text,'');
 }
 assert.deepEqual(await fs.readdir(home),[]);
});

test('explicit model and project dependency references win without any production probe',async()=>{
 const nativeCatalog={read:()=>assert.fail()},toolDefaults={read:()=>assert.fail()},modelPorts={nativeCatalog,toolDefaults},projectPorts={checkLocal:()=>assert.fail()};
 assert.equal(await createPddCliPorts({}, {capability:'models',modelPorts}),modelPorts);
 assert.equal(await createPddCliPorts({}, {capability:'projects',projectPorts}),projectPorts);
 const p=await createPddCliPorts({nativeCatalog,toolDefaults},{capability:'models'});
 assert.equal(p.nativeCatalog,nativeCatalog);assert.equal(p.toolDefaults,toolDefaults);
 await assert.rejects(createPddCliPorts({}, {capability:'invented'}),/Unsupported/);
});

// The child has a private HOME and a service-protocol stand-in at PATH's
// external edge; it cannot contact the host user service manager.
test('public setup uses real verified runtime, install helper, update lease and launcher before the external service edge',{skip:process.platform!=='linux'},async t=>{
 const f=await fixture(t),log=join(f.home,'service-requests.jsonl'),herdrLog=join(f.home,'herdr-requests.jsonl');
 await fs.writeFile(join(f.tools,'herdr'),`#!${process.execPath}
const fs=await import('node:fs'),args=process.argv.slice(2);
// SYNTHETIC OFFLINE executable smoke check, not version or feature acceptance.
fs.appendFileSync(process.env.HERDR_EDGE_LOG,JSON.stringify(args)+'\\n');
if(JSON.stringify(args)===JSON.stringify(['--help'])){console.log('Usage: herdr [command]');process.exit(0);}
if(JSON.stringify(args)!==JSON.stringify(['--session','default','workspace','list']))process.exit(94);
if(!fs.existsSync(process.env.HERDR_EDGE_STATE))process.exit(1);
console.log(JSON.stringify({result:{workspaces:[]}}));
`,{mode:0o700});
 await fs.writeFile(join(f.tools,'systemctl'),`#!${process.execPath}
const fs=await import('node:fs');
const args=process.argv.slice(2);
if(![['--user','daemon-reload'],['--user','enable','pdd-herdr-default.service'],['--user','is-enabled','pdd-herdr-default.service'],['--user','start','pdd-herdr-default.service'],['--user','enable','--now','pdd-runs-keeper.service']].some(a=>JSON.stringify(a)===JSON.stringify(args)))process.exit(95);
fs.appendFileSync(process.env.SERVICE_EDGE_LOG,JSON.stringify(args)+'\\n');
if(args[1]==='enable'&&args[2]==='pdd-herdr-default.service')fs.writeFileSync(process.env.HERDR_EDGE_STATE+'.enabled','enabled');
if(args[1]==='is-enabled'){if(!fs.existsSync(process.env.HERDR_EDGE_STATE+'.enabled'))process.exit(1);console.log('enabled');}
if(args[1]==='start')fs.writeFileSync(process.env.HERDR_EDGE_STATE,'running');
`,{mode:0o700});
 await fs.writeFile(join(f.tools,'loginctl'),`#!${process.execPath}
const fs=await import('node:fs'),args=process.argv.slice(2),uid=String(process.getuid());
if(JSON.stringify(args)===JSON.stringify(['--no-ask-password','enable-linger',uid]))fs.writeFileSync(process.env.HERDR_EDGE_STATE+'.linger','yes');
else if(JSON.stringify(args)===JSON.stringify(['show-user',uid,'--property=Linger','--value'])){if(!fs.existsSync(process.env.HERDR_EDGE_STATE+'.linger'))process.exit(1);console.log('yes');}
else process.exit(96);
`,{mode:0o700});
 const script=`import {runPdd} from ${JSON.stringify(pathToFileURL(join(repo,'src/pdd-cli.mjs')).href)};
process.exitCode=await runPdd(['setup'],{home:process.env.HOME,cwd:process.env.HOME,packageRoot:process.env.PACKAGE_EDGE_ROOT});`;
 const env={...f.env,HERDR_EDGE_STATE:join(f.home,'herdr-service-state'),HERDR_EDGE_LOG:herdrLog,SERVICE_EDGE_LOG:log,PACKAGE_EDGE_ROOT:f.versionRoot,DBUS_SESSION_BUS_ADDRESS:'unix:path=/nonexistent/pdd-test-bus'};
 const result=await execute(process.execPath,['--input-type=module','--eval',script],{env,timeout:15000});
 assert.match(result.stdout,/Public recovery service ready/);assert.equal(result.stderr,'');
 assert.deepEqual((await fs.readFile(herdrLog,'utf8')).trim().split('\n').map(JSON.parse),[['--help'],['--session','default','workspace','list'],['--session','default','workspace','list']]);
 assert.deepEqual((await fs.readFile(f.authLog,'utf8')).trim().split('\n').map(JSON.parse),[{args:['login','status'],cwd:f.home,home:f.home}]);
 assert.deepEqual((await fs.readFile(log,'utf8')).trim().split('\n').map(JSON.parse),[['--user','daemon-reload'],['--user','enable','pdd-herdr-default.service'],['--user','is-enabled','pdd-herdr-default.service'],['--user','daemon-reload'],['--user','enable','--now','pdd-runs-keeper.service'],['--user','start','pdd-herdr-default.service']]);
 assert.match(await fs.readFile(join(f.home,'.config/systemd/user/pdd-herdr-default.service'),'utf8'),/ExecStart=.*herdr.* server/);
 assert.match(await fs.readFile(join(f.home,'.config/systemd/user/pdd-runs-keeper.service'),'utf8'),/cli runs-keeper/);
 assert.ok((await fs.stat(join(f.home,'.pdd/launcher/pdd-launch'))).mode&0o100);
 const lockBefore=await fs.stat(join(f.home,'.pdd/update.lock'));
 assert.equal(await withUpdateLock({home:f.home},async()=> 'released'), 'released');
 assert.equal((await fs.stat(join(f.home,'.pdd/update.lock'))).ino,lockBefore.ino,'setup releases the kernel lock and preserves its inode');
 assert.equal(await fs.stat(join(f.home,'.pdd/current')).then(()=>true,()=>false),false,'public setup does not repoint runtime');
});
