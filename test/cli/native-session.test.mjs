import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import vectors from '../../vectors/cli/native-session.json' with {type:'json'};
import {launchNativeSession} from '../../src/native-session.mjs';
for(const v of vectors.cases) test(v.id,async()=>{
  const calls=[],signals=new EventEmitter(),child=new EventEmitter(),kills=[],stderr={text:'',write(s){this.text+=s;}};
  child.kill=s=>kills.push(s);
  const promise=launchNativeSession({...v.when.args,stderr},{stdinIsTTY:v.given.stdinIsTTY??false,signals,spawn:(...args)=>{
    calls.push(args);if(v.given.installed?.length===0||v.given.spawnError)throw Object.assign(Error('sensitive'),{code:v.given.spawnError??'ENOENT'});return child;
  }});
  for(const signal of v.given.wrapperSignals??[])signals.emit(signal);
  let done=false;promise.then(()=>{done=true;});await Promise.resolve();
  if(v.expected.stillWaiting)assert.equal(done,false);
  child.emit('close',v.given.childExit?.code??(v.given.childExit?.signal?null:0),v.given.childExit?.signal??null);
  const result=await promise;
  if(v.expected.result!==undefined)assert.equal(result,v.expected.result);
  assert.equal(calls.length,1);assert.equal(calls[0][0],v.when.args.agent);assert.equal(calls[0][2].shell,false);assert.equal(calls[0][2].stdio,'inherit');assert.equal(calls[0][2].env,undefined);
  if(v.expected.spawn?.argv) {
    assert.deepEqual(calls[0][1].slice(0,-1),v.expected.spawn.argv.slice(0,-1));
    // The preserved trusted Person request heading is required by native-session's contract.
    assert.ok(calls[0][1].at(-1).includes(v.when.args.context));
    if(v.when.args.request)assert.ok(calls[0][1].at(-1).includes(v.when.args.request));
  }
  if(v.expected.childSignals)assert.deepEqual(kills,v.expected.childSignals);
  for(const signal of ['SIGTERM','SIGHUP','SIGINT'])assert.equal(signals.listenerCount(signal),0);
});
