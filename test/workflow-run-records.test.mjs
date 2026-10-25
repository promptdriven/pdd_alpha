import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vectors from '../vectors/cli/workflow-run-records.json' with { type: 'json' };
import { appendRunIndex, readRunIndex, runStatusFromState, writeRunStatus, readRunStatus, readJournalLast, readJournalSince, readAssignedRuns } from '../src/workflow-run-records.mjs';

const repeat = value => value && typeof value === 'object' && '$repeat' in value ? String(value.$repeat[0]).repeat(value.$repeat[1]) : Array.isArray(value) ? value.map(repeat) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k,v])=>[k,repeat(v)])) : value;
const subset = (actual, expected) => { if (expected && typeof expected === 'object' && !Array.isArray(expected)) for (const [k,v] of Object.entries(expected)) subset(actual?.[k],v); else assert.deepEqual(actual, expected); };
function stateFor(given) {
  const base = structuredClone(vectors.fixtures.S_human); base.definitions = structuredClone(vectors.fixtures.D);
  if (typeof given === 'string') return base;
  if (given?.state === 'S_human') Object.assign(base, structuredClone(given.with ?? {}));
  else if (given?.state && typeof given.state === 'object') {
    if (!given.state.fixture) return structuredClone(given.state);
    const source = given.state.fixture ? vectors.fixtures[given.state.fixture] : given.state;
    Object.assign(base, structuredClone(source)); Object.assign(base, structuredClone(given.state.with ?? {}));
    if (typeof base.definitions === 'string') base.definitions = structuredClone(vectors.fixtures[base.definitions]);
  }
  if (given?.journal) Object.assign(base,structuredClone(given.journal));
  if (given?.controlState) base.controlState=given.controlState;
  if (given?.origin) base.waitingPerson={origin:given.origin,questionId:given.questionId,rev:given.rev,decisions:given.decisions};
  if (given?.rev) base.rev=given.rev;
  return base;
}

test('workflow run record status vectors execute independently expected derivation', () => {
  for (const vector of vectors.cases.filter(c => c.when.call === 'runStatusFromState')) {
    const quotaExtras=vector.given?.origin==='quota'?{phase:'exit',outcome:{state:'waiting'}}:{};
    const input=stateFor(vector.given),before=structuredClone(input);
    const actual = runStatusFromState(input, { ...quotaExtras,...vector.when.extras, heartbeatAt:vector.given?.heartbeatAt, outcome: repeat(vector.when.extras?.outcome??quotaExtras.outcome) });
    const expected = repeat(vector.expected);
    if (expected.stepStateOf) for (const [id,state] of Object.entries(expected.stepStateOf)) assert.equal(actual.steps.find(s=>s.id===id)?.state,state,vector.id);
    const {stepStateOf, threw, runtimeSource, journalWrites, effectsAuthorized, ordinaryWorkflowApprovalGranted, ...rest} = expected; subset(actual,rest);
    assert.deepEqual(input,before);
    if(runtimeSource)assert.deepEqual(actual.runtime,vector.given.journal.runtime);
    if(ordinaryWorkflowApprovalGranted===false)assert.deepEqual(actual.resumeDecisions,[]);
  }
});

test('workflow run record file vectors execute against real temporary files', async t => {
  const home = await mkdtemp(join(tmpdir(),'pdd-records-')); const runId = vectors.fixtures.runId;
  const runDir = join(home,'repo','.git','pdd','workflows',runId); await mkdir(runDir,{recursive:true});
  t.after(()=>rm(home,{recursive:true,force:true}));
  const ports = {home, randomBytes:()=>Buffer.from('0102030405060708','hex')};
  const entry={v:1,runId,workflow:'feature-lite',repo:'octo/app',issue:{number:7,url:'https://github.com/octo/app/issues/7'},agent:'codex',root:join(home,'worktree'),runDir,startedAt:1,pdd:{node:'/node',bin:'/pdd',version:'1'}};
  assert.deepEqual(await appendRunIndex(entry,ports),{ok:true}); assert.equal((await readRunIndex(ports)).entries.length,1);
  assert.deepEqual(await writeRunStatus(runDir,{v:1,runId,journalSeq:2,state:'waiting',steps:[{id:'a',state:'later'}]},ports),{ok:true});
  assert.equal((await readRunStatus(runDir,ports)).value.state,'waiting');
  await writeFile(join(runDir,'journal.jsonl'),`{"seq":1,"event":"a","state":{"runId":"${runId}"}}\n{"seq":2,"event":"b","decisionId":"d","state":{"runId":"${runId}"}}\n`);
  assert.equal((await readJournalLast(runDir,ports)).value.seq,2); assert.deepEqual((await readJournalSince(runDir,1,ports)).records.map(r=>r.seq),[2]);
  const issueDir=join(home,'repo','.git','pdd','worktree-assignments','issues'); await mkdir(issueDir,{recursive:true});
  await writeFile(join(issueDir,'7.json'),JSON.stringify({version:1,runId,repository:'octo/app',issueNumber:7,workflowName:'feature-lite',gitDir:join(home,'repo','.git'),worktreePath:join(home,'worktree')}));
  assert.equal((await readAssignedRuns(join(home,'repo','.git'),ports)).entries.length,1);
});
