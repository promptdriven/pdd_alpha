import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join,dirname} from 'node:path';
import * as records from '../../src/workflow-run-records.mjs';
import vectors from '../../vectors/cli/workflow-run-records.json' with {type:'json'};
import {folder,runId} from './runner-a-fixtures.mjs';
const expand=v=>v&&typeof v==='object'&&'$repeat'in v?String(v.$repeat[0]).repeat(v.$repeat[1]):Array.isArray(v)?v.map(expand):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,v])=>[k,expand(v)])):v;
function subset(a,e){if(e&&typeof e==='object'&&!Array.isArray(e)){for(const[k,v]of Object.entries(e))subset(a?.[k],v);}else if(Array.isArray(e)){assert.equal(a.length,e.length);e.forEach((v,i)=>subset(a[i],v));}else assert.deepEqual(a,e);}
for(const c of vectors.cases.filter(c=>c.given?.files&&['appendRunIndex','readRunIndex','writeRunStatus','readRunStatus','readJournalLast','readJournalSince','readAssignedRuns'].includes(c.when.call)))test(`records file vector: ${c.id}`,async t=>{
  const home=await folder(t),runDir=join(home,'app','.git','worktrees','w1','pdd','workflows',vectors.fixtures.runId);await fs.mkdir(runDir,{recursive:true});
  const pathOf=p=>p.replace('RUNDIR',runDir).replace(/^\/home\/user/,home);
  for(const[path,value]of Object.entries(expand(c.given.files))){const target=pathOf(path);await fs.mkdir(dirname(target),{recursive:true});await fs.writeFile(target,Array.isArray(value)?value.join(''):typeof value==='string'?value:JSON.stringify(value));}
  const touched=[],ports={home,randomBytes:()=>Buffer.from(c.given.randomBytes??'0102030405060708','hex'),fs:{...fs,open:async(path,...args)=>{touched.push(path);return fs.open(path,...args);}}};
  if(c.given.fsFails?.rename)ports.fs.rename=async()=>{throw Object.assign(Error('rename failed'),{code:c.given.fsFails.rename});};
  const call=c.when.call;let actual;
  if(call==='appendRunIndex')actual=await records[call](expand(c.when.entry),ports);
  else if(call==='readRunIndex')actual=await records[call](ports);
  else if(call==='writeRunStatus')actual=await records[call](runDir,expand(c.when.status),ports);
  else if(call==='readJournalSince')actual=await records[call](runDir,c.when.afterSeq,ports);
  else if(call==='readAssignedRuns')actual=await records[call](pathOf(c.when.commonDir),ports);
  else actual=await records[call](runDir,ports);
  const e=expand(c.expected);
  if(e.result)subset(actual,e.result);
  if(e.entries)subset(actual.entries,e.entries);
  if(e.dropped!==undefined)assert.equal(actual.dropped,e.dropped);
  if('value'in e)subset(actual.value,e.value);
  if('complete'in e)assert.equal(actual.complete,e.complete);
  if(e.records)assert.deepEqual(actual.records,e.records);
  for(const w of e.warningsInclude??[])assert.ok(actual.warnings.includes(w));
  for(const p of e.filesAbsent??[])await assert.rejects(fs.stat(pathOf(p)),{code:'ENOENT'});
  for(const[p,expected]of Object.entries(e.files??{})){
    const raw=await fs.readFile(pathOf(p),'utf8');
    if(typeof expected==='string')assert.equal(raw,expected.includes(', unchanged>')?expand(c.given.files[p]):expected);
    else {if(expected.line0)subset(JSON.parse(raw.split('\n')[0]),expected.line0);if(expected.endsWithNewline)assert.ok(raw.endsWith('\n'));if(expected.lineCount)assert.equal(raw.trimEnd().split('\n').length,expected.lineCount);if(expected.json)subset(JSON.parse(raw),expected.json);if(expected.mode)assert.equal(((await fs.stat(pathOf(p))).mode&0o777).toString(8),expected.mode.replace(/^0/,''));}
  }
  for(const p of e.pathsNeverOpened??[])assert.ok(!touched.includes(pathOf(p)));
});
for(const c of vectors.cases.filter(c=>['actual-account-and-machine-target','blocked-runtime-notice','names-and-model-frozen','successor-model-observed-separately'].includes(c.id)))test(`records P1 vector: ${c.id}`,()=>{
  const g=c.given,state={runId,index:0,definitions:[{id:'work',kind:'agent'}],agent:'codex',...(g.journal??g)};
  if(g.journalRuntimeNotice)state.runtimeNotice=g.journalRuntimeNotice;
  const before=JSON.stringify(state),actual=records.runStatusFromState(state);
  for(const k of ['actualAccount','runtimeNotice','project','launchSelection','effectiveSelection'])if(k in c.expected)assert.deepEqual(actual[k],c.expected[k]);
  if(c.expected.machineTarget)assert.equal(actual.machineToolPolicy.targetAccountId,c.expected.machineTarget);
  assert.equal(JSON.stringify(state),before);
});
test('records archive locator and legacy account fields follow independent cases',async t=>{
  const home=await folder(t),c=vectors.cases.find(c=>c.id==='p1-archive-locator');await records.appendRunIndex(c.given,{home});assert.equal((await records.readRunIndex({home})).entries[0].archived,true);
  const dir=join(home,runId);await fs.mkdir(dir);const legacy=vectors.cases.find(c=>c.id==='legacy-choice-fields-dropped');await records.writeRunStatus(dir,{runId,journalSeq:1,state:'waiting',...legacy.given.statusFields});const out=await records.readRunStatus(dir);assert.deepEqual(out.warnings,legacy.expected.warnings);assert.equal(out.value.actualAccount,legacy.expected.actualAccount);assert.equal('stageMode'in out.value,false);
});
test('status temp collision cannot delete another writer temporary file',async t=>{const dir=await folder(t),path=join(dir,'.status.json.0102030405060708.tmp');await fs.writeFile(path,'other writer');const out=await records.writeRunStatus(dir,{runId},{randomBytes:()=>Buffer.from('0102030405060708','hex')});assert.equal(out.ok,false);assert.equal(await fs.readFile(path,'utf8'),'other writer');});
test('journal traversal stops at sequence boundary without reading older damage',async t=>{const dir=join(await folder(t),runId);await fs.mkdir(dir);await fs.writeFile(join(dir,'journal.jsonl'),'bad older line\n'+JSON.stringify({seq:10,state:{runId}})+'\n'+JSON.stringify({seq:11,event:'new',state:{runId}})+'\n');assert.deepEqual(await records.readJournalSince(dir,10),{records:[{seq:11,event:'new',decisionId:null}],complete:true,warnings:[]});});
test('cross-tool backend without observed selection cannot borrow original model',()=>{const out=records.runStatusFromState({agent:'codex',definitions:[],index:0,launchSelection:{model:'codex-a'},pending:{kind:'agent',backend:{agentKind:'claude'}}});assert.equal(out.effectiveSelection,null);assert.equal(out.stageAgent.kind,'claude');});
test('status reader missing, malformed and invalid sequence variants match cases',async t=>{
  const c=vectors.cases.find(c=>c.id==='status-read-missing-and-bad');
  for(let i=0;i<c.given.variants.length;i++){
    const dir=join(await folder(t),vectors.fixtures.runId);await fs.mkdir(dir);
    for(const content of Object.values(c.given.variants[i].files))await fs.writeFile(join(dir,'status.json'),content);
    const r=await records.readRunStatus(dir);assert.equal(r.value,c.expected.variants[i].value);for(const w of c.expected.variants[i].warningsInclude)assert.ok(r.warnings.includes(w));
  }
});
test('partial journal tail across chunk boundaries is ignored without whole-file reads',async t=>{
  const dir=join(await folder(t),runId);await fs.mkdir(dir);
  await fs.writeFile(join(dir,'journal.jsonl'),JSON.stringify({seq:7,event:'saved',state:{runId}})+'\n'+'x'.repeat(3*1024*1024));
  const lengths=[],ports={fs:{...fs,open:async(...args)=>{const h=await fs.open(...args);const read=h.read.bind(h);h.read=async(...args)=>{lengths.push(args[2]);return read(...args);};return h;}}};
  const r=await records.readJournalLast(dir,ports);assert.equal(r.value.seq,7);assert.deepEqual(r.warnings,['partial_line']);assert.ok(lengths.length>1&&lengths.every(n=>n<=1024*1024));
});
test('P1 revision and backend generation project the journal without changing V1 status fields',async t=>{
  const vector=vectors.cases.find(c=>c.id==='p1-derived-runtime-rev');
  const state={runId,index:0,definitions:[{id:'work',kind:'agent'}],name:'feature',controlState:'WAIT',...vector.given.journal};
  const before=structuredClone(state),status=records.runStatusFromState(state,{phase:'record',now:2000,heartbeatAt:vector.given.heartbeatAt});
  assert.equal(status.rev,vector.expected.rev);assert.equal(status.backendGen,state.backendGen);assert.equal(status.journalSeq,vector.expected.journalSeq);assert.equal(status.heartbeatAt,vector.expected.heartbeatAt);assert.deepEqual(status.runtime,state.runtime);
  assert.equal(status.v,1);assert.equal(status.state,'running');assert.equal(status.controlState,'WAIT');assert.deepEqual(status.stage,{id:'work',kind:'agent',index:0,total:1});assert.deepEqual(status.waitingFor,{decisions:[],what:null});assert.equal(status.accountTransition,null);assert.deepEqual(state,before);
  const dir=join(await folder(t),runId);await fs.mkdir(dir);assert.equal((await records.writeRunStatus(dir,status)).ok,true);const read=await records.readRunStatus(dir);assert.deepEqual(read.warnings,[]);assert.equal(read.value.rev,57);assert.equal(read.value.backendGen,2);assert.equal(read.value.state,'running');
});
