import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {traceGitCommand,readGitTrace} from '../../src/git-trace.mjs';

const command={argv:['fetch','origin','main'],cwd:'/synthetic/project'};
const stderr="fatal: could not read Username for 'https://github.com': terminal prompts disabled\n";
async function fixture(t){
 const home=await mkdtemp(join(tmpdir(),'pdd-git-selector-'));
 t.after(()=>rm(home,{recursive:true,force:true}));
 return {home,path:join(home,'.pdd/logs/git-trace.jsonl')};
}
function inherit(t,value){
 const prior=process.env.PDD_TRACE;
 t.after(()=>{if(prior===undefined)delete process.env.PDD_TRACE;else process.env.PDD_TRACE=prior;});
 if(value===undefined)delete process.env.PDD_TRACE;else process.env.PDD_TRACE=value;
}
async function observe(t,env,enabled){
 const f=await fixture(t),ports={home:f.home,...(env===undefined?{}:{env})};
 const before=env===undefined?undefined:{...env},value={stdout:'ghp_syntheticSelectorSecret123'},error=Object.assign(Error('unproved exception'),{code:128,stderr});let calls=0;
 assert.equal(await traceGitCommand(command,()=>{calls++;return value;},ports),value);
 await assert.rejects(traceGitCommand(command,()=>{calls++;throw error;},ports),e=>e===error);
 assert.equal(calls,2,'selection cannot repeat command effects');
 if(enabled){
  const rows=await readGitTrace(ports);
  assert.deepEqual(rows.map(r=>[r.outcome,r.exit]),[['returned',0],['rejected',128]]);
  for(const row of rows){assert.deepEqual(row.argv,['git','fetch','origin','main']);assert.equal(row.cwd,command.cwd);}
  assert.equal(rows[1].stderr,stderr);
  assert.equal((await stat(f.path)).mode&0o777,0o600);
  assert.doesNotMatch(await readFile(f.path,'utf8'),/syntheticSelectorSecret|unproved exception/);
 }else{
  assert.deepEqual(await readdir(f.home),[],'disabled selectors cannot inspect/create diagnostic paths');
 }
 assert.deepEqual(env,before,'diagnostics cannot mutate the supplied environment');
}

for(const selector of ['git','herdr,git','git,herdr',' \t herdr , git \n','unknown,git,other','git,git'])
 test(`Git token enables one record per settled action: ${JSON.stringify(selector)}`,async t=>{
  inherit(t,'');await observe(t,Object.freeze({PDD_TRACE:selector}),true);
 });
for(const selector of ['','herdr','unknown','all','GIT','Git','git-extra','prefixgit','herdr,unknown',', ,'])
 test(`explicit non-Git selector overrides inherited Git: ${JSON.stringify(selector)}`,async t=>{
  inherit(t,'herdr,git');await observe(t,Object.freeze({PDD_TRACE:selector}),false);
 });
for(const value of [false,0,[],{}])
 test(`non-string switch stays off: ${JSON.stringify(value)}`,async t=>{
  inherit(t,'git');await observe(t,Object.freeze({PDD_TRACE:value}),false);
 });
for(const [name,env] of [['no supplied environment',undefined],['filtered environment',Object.freeze({PATH:'/synthetic'})],['undefined switch',Object.freeze({PDD_TRACE:undefined})],['null switch',Object.freeze({PDD_TRACE:null})]])
 test(`inherited combined selector survives ${name}`,async t=>{
  inherit(t,'herdr,git');await observe(t,env,true);
 });
test('unset inherited switch and filtered environment stay off',async t=>{
 inherit(t,undefined);await observe(t,Object.freeze({PATH:'/synthetic'}),false);
});
test('unavailable selector access preserves the original return and thrown identities',async t=>{
 inherit(t,'git');const env={get PDD_TRACE(){throw Error('selector unavailable');}},f=await fixture(t),value={},error=Error('original failure');let calls=0;
 assert.equal(await traceGitCommand(command,()=>{calls++;return value;},{...f,env}),value);
 await assert.rejects(traceGitCommand(command,()=>{calls++;throw error;},{...f,env}),e=>e===error);
 assert.equal(calls,2);assert.deepEqual(await readdir(f.home),[]);
});
