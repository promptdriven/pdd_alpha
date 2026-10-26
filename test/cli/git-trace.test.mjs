import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,stat,chmod,symlink,link,rm,readdir,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {traceGitCommand,readGitTrace} from '../../src/git-trace.mjs';
import vectors from '../../vectors/cli/git-trace.json' with {type:'json'};
const expected=id=>vectors.cases.find(c=>c.id===id).expected;
const errorText=vectors.cases.find(c=>c.id==='transport-refusal').given.stderr;
async function fixture(t){
  const home=await realpath(await mkdtemp(join(tmpdir(),'pdd-git-trace-')));t.after(()=>rm(home,{recursive:true,force:true}));
  return {home,env:{PDD_TRACE:'git'},path:join(home,'.pdd/logs/git-trace.jsonl')};
}
const command={argv:['fetch','origin','main'],cwd:'/synthetic/project'};
function row(n=0){return {v:1,event:'git',startedAt:'2026-10-26T00:00:00.000Z',finishedAt:'2026-10-26T00:00:00.001Z',elapsedMs:1,
 argv:['git','fetch','origin','branch-'+n],cwd:'/synthetic/project',outcome:'returned',exit:0,signal:null,errorCode:null,stderr:''};}
async function log(f,bytes){await mkdir(join(f.home,'.pdd/logs'),{recursive:true,mode:0o700});await writeFile(f.path,bytes,{mode:0o600});}

