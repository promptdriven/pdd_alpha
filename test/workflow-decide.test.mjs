import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {decideWorkflow} from '../src/workflow-decide.mjs';
import vectors from '../vectors/cli/workflow-decide.json' with {type:'json'};
const id='6f1c2d3e-0a1b-4c2d-8e3f-1a2b3c4d5e6f',did='0b7e9a10-2c3d-4e5f-9a6b-7c8d9e0f1a2b';
async function fixture(t) {
  const root=await realpath(await mkdtemp(join(tmpdir(),'pdd-decide-')));t.after(()=>rm(root,{recursive:true,force:true}));
  const assignment={gitDir:join(root,'git'),worktreePath:join(root,'worktree')},runDir=join(assignment.gitDir,'pdd','workflows',id);await mkdir(runDir,{recursive:true});
  const state={runId:id,assignment,definitions:[{id:'approve',kind:'human'}],index:0,seq:57,p1:true,controlState:'waiting_person',waitingPerson:{rev:57,stage:'approve',inputRevision:'head',decisions:['approve']},runtime:{node:'/old/node',bin:'/old/bin/pdd.mjs'},name:'feature',issue:{number:17}};
  const input={runId:id,decisionId:did,decision:'approve',expectedRev:57,cwd:assignment.worktreePath,packageRoot:root};let starts=0,last;
  const ports={lookupIssueWorktree:async()=>({state:'ready',assignment}),readWorkflowJournal:async()=>({state,decisions:[]}),isControllerLive:async()=>false,startWorkflowController:async request=>{last=request;starts++;return {state:'started',controller:{herdrSession:'default',workspaceId:'w1',tabId:'t1',paneId:'p1',started:true,launchId:id,generation:1,pid:123,startIdentity:'exact'},code:null};}};
  return {root,assignment,runDir,state,input,ports,starts:()=>starts,last:()=>last};
}
for(const c of vectors.cases.filter(c=>c.expected.result?.code==='bad_args'))test(c.id,async()=>{
  const result=await decideWorkflow(c.when.args,{lookupIssueWorktree:async()=>assert.fail('malformed arguments must not read')});assert.equal(result.code,'bad_args');assert.equal(result.exitCode,2);if(c.expected.messageMustNotContain)assert.ok(!result.message.includes(c.expected.messageMustNotContain));
});
test('current-rev-proof uses saved runtime, saves before launch, and retry starts nothing twice',async t=>{
  const f=await fixture(t),start=f.ports.startWorkflowController;f.ports.startWorkflowController=async input=>{const intent=JSON.parse(await readFile(join(f.runDir,'decide',did+'.json'),'utf8'));assert.equal(intent.phase,'intent');assert.deepEqual(intent.expect,{rev:57,stage:null,seq:null});return start(input);};
  const r=await decideWorkflow(f.input,f.ports);assert.equal(r.state,'started');assert.deepEqual(f.last().runtime,f.state.runtime);assert.equal(f.last().decision.rev,57);assert.equal(f.last().decision.id,did);
  assert.equal((await decideWorkflow(f.input,f.ports)).state,'started');assert.equal(f.starts(),1);
});
for(const kind of ['stale-rev','both-bindings-required','completed'])test(kind,async t=>{
  const f=await fixture(t);if(kind==='stale-rev')f.state.waitingPerson.rev=58;if(kind==='both-bindings-required'){f.input.expectStage='different';f.input.expectSeq=57;}if(kind==='completed')f.state.index=1;
  const r=await decideWorkflow(f.input,f.ports);assert.equal(r.code,'stale_decision');assert.equal(f.starts(),0);
});
test('recorded-before-stale and changed-id payload domain are exact',async t=>{
  const f=await fixture(t);f.state.decisions=[{decisionId:did,decision:'approve',expect:{rev:57,stage:null,seq:null}}];f.state.index=1;
  assert.equal((await decideWorkflow(f.input,f.ports)).state,'recorded');assert.equal((await decideWorkflow({...f.input,decision:'skip'},f.ports)).code,'bad_args');assert.equal((await decideWorkflow({...f.input,expectedRev:58},f.ports)).code,'bad_args');assert.equal(f.starts(),0);
});
test('intent-uncertain is inspection-only and a corrupt intent never relaunches',async t=>{
  const f=await fixture(t);await mkdir(join(f.runDir,'decide'));await writeFile(join(f.runDir,'decide',did+'.json'),'{');assert.equal((await decideWorkflow(f.input,f.ports)).state,'uncertain');assert.equal(f.starts(),0);
});
test('typed-without-proof preserves uncertainty on every retry',async t=>{
  const f=await fixture(t);let n=0;f.ports.startWorkflowController=async()=>{n++;return {state:'started',controller:{paneId:'p1'}};};assert.equal((await decideWorkflow(f.input,f.ports)).state,'uncertain');assert.equal((await decideWorkflow(f.input,f.ports)).state,'uncertain');assert.equal(n,1);
});
test('legacy-pair uses exact journal sequence; heartbeat never changes current request revision',async t=>{
  const f=await fixture(t);f.input.expectedRev=undefined;f.input.expectStage='approve';f.input.expectSeq=57;assert.equal((await decideWorkflow(f.input,f.ports)).state,'started');
  const g=await fixture(t);g.state.seq=60;assert.equal((await decideWorkflow(g.input,g.ports)).state,'started');
});
for(const kind of ['held-controller','unknown-controller-lock','status-is-not-authority'])test(kind,async t=>{
  const f=await fixture(t);if(kind!=='status-is-not-authority')f.ports.isControllerLive=async()=>true;else{f.state.controlState='running';f.state.waitingPerson=null;}
  assert.equal((await decideWorkflow(f.input,f.ports)).code,kind==='status-is-not-authority'?'stale_decision':'run_not_waiting');assert.equal(f.starts(),0);
});
for(const kind of ['damaged-history','incomplete-decision-scan'])test(kind,async t=>{
  const f=await fixture(t);f.ports.readWorkflowJournal=async()=>{throw Error('damaged journal');};assert.equal((await decideWorkflow(f.input,f.ports)).state,'failed');assert.equal(f.starts(),0);
});
test('unknown-run has no launch or metadata writes',async t=>{
  const f=await fixture(t);f.ports.lookupIssueWorktree=async()=>({state:'recovery_required'});assert.equal((await decideWorkflow(f.input,f.ports)).code,'unknown_run');assert.equal(f.starts(),0);
});
test('unadopted old runtime refuses before launch',async t=>{
  const f=await fixture(t);delete f.state.p1;assert.equal((await decideWorkflow(f.input,f.ports)).code,'unsupported');assert.equal(f.starts(),0);
});
test('unsafe initial intent directory leaves Herdr untouched',async t=>{
  const f=await fixture(t);await writeFile(join(f.runDir,'decide'),'not a directory');assert.equal((await decideWorkflow(f.input,f.ports)).state,'uncertain');assert.equal(f.starts(),0);
});
