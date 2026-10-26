import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,symlinkSync,writeFileSync,unlinkSync,chmodSync,readdirSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runDoctorCommand} from '../../src/doctor.mjs';
import {traceHerdrRequest,readHerdrTrace} from '../../src/herdr-trace.mjs';
import {traceGitCommand,readGitTrace} from '../../src/git-trace.mjs';
const capture=()=>({text:'',write(x){this.text+=x;}});
const pass={id:'runtime',state:'pass',detail:'Runtime checked.',next:null};
async function fixture(t){
 const home=mkdtempSync(join(tmpdir(),'pdd-doctor-both-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
 await traceHerdrRequest({operation:'tab.create',request:{command:'private prompt'}},()=>({result:{type:'tab_created',tab:{tab_id:'w1:t1',pane_id:'w1:p1'}}}),{home,env:{PDD_TRACE:'herdr'}});
 await traceGitCommand({argv:['fetch','origin'],cwd:home},()=>({code:0,stderr:''}),{home,env:{PDD_TRACE:'git'}});
 return {home,herdr:join(home,'.pdd/logs/herdr-trace.jsonl'),git:join(home,'.pdd/logs/git-trace.jsonl'),logs:join(home,'.pdd/logs')};
}
async function report(home){
 const stdout=capture();assert.equal(await runDoctorCommand(['--report'],{home,stdout,stderr:capture(),alphaChecks:async()=>({checks:[pass],report:{herdrTrace:['private adapter text'],gitTrace:['private adapter text']}})}),0);
 assert.doesNotMatch(stdout.text,/private prompt|private adapter text/);return JSON.parse(stdout.text);
}
test('one doctor report retains both trusted trace histories and changes neither file',async t=>{
 const p=await fixture(t),a=readFileSync(p.herdr),b=readFileSync(p.git),names=readdirSync(p.logs);
 const result=await report(p.home);
 assert.deepEqual(result.herdrTrace,readHerdrTrace({home:p.home}));assert.equal(result.herdrTrace.length,2);
 assert.deepEqual(result.gitTrace,await readGitTrace({home:p.home}));assert.equal(result.gitTrace.length,1);
 assert.deepEqual(readFileSync(p.herdr),a);assert.deepEqual(readFileSync(p.git),b);assert.deepEqual(readdirSync(p.logs),names);
});
test('an unsafe trace cannot suppress the other trusted reader or repair either target',async t=>{
 const p=await fixture(t),a=readFileSync(p.herdr),b=readFileSync(p.git),target=join(p.home,'retained');writeFileSync(target,'retained',{mode:0o600});
 unlinkSync(p.herdr);symlinkSync(target,p.herdr);const ino=lstatSync(p.herdr).ino;
 const first=await report(p.home);assert.deepEqual(first.herdrTrace,[]);assert.equal(first.gitTrace.length,1);
 assert.equal(lstatSync(p.herdr).ino,ino);assert.equal(lstatSync(p.herdr).isSymbolicLink(),true);assert.equal(readFileSync(target,'utf8'),'retained');assert.deepEqual(readFileSync(p.git),b);
 unlinkSync(p.herdr);writeFileSync(p.herdr,a,{mode:0o600});chmodSync(p.git,0o644);
 const second=await report(p.home);assert.equal(second.herdrTrace.length,2);assert.deepEqual(second.gitTrace,[]);
 assert.equal(lstatSync(p.git).mode&0o777,0o644);assert.deepEqual(readFileSync(p.herdr),a);assert.deepEqual(readFileSync(p.git),b);
});
