import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {selectStartTarget,dispatchStart} from '../../src/workflow-placement.mjs';
const vectors = JSON.parse(await readFile(new URL('../../vectors/cli/workflow-placement.json',import.meta.url),'utf8'));
const repository = {url:'https://github.com/example/app.git',ref:'8f2c80b9c0c6a7b9d4e5f60123456789abcdef01'};
const startId = '37410c44-2fc5-4f75-91fd-e6aaf5fb89d0';
for (const c of vectors.cases.filter(c=>c.when.call === 'selectStartTarget')) test(c.id,async()=>{
  const given = structuredClone(c.given), calls = [];
  // These two eligibility cases predate the explicit repository gate. Supply the prerequisite to exercise their independent gate expectations.
  if (['workflow-source-ineligible-no-untagged-fallback','candidate-ineligible-each-supplied-gate'].includes(c.id)) given.repository = repository;
  const machines = typeof given.candidates === 'string' ? vectors.fixtures[given.candidates] : given.candidates ?? [];
  const port = {listOwnMachines:async input=>{calls.push(input);return {machines};},start:async()=>assert.fail('selection cannot start'),inspect:async()=>assert.fail('selection cannot inspect a start')};
  const actual = await selectStartTarget(given,{machinePlacement:given.machinePlacementPort === null ? null : port});
  for (const [key,value] of Object.entries(c.expected.result)) assert.deepEqual(actual[key],value);
  if (c.expected.machineListCalls !== undefined) assert.equal(calls.length,c.expected.machineListCalls);
  if (calls.length) assert.equal(calls[0].need,given.kind === 'workflow' ? 10 : 3);
});
for (const c of vectors.cases.filter(c=>c.when.call === 'dispatchStart')) test(c.id,async()=>{
  const calls = [];
  const port = {start:async input=>{calls.push(['start',input]);if(c.when.startReply === 'lost')throw Error('lost');return c.when.portReply;},inspect:async input=>{calls.push(['inspect',input]);return c.when.inspectReply;}};
  const actual = await dispatchStart(c.given,{machinePlacement:port});
  for (const [key,value] of Object.entries(c.expected.result)) assert.deepEqual(actual[key],value);
  if(c.expected.portStartInput) assert.deepEqual(calls[0][1],c.expected.portStartInput);
  if(c.expected.calls) assert.deepEqual(calls.map(([op,input])=>`${op}(${input.targetMachineId},${input.startId})`),c.expected.calls);
  if(c.expected.remoteStartCalls === 0) assert.equal(calls.length,0);
});
test('remote receipt carries target project and defaults without sending account/source defaults',async()=>{
  let request;
  const result = await dispatchStart({kind:'session',target:{id:'studio',name:'Studio'},startId,agent:'codex',repository,project:{id:'p1',name:'Calendar'},sourceDefaults:{model:'source-a',effort:'ultra'},selectionOverrides:null,cwd:'/private',environment:{TOKEN:'secret'},account:'private'}, {machinePlacement:{start:async input=>{request=input;return {state:'started',targetMachineId:'studio',startId,sessionId:'s1',project:{id:'target-p1',name:'Calendar'},launchSelection:{model:'target-b',effort:'high'}};},inspect:async()=>assert.fail('receipt is proved')}});
  assert.deepEqual(result.launchSelection,{model:'target-b',effort:'high'});assert.equal(result.project.name,'Calendar');
  assert.deepEqual(Object.keys(request).sort(),['agent','kind','project','repository','startId','targetMachineId']);
});
test('malformed inventory and unavailable integration fail closed',async()=>{
  const input = {kind:'session',agent:'codex',sourceMachineId:'source',repository};
  for (const listOwnMachines of [async()=>{throw Error('down');},async()=>({machines:[{id:'partial'}]})]) {
    const r=await selectStartTarget(input,{machinePlacement:{listOwnMachines,start(){},inspect(){}}});assert.equal(r.code,'placement_unavailable');
  }
});
test('missing or invalid on is refused before inventory',async()=>{
  for(const on of ['',null,false])assert.equal((await selectStartTarget({kind:'session',on})).code,'bad_args');
});
test('exact named duplicate is ambiguous and never falls through',async()=>{
  const machines = vectors.fixtures.tieCandidates.map(m=>({...m,name:'Same'}));
  assert.equal((await selectStartTarget({kind:'session',on:'Same',sourceMachineId:'source',agent:'codex',repository},{machinePlacement:{listOwnMachines:async()=>({machines}),start(){},inspect(){}}})).code,'ambiguous_machine');
});
test('mismatched reply inspects original once and never accepts another workflow id',async()=>{
  const calls=[];const result=await dispatchStart({kind:'workflow',target:{id:'target'},startId,agent:'claude',repository,workflow:{name:'feature',issue:'1'}},{machinePlacement:{start:async input=>{calls.push(input);return {state:'started',startId,targetMachineId:'target',runId:'other'};},inspect:async input=>{calls.push(input);return {state:'absent'};}}});
  assert.equal(result.state,'uncertain');assert.equal(calls.length,2);assert.deepEqual(calls[1],{targetMachineId:'target',startId});
});
test('ordinary credential-free Git SSH dispatch preserves the canonical URL',async()=>{
  for(const url of ['ssh://git@github.com/example/app.git','git@github.com:example/app.git']) {
    let sent;
    const actual=await dispatchStart({kind:'workflow',target:{id:'target'},startId,agent:'codex',repository:{...repository,url},workflow:{name:'feature',issue:'17'}},{machinePlacement:{start:async input=>{sent=input;return {state:'started',targetMachineId:'target',startId,runId:startId};},inspect:async()=>assert.fail('proved start')}});
    assert.equal(actual.state,'started');assert.equal(sent.repository.url,url);
  }
});
test('SSH repository credentials, alternate users, ports and traversal refuse before effects',async()=>{
  for(const url of ['ssh://git:secret@github.com/example/app.git','ssh://user@github.com/example/app.git','ssh://git@github.com:2222/example/app.git','git:secret@github.com:example/app.git','git@github.com:example/../app.git','ssh://git@github.com/example/../app.git','ssh://git@github.com/example/app.git?token=secret','git@github.com:example/app.git#fragment']) {
    const actual=await dispatchStart({kind:'workflow',target:{id:'target'},startId,agent:'codex',repository:{...repository,url},workflow:{name:'feature',issue:'17'}},{machinePlacement:{start:async()=>assert.fail('unsafe repository must have no effect'),inspect:async()=>assert.fail('unsafe repository must have no effect')}});
    assert.equal(actual.code,'repository_unavailable',url);
  }
});
