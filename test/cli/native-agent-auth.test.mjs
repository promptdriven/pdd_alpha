import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {checkNativeAgentAuth} from '../../src/native-agent-auth.mjs';

async function fixture(t,agent='codex') {
  const root=await fs.mkdtemp(join(tmpdir(),'pdd-auth-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const bin=join(root,agent);await fs.writeFile(bin,'placeholder',{mode:0o700});
  const env={PATH:root,HOME:join(root,'native-home'),CODEX_HOME:join(root,'native-config')};
  return {root,bin,env,ports:{env}};
}
for(const [name,agent,result,expected] of [
  ['codex stderr native status','codex',{stdout:'',stderr:'Logged in using ChatGPT\n'},'ready'],
  ['codex stdout native status','codex',{stdout:'Logged in using ChatGPT\n',stderr:''},'ready'],
  ['codex API-key status never discloses detail','codex',{stdout:'',stderr:'Logged in using an API key: sk-synthetic-private\n'},'ready'],
  ['real signed-out Codex status','codex',{code:1,stdout:'',stderr:'Not logged in\n'},'blocked'],
  ['signed-out Codex with exit0','codex',{stdout:'Not logged in\n',stderr:''},'blocked'],
  ['claude native JSON status','claude',{stdout:'{"loggedIn":true,"email":"synthetic-private"}',stderr:''},'ready'],
  ['claude signed out','claude',{code:1,stdout:'{"loggedIn":false}',stderr:''},'blocked'],
  ['native readiness is not login','codex',{stdout:'interactive_ready\n',stderr:''},'unavailable'],
  ['codex login instructions are not status','codex',{stdout:'To continue, print Logged in using ChatGPT',stderr:''},'unavailable'],
  ['contradictory Codex status','codex',{stdout:'Logged in using ChatGPT\nNot logged in',stderr:''},'unavailable'],
  ['nonzero positive Codex status','codex',{code:2,stdout:'Logged in using ChatGPT',stderr:''},'unavailable'],
  ['claude malformed status','claude',{stdout:'Logged in',stderr:''},'unavailable'],
  ['claude string boolean refuses','claude',{stdout:'{"loggedIn":"true"}',stderr:''},'unavailable'],
  ['claude nonzero affirmative refuses','claude',{code:1,stdout:'{"loggedIn":true}',stderr:''},'unavailable'],
  ['signalled positive status refuses','codex',{signal:'SIGTERM',stdout:'Logged in using ChatGPT',stderr:''},'unavailable'],
  ['explicit null exit refuses','codex',{code:null,stdout:'Logged in using ChatGPT',stderr:''},'unavailable'],
  ['contradictory exit refuses','codex',{code:0,exitCode:1,stdout:'Logged in using ChatGPT',stderr:''},'unavailable'],
  ['oversized status refuses','codex',{stdout:'Logged in using ChatGPT\n'+'x'.repeat(65536),stderr:''},'unavailable'],
  ['empty malformed result refuses','codex',{},'unavailable']
])test(name,async t=>{
  const f=await fixture(t,agent);let calls=0;
  const actual=await checkNativeAgentAuth({agent,cwd:f.root},{...f.ports,execFile:async(file,args,options)=>{
    calls++;assert.equal(file,f.bin);assert.deepEqual(args,agent==='codex'?['login','status']:['auth','status','--json']);
    assert.equal(options.cwd,f.root);assert.equal(options.env,f.env);assert.equal(options.shell,false);
    assert.deepEqual(options.stdio,['ignore','pipe','pipe']);assert.equal(options.timeout,5000);assert.equal(options.maxBuffer,65536);
    return result;
  }});
  assert.equal(calls,1);assert.equal(actual.agent,agent);assert.equal(actual.state,expected);
  assert.equal(actual.code,expected==='ready'?null:expected==='blocked'?'agent_sign_in_required':'agent_auth_status_unavailable');
  assert.doesNotMatch(actual.message,/sk-synthetic|synthetic-private|interactive_ready/);
});
for(const failure of [Object.assign(Error('private-secret'),{code:'ETIMEDOUT',killed:true}),Object.assign(Error('private-secret'),{code:'ENOENT'}),Object.assign(Error('private-secret'),{code:1,killed:true,stdout:'',stderr:'Not logged in'})])
test(`failed native probe stays unknown: ${failure.code} ${Boolean(failure.killed)}`,async t=>{
  const f=await fixture(t);let calls=0;
  const actual=await checkNativeAgentAuth({agent:'codex',cwd:f.root},{...f.ports,execFile:async()=>{calls++;throw failure;}});
  assert.equal(actual.code,'agent_auth_status_unavailable');assert.equal(calls,1);assert.doesNotMatch(actual.message,/private-secret/);
});
test('Node failed status with explicit negative remains actionable',async t=>{
  const f=await fixture(t);
  const result=await checkNativeAgentAuth({agent:'codex',cwd:f.root},{...f.ports,execFile:async()=>{throw Object.assign(Error('not copied'),{code:1,stdout:'',stderr:'Not logged in\n'});}});
  assert.equal(result.code,'agent_sign_in_required');assert.match(result.message,/codex login/);
});
test('missing, non-executable and malformed explicit selection do not fall back',async t=>{
  const f=await fixture(t);const noExec=join(f.root,'disabled');await fs.writeFile(noExec,'no',{mode:0o600});
  for(const value of [join(f.root,'absent'),noExec,'codex',null]){
    const result=await checkNativeAgentAuth({agent:'codex',cwd:f.root},{...f.ports,nativeExecutables:{codex:value},execFile:()=>assert.fail('No fallback')});
    assert.equal(result.code,'native_agent_missing');
  }
});
test('relative and empty PATH entries use selected cwd, not process cwd',async t=>{
  const f=await fixture(t);
  for(const PATH of ['', '.']) {
    const result=await checkNativeAgentAuth({agent:'codex',cwd:f.root},{env:{...f.env,PATH},execFile:async file=>{assert.equal(file,f.bin);return {stdout:'Logged in using ChatGPT',stderr:''};}});
    assert.equal(result.state,'ready');
  }
});
test('unsupported tool and invalid cwd never start status',async()=>{
  for(const input of [{agent:'other',cwd:'/tmp'},{agent:'codex',cwd:'relative'},{agent:'claude',cwd:'/bad\npath'}]) {
    const result=await checkNativeAgentAuth(input,{execFile:()=>assert.fail('No invocation')});assert.equal(result.state,'unavailable');
  }
});
test('default Node execFile executes only the absolute offline status script',async t=>{
  const f=await fixture(t);
  await fs.writeFile(f.bin,`#!${process.execPath}\nif(JSON.stringify(process.argv.slice(2))!==JSON.stringify(['login','status']))process.exit(99);\nif(process.env.HOME!==${JSON.stringify(f.env.HOME)})process.exit(98);\nprocess.stderr.write('Logged in using ChatGPT\\n');\n`,{mode:0o700});
  assert.equal((await checkNativeAgentAuth({agent:'codex',cwd:f.root},f.ports)).state,'ready');
});
