import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {encodeWorkflowJournalRecord as encode,replayWorkflowJournalRecord as replay} from '../src/workflow-journal.mjs';
import {readJournalLast,readJournalSince} from '../src/workflow-run-records.mjs';
const runId='123e4567-e89b-42d3-a456-426614174000';
const initial=()=>({seq:1,runId,context:'frozen context 🎯'.repeat(4000),nested:{retained:null,remove:'old',list:[1,2]},unknown:{kept:true}});
test('compact records retain frozen context once and replay nested replacement, removal, null and arrays',()=>{
  const before=initial(),first=encode(null,before,{event:'run.started'});
  const after=structuredClone(before);after.seq=2;delete after.nested.remove;after.nested.retained=false;after.nested.list=[null,3];after.added={yes:1};
  const delta=encode(before,after,{event:'agent.backend',decisionId:'bound'});
  assert.equal(Object.hasOwn(delta,'state'),false);assert.ok(Buffer.byteLength(JSON.stringify(delta))<1000);
  assert.equal(JSON.stringify(delta).includes('frozen context'),false);assert.equal(delta.decisionId,'bound');
  const actual=replay(replay(null,first),delta);assert.deepEqual(actual,after);assert.deepEqual(before,initial());
  assert.deepEqual(replay(null,{seq:1,event:'legacy',state:before}),before);
});
test('periodic snapshots and JSON prototype-like field names preserve exact state without prototype mutation',()=>{
  let previous=initial(),row;
  for(let seq=2;seq<=128;seq++){
    const next=structuredClone(previous);next.seq=seq;next.nested.counter=seq;
    if(seq===3)Object.defineProperty(next.nested,'__proto__',{value:{retained:'own field'},enumerable:true,writable:true,configurable:true});
    row=encode(previous,next,{event:'agent.backend'});assert.deepEqual(replay(previous,row),next);
    if(seq<128)assert.equal(Object.hasOwn(row,'state'),false);
    previous=next;
  }
  assert.ok(row.state);assert.equal(row.state.seq,128);assert.equal({}.retained,undefined);
});
test('delta refuses missing or wrong base, sequence gaps, ambiguous forms and malformed overlapping paths',()=>{
  const before=initial(),after={...before,seq:2,nested:{changed:true}},delta=encode(before,after,{event:'changed'});
  for(const row of [
    {...delta,baseSeq:0},{...delta,seq:3},{...delta,runId:'other'}, {...delta,v:99},
    {...delta,state:after},{...delta,delta:[{path:[],value:0}]},
    {...delta,delta:[{path:['seq'],value:2}]},
    {...delta,delta:[{path:['missing','nested'],value:1}]},
    {...delta,delta:[{path:['nested'],value:{}},{path:['nested','changed'],value:true}]},
    {...delta,delta:[{path:['nested','remove'],remove:true,value:null}]}
  ])assert.throws(()=>replay(before,row),/journal/);
  assert.throws(()=>replay(undefined,delta),/journal/);
});
test('display tail reconstructs mixed history and never falls back past a damaged delta',async t=>{
  const home=await fs.mkdtemp(join(tmpdir(),'pdd-journal-display-'));t.after(()=>fs.rm(home,{recursive:true,force:true}));
  const dir=join(home,runId);await fs.mkdir(dir);const path=join(dir,'journal.jsonl');
  const first=initial(),second={...first,seq:2,nested:{latest:true}},delta=encode(first,second,{event:'agent.backend'});
  const raw=JSON.stringify({seq:1,event:'legacy',state:first})+'\n'+JSON.stringify(delta)+'\n';await fs.writeFile(path,raw);
  assert.deepEqual((await readJournalLast(dir)).value,{seq:2,event:'agent.backend',state:second});
  assert.deepEqual((await readJournalSince(dir,1)).records,[{seq:2,event:'agent.backend',decisionId:null}]);
  await fs.appendFile(path,'partial');const partial=await readJournalLast(dir);assert.equal(partial.value.state.seq,2);assert.deepEqual(partial.warnings,['partial_line']);
  await fs.writeFile(path,raw+JSON.stringify({...delta,seq:3,baseSeq:1})+'\n');
  const invalid=await readJournalLast(dir);assert.equal(invalid.value,null);assert.ok(invalid.warnings.includes('bad_record'));
  await fs.writeFile(path,JSON.stringify(delta)+'\n');assert.equal((await readJournalLast(dir)).value,null);
});
