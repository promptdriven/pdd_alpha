import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runDoctorCommand} from '../../src/doctor.mjs';
import {traceGitCommand,readGitTrace} from '../../src/git-trace.mjs';
const capture=()=>({text:'',write(x){this.text+=x;}});
const pass={id:'runtime',state:'pass',detail:'Runtime checked.',next:null};
test('doctor reports last 200 trusted Git records, not adapter data or unknown stderr',async t=>{
 const home=mkdtempSync(join(tmpdir(),'pdd-doctor-git-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
 const ports={home,env:{PDD_TRACE:'git'}};
 await traceGitCommand({argv:['fetch','origin'],cwd:home},async()=>({code:128,stderr:'arbitrary private note sk-proj-syntheticCredential123'}),ports);
 const path=join(home,'.pdd/logs/git-trace.jsonl'),row=JSON.parse(readFileSync(path,'utf8').trim());
 writeFileSync(path,Array.from({length:220},(_,i)=>JSON.stringify({...row,elapsedMs:i})).join('\n')+'\n',{mode:0o600});
 const before=readFileSync(path),stdout=capture();
 assert.equal(await runDoctorCommand(['--report'],{home,stdout,stderr:capture(),alphaChecks:async()=>({checks:[pass],report:{gitTrace:['sk-secret-untrusted']}})}),0);
 const report=JSON.parse(stdout.text);assert.deepEqual(report.gitTrace,await readGitTrace(ports));assert.equal(report.gitTrace.length,200);assert.equal(report.gitTrace[0].elapsedMs,20);
 assert.doesNotMatch(stdout.text,/syntheticCredential|sk-secret|arbitrary private note/);assert.deepEqual(readFileSync(path),before);
});
test('Git report missing-file and other doctor modes create nothing',async t=>{
 const home=mkdtempSync(join(tmpdir(),'pdd-doctor-no-git-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
 for(const argv of [['--report'],['--json'],['--check-only'],[]]){
  const stdout=capture();assert.equal(await runDoctorCommand(argv,{home,stdout,stderr:capture(),alphaChecks:async()=>({checks:[pass]})}),0);
  if(argv[0]==='--report')assert.deepEqual(JSON.parse(stdout.text).gitTrace,[]);else assert.doesNotMatch(stdout.text,/gitTrace/);
  assert.equal(existsSync(join(home,'.pdd')),false);
 }
});
