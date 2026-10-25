import test from 'node:test';
import assert from 'node:assert/strict';
import {WORKFLOW_STAGES} from '../../src/workflow-definitions.mjs';
import vectors from '../../vectors/cli/workflow-definitions.json' with {type:'json'};
for(const v of vectors.cases.filter(v=>!['custom-runtime-names','pdd-specification-gate'].includes(v.id)))test(v.id,()=>{
  const e=v.expected;
  if(e.stageCounts)for(const [name,count]of Object.entries(e.stageCounts))assert.equal(WORKFLOW_STAGES[name].length,count);
  if(e.stageIds)assert.deepEqual(WORKFLOW_STAGES.feature.map(s=>s.id),e.stageIds);
  if(e.optionalStageIds)assert.deepEqual(WORKFLOW_STAGES.feature.filter(s=>s.optional).map(s=>s.id),e.optionalStageIds);
  if(e.maximumNativeSessions)assert.deepEqual(['feature','bug','small-change'].map(n=>WORKFLOW_STAGES[n].filter(s=>s.kind==='agent').length),e.maximumNativeSessions);
  if(e.definitionsUnchanged)assert.throws(()=>{WORKFLOW_STAGES.feature[0].id='changed';},TypeError);
});
test('every bundled proposal supplies prompt, Story and independent case roles before work',()=>{
 for(const steps of Object.values(WORKFLOW_STAGES))assert.ok(['prompt','story','cases'].every(role=>steps.find(s=>s.protocol==='proposal').requiredRoles.includes(role)));
});
