import test from 'node:test';
import assert from 'node:assert/strict';
import vectors from '../../vectors/cli/workflow-projects.json' with {type:'json'};
import {listWorkflowProjects,resolveWorkflowProject} from '../../src/workflow-projects.mjs';
const machineId='m1';
function entry(e) {return {machineId,lastUsedAt:null,availability:'local',root:'/work/'+e.id,repository:null,...e,
  ...(typeof e.repository==='string'?{repository:{url:e.repository}}:{})};}
function make(g) {
  const sources={};
  for(const name of ['codexHistory','claudeHistory','herdr','runs','usualPlaces','github'])sources[name]={read:async()=>[]};
  if(g.sourceResults) for(const [name,names] of Object.entries(g.sourceResults))sources[name]={read:async()=>names.map((n,i)=>entry({id:name+i,name:n}))};
  if(g.entries)for(const e of g.entries) {const source=e.source??'runs', previous=sources[source].read;sources[source].read=async()=>[...await previous(),entry(e)];}
  if(g.runs)sources.runs={read:async()=>g.runs.map(entry)};
  if(g.codexHistory==='unavailable')sources.codexHistory.read=async()=>{throw Error('sensitive');};
  return {sources,checkLocal:async()=>g.checkLocal??true};
}
for(const v of vectors.cases.filter(v=>['listWorkflowProjects','resolveWorkflowProject'].includes(v.when.operation))) test(v.id,async()=>{
  const p=make(v.given),e=v.expected;
  const result=v.when.operation==='listWorkflowProjects'?await listWorkflowProjects({machineId},p):await resolveWorkflowProject({machineId,query:v.given.query},p);
  if(e.state)assert.equal(result.state,e.state);
  if(e.names)assert.deepEqual(result.projects.map(p=>p.name),e.names);
  if(e.ids)assert.deepEqual(result.projects.map(p=>p.id),e.ids);
  if(e.projectCount)assert.equal(result.projects.length,e.projectCount);
  if(e.sources)assert.deepEqual(result.projects[0].sources,e.sources);
  if(e.candidateIds)assert.deepEqual(result.candidates.map(p=>p.id),e.candidateIds);
  if(e.contextLabels)assert.deepEqual(result.candidates.map(p=>p.repository.url),e.contextLabels);
  if(e.projectId)assert.equal(result.project.id,e.projectId);
  if(e.cwd)assert.equal(result.project.root,e.cwd);
  if(e.warningsContainSource)assert.ok(result.warnings.some(w=>w.source===e.warningsContainSource));
});
test('root identity conflict drops the root regardless of source order, retaining healthy sources',async()=>{
  const g={entries:[{id:'a',name:'App',root:'/work/app',source:'herdr'},{id:'b',name:'App',root:'/work/app',source:'runs'},{id:'c',name:'Calendar',root:'/work/cal'}]};
  const result=await listWorkflowProjects({machineId},make(g));assert.deepEqual(result.projects.map(p=>p.id),['c']);assert.ok(result.warnings.some(w=>w.code==='identity_conflict'));
});
test('a GitHub repository associates with a clone without collapsing separate checkouts',async()=>{
  const p=make({entries:[{id:'a',name:'App',root:'/one/app',repository:'https://example.test/app'},{id:'b',name:'App',root:'/two/app',repository:'https://example.test/app'},
    {id:'g',name:'App',root:null,availability:'not_cloned',repository:'https://example.test/app'}]});
  assert.deepEqual((await listWorkflowProjects({machineId},p)).projects.map(p=>p.id),['a','b']);
});
test('malformed source entries give bounded metadata warnings, never raw source errors',async()=>{
  const p=make({entries:[{id:'a',name:'App',root:'relative'},{id:'b',name:'App',root:'/work/app'}]});
  const r=await listWorkflowProjects({machineId},p);assert.deepEqual(r.projects.map(p=>p.id),['b']);assert.deepEqual(r.warnings,[{source:'runs',code:'invalid_entries'}]);
  p.checkLocal=undefined;assert.equal((await resolveWorkflowProject({machineId,query:'App'},p)).state,'unavailable');
});
