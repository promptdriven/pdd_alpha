import test from 'node:test';
import assert from 'node:assert/strict';
import vectors from '../../vectors/cli/workflow-models.json' with {type:'json'};
import {listWorkflowModels,resolveWorkflowModel} from '../../src/workflow-models.mjs';
const input={machineId:'m1',agent:'codex'};
function ports(g={}) {
  const supported={a:['low','high','ultra'],b:['low','high'],...(g.supported??{})};
  let models=Object.entries(supported).map(([id,efforts])=>({id,label:id,hidden:false,efforts,defaultEffort:efforts[0]??null}));
  if(g.nativeCatalog?.models) models=g.nativeCatalog.models.map(m=>({...m,label:m.id,defaultEffort:m.efforts[0]}));
  if(g.modelB) models=models.filter(m=>m.id!=='b').concat({id:'b',label:'B',hidden:false,...g.modelB});
  if(g.nativeModels) models.push(...g.nativeModels.map(m=>({...m,label:m.id,efforts:['high'],defaultEffort:'high'})));
  const native={...input,cliVersion:'1.2',revision:'observed',models,nativeDefaults:g.nativeDefaults??{model:'a',effort:'low'}};
  if(g.requestedMachineId) native.machineId=g.catalogMachineId;
  return {nativeCatalog:{read:async()=>{if(g.nativeCatalog==='throws'||g.acceptedEffortsEvidence===null)throw Error('unavailable');return native;}},
    toolDefaults:{read:async()=>g.settings??null}};
}
const moduleCases=vectors.cases.filter(v=>!['recovery-consumer','handoff-consumer'].includes(v.when.operation));
for(const v of moduleCases) test(v.id,async()=>{
  const g=v.given, args={...input,...(g.requestedMachineId?{machineId:g.requestedMachineId}:{}),...(g.agent?{agent:g.agent}:{}),...(g.selection?{selection:g.selection}:{})};
  const p=ports(g);
  const before=structuredClone(g);
  const result=v.when.operation==='listWorkflowModels'?await listWorkflowModels(args,p):await resolveWorkflowModel(args,p);
  const e=v.expected;
  if(e.state)assert.equal(result.state,e.state);
  if(e.code)assert.equal(result.code,e.code);
  if(e.visibleIds)assert.deepEqual(result.catalog.models.map(m=>m.id),e.visibleIds);
  if(e.efforts)for(const [id,values] of Object.entries(e.efforts))assert.deepEqual(result.catalog.models.find(m=>m.id===id).efforts,values);
  for(const key of ['model','effort','source'])if(Object.hasOwn(e,key))assert.equal(result.selection?.[key],e[key]);
  assert.deepEqual(g,before);
});
test('malformed defaults, duplicate models and failing settings refuse without fallback',async()=>{
  for(const mutation of [raw=>{raw.models=[];},raw=>{raw.models.push(raw.models[0]);},raw=>{raw.nativeDefaults={model:'missing',effort:'low'};},raw=>{raw.models[0].defaultEffort='unsupported';}]) {
    const p=ports(),read=p.nativeCatalog.read;p.nativeCatalog.read=async()=>{const raw=await read();mutation(raw);return raw;};
    assert.deepEqual(await resolveWorkflowModel(input,p),{state:'refused',code:'catalog_unavailable'});
  }
  const p=ports();p.toolDefaults.read=async()=>{throw Error('secret exception');};
  assert.equal((await listWorkflowModels(input,p)).code,'catalog_unavailable');
});