test('disabled tracing invokes once and never creates diagnostic paths',async t=>{
 const f=await fixture(t),value={stdout:'unchanged'};let calls=0;
 for(const valueOfSwitch of [undefined,'','1','herdr','unknown']){
  assert.equal(await traceGitCommand(command,async()=>{calls++;return value;},{...f,env:{PDD_TRACE:valueOfSwitch}}),value);
  assert.deepEqual(await readdir(f.home),[]);
 }
 assert.equal(calls,5*expected('disabled').calls);
});
test('recorded Git transport rejection retains exact error, exit, command and monotonic timing privately',async t=>{
 const f=await fixture(t),error=Object.assign(Error('unprinted exception'),{code:128,stderr:errorText,stdout:'ghp_stdoutSecret123'});let calls=0;
 await assert.rejects(traceGitCommand(command,async()=>{calls++;throw error;},{...f,now:()=>{throw Error('workflow clock must not be used');}}),e=>e===error);
 const [r]=await readGitTrace(f);assert.equal(calls,expected('transport-refusal').calls);
 assert.equal(r.exit,expected('transport-refusal').exit);assert.equal(r.outcome,expected('transport-refusal').outcome);
 assert.deepEqual(r.argv,['git','fetch','origin','main']);assert.equal(r.cwd,command.cwd);assert.equal(r.stderr,errorText);
 assert.ok(Number.isFinite(r.elapsedMs)&&r.elapsedMs>=0);assert.ok(Number.isFinite(Date.parse(r.startedAt)));assert.ok(Number.isFinite(Date.parse(r.finishedAt)));
 assert.equal((await stat(f.path)).mode&0o777,0o600);assert.equal((await stat(join(f.home,'.pdd/logs'))).mode&0o777,0o700);
 assert.doesNotMatch(await readFile(f.path,'utf8'),/stdoutSecret|unprinted exception|workflow clock/);
});
test('resolved nonzero, missing rejected exit, signal and rejected zero keep their original result identities',async t=>{
 const f=await fixture(t),value={stdout:'',stderr:errorText,code:128};
 assert.equal(await traceGitCommand(command,()=>value,f),value);
 const unknown=Object.assign(Error('transport failed'),{signal:'SIGTERM'}),zero=Object.assign(Error('rejected zero'),{code:0});
 for(const err of [unknown,zero])await assert.rejects(traceGitCommand(command,()=>Promise.reject(err),f),e=>e===err);
 const rows=await readGitTrace(f);assert.deepEqual(rows.map(r=>[r.outcome,r.exit,r.signal]),[['returned',128,null],['rejected',null,'SIGTERM'],['rejected',0,null]]);
});
test('trace redacts URL authentication, token/query/header arguments, environment, private keys and unproved stderr',async t=>{
 const f=await fixture(t),secrets=['urlPassword123','querySecret123','fragmentSecret123','ghp_syntheticAccessToken123','headerSecret123','positionalSecret123','privateMaterial123','opaqueDiagnostic123'];
 const argv=['fetch','https://user:'+secrets[0]+'@github.com/example/repo.git?auth='+secrets[1]+'#'+secrets[2],secrets[3],'-c','http.extraHeader=Authorization: Bearer '+secrets[4],'--password',secrets[5],'-c','http.extraHeader='+secrets[4],'-c','credential.helper=!echo '+secrets[5]];
 const before=[...argv],response={stdout:secrets.join(' '),stderr:"fatal: Authentication failed for 'https://user:"+secrets[0]+"@github.com/example/repo.git?auth="+secrets[1]+"'\nremote: "+secrets[7]+"\n"};
 assert.equal(await traceGitCommand({argv,cwd:'/project/'+secrets[3]},()=>response,{...f,env:{PDD_TRACE:'git',GITHUB_TOKEN:secrets[3]}}),response);assert.deepEqual(argv,before);
 await traceGitCommand(command,()=>({stderr:'-----BEGIN PRIVATE KEY-----\n'+secrets[6]+'\n-----END PRIVATE KEY-----'}),f);
 const raw=await readFile(f.path,'utf8'),rendered=JSON.stringify(await readGitTrace(f));
 for(const secret of secrets){assert.ok(!raw.includes(secret));assert.ok(!rendered.includes(secret));}
 const rows=await readGitTrace(f);assert.equal(rows.length,2);assert.equal(rows[0].argv[2],'https://github.com/example/repo.git');
 assert.match(rows[0].stderr,/Authentication failed/);assert.match(rows[0].stderr,/\[redacted\]/);
});
for(const unsafe of ['file-symlink','logs-symlink','hardlink','public-file','home-symlink','pdd-file'])test(`unsafe ${unsafe} is neither read nor changed and cannot replace a command outcome`,async t=>{
 const f=await fixture(t),outside=await mkdtemp(join(tmpdir(),'pdd-trace-target-'));t.after(()=>rm(outside,{recursive:true,force:true}));
 const target=join(outside,'target');await writeFile(target,'retained target bytes\n',{mode:0o600});let actual=f;
 if(unsafe==='pdd-file')await writeFile(join(f.home,'.pdd'),'retained marker');
 else if(unsafe==='home-symlink'){const alias=join(outside,'alias');await symlink(f.home,alias);actual={...f,home:alias};}
 else {await mkdir(join(f.home,'.pdd'),{mode:0o700});
  if(unsafe==='logs-symlink')await symlink(outside,join(f.home,'.pdd/logs'));
  else {await mkdir(join(f.home,'.pdd/logs'),{mode:0o700});if(unsafe==='file-symlink')await symlink(target,f.path);
   if(unsafe==='hardlink')await link(target,f.path);if(unsafe==='public-file'){await writeFile(f.path,'retained public bytes');await chmod(f.path,0o644);}}
 }
 const value={stdout:'same result'};let calls=0;assert.equal(await traceGitCommand(command,()=>{calls++;return value;},actual),value);
 const failure=Object.assign(Error('same rejected error'),{code:128,stderr:errorText});await assert.rejects(traceGitCommand(command,()=>{calls++;throw failure;},actual),e=>e===failure);
 assert.equal(calls,2);assert.deepEqual(await readGitTrace(actual),[]);assert.equal(await readFile(target,'utf8'),'retained target bytes\n');
 if(unsafe==='public-file')assert.equal(await readFile(f.path,'utf8'),'retained public bytes');
});
test('reader returns last200 complete physical lines, omits a trailing partial and does not modify the file',async t=>{
 const f=await fixture(t);await log(f,Array.from({length:205},(_,i)=>JSON.stringify(row(i))+'\n').join('')+'{"partial":"never printed"');
 const bytes=await readFile(f.path),rows=await readGitTrace(f);
 assert.equal(rows.length,expected('tail').maximumRecords);assert.equal(rows[0].argv.at(-1),'branch-'+expected('tail').firstCompleteRecord);assert.equal(rows.at(-1).argv.at(-1),'branch-204');
 assert.deepEqual(await readFile(f.path),bytes);
});
test('an existing FIFO cannot block a settled Git command or become a report input',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t);await mkdir(join(f.home,'.pdd/logs'),{recursive:true,mode:0o700});
 await promisify(execFile)('mkfifo',[f.path]);
 const value={stdout:'retained'};let calls=0;
 assert.equal(await traceGitCommand(command,()=>{calls++;return value;},f),value);
 assert.equal(calls,1);assert.deepEqual(await readGitTrace(f),[]);assert.ok((await stat(f.path)).isFIFO());
});
test('a log replaced with FIFO after metadata check returns absence without blocking',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t);await log(f,'{}\n');
 const script=String.raw`
  import fsp from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';
  import {execFileSync} from 'node:child_process';import {join} from 'node:path';
  const home=process.argv[2],path=join(home,'.pdd/logs/git-trace.jsonl'),original=fsp.lstat;let swapped=false;
  fsp.lstat=async function(p,...args){const stat=await original(p,...args);
   if(p===path&&!swapped){swapped=true;await fsp.unlink(path);execFileSync('mkfifo',[path]);}return stat;};
  syncBuiltinESMExports();const {readGitTrace}=await import(process.argv[1]);
  console.log(JSON.stringify({records:await readGitTrace({home}),swapped}));`;
 const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',script,new URL('../../src/git-trace.mjs',import.meta.url).href,f.home],{timeout:5000});
 assert.deepEqual(JSON.parse(stdout),{records:expected('special-file-race').records,swapped:true});assert.ok((await stat(f.path)).isFIFO());
});
test('reader reprojects untrusted complete records and omits malformed or unsupported records',async t=>{
 const f=await fixture(t),secret='ghp_oldTraceSecret123';
 await log(f,[JSON.stringify({...row(),argv:['git','fetch','https://user:plainPassword@github.com/example/repo.git?token=querySecret'],stderr:'unproved free text '+secret,stdout:secret,unknown:secret}),'{bad json}',JSON.stringify({...row(),event:'unknown',cwd:secret}),JSON.stringify({...row(),exit:'0'}),JSON.stringify({...row(),elapsedMs:-1})].join('\n')+'\n');
 const rows=await readGitTrace(f);assert.equal(rows.length,1);assert.deepEqual(rows[0].argv,['git','fetch','https://github.com/example/repo.git']);
 assert.doesNotMatch(JSON.stringify(rows),/oldTraceSecret|plainPassword|querySecret|unknown|stdout/);assert.equal(rows[0].stderr,'[redacted]');
});
test('missing log is a read-only absence; oversized fields and records cannot expose partial data',async t=>{
 const f=await fixture(t);assert.deepEqual(await readGitTrace(f),[]);assert.deepEqual(await readdir(f.home),[]);
 await traceGitCommand({...command,argv:['fetch','x'.repeat(9000)+'ghp_tailSecret123']},()=>({stderr:'x'.repeat(9000)+'ghp_endSecret123'}),f);
 const bytes=await readFile(f.path,'utf8');assert.ok(bytes.length<32768);assert.doesNotMatch(bytes,/tailSecret|endSecret/);
 await log(f,'x'.repeat(9*1024*1024)+'\n'+JSON.stringify(row(9))+'\n');assert.deepEqual((await readGitTrace(f)).map(r=>r.argv.at(-1)),['branch-9']);
});
test('concurrent diagnostic writes remain complete records without retrying command effects',async t=>{
 const f=await fixture(t);let calls=0;
 await Promise.all(Array.from({length:20},(_,i)=>traceGitCommand({argv:['show-ref',String(i)],cwd:command.cwd},async()=>{calls++;return {stdout:'',code:1};},f)));
 assert.equal(calls,20);const bytes=await readFile(f.path,'utf8'),lines=bytes.trimEnd().split('\n');assert.equal(lines.length,20);
 assert.deepEqual(lines.map(s=>JSON.parse(s).argv.at(-1)).sort(),Array.from({length:20},(_,i)=>String(i)).sort());assert.equal((await readGitTrace(f)).length,20);
});
test('diagnostic access errors preserve the original returned object',async t=>{
 const f=await fixture(t),value={get code(){throw Error('not a command failure');},stdout:''};let calls=0;
 assert.equal(await traceGitCommand(command,()=>{calls++;return value;},f),value);assert.equal(calls,expected('logging-failure').calls);
});
