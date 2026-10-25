import test from 'node:test';
import assert from 'node:assert/strict';
import {runPdd} from '../../src/pdd-cli.mjs';
import {listWorkflowModels,resolveWorkflowModel,resolveWorkflowLaunchModel,createLocalWorkflowModelPorts} from '../../src/workflow-models.mjs';
import {nativeArgs} from '../../src/native-flags.mjs';
const capture=()=>({text:'',write(s){this.text+=s;}});
const input=agent=>({machineId:'local',agent});
const unavailable=(settings=null)=>({nativeCatalog:{read:async()=>{throw Error('secret probe detail');}},toolDefaults:{read:async()=>settings}});
const readable=(settings={model:'observed',effort:'high'})=>({nativeCatalog:{read:async({machineId,agent})=>({machineId,agent,cliVersion:'1',revision:'r1',models:[{id:'observed',label:'Observed',hidden:false,efforts:['high'],defaultEffort:'high'}],nativeDefaults:{model:'observed',effort:'high'}})},toolDefaults:{read:async()=>settings}});
for(const agent of ['codex','claude'])for(const settings of [null,{model:'settings-model',effort:'high'}]) {
  const label=settings?'Settings pair':'native defaults';
  test(`rule10 ${agent}: unavailable list launches with ${label} and one safe warning`,async()=>{
    const stdout=capture(),stderr=capture(),ports=unavailable(settings);let calls=0;
    assert.equal(await runPdd(['session','--agent',agent,'--model','unverifiable-override','--effort','unverifiable-effort'],{stdout,stderr,machineId:'local',modelPorts:ports,nativeSession:async options=>{
      calls++;const args=nativeArgs({agent,cwd:'/synthetic/project',selection:options.selection});
      if(settings) {
        assert.equal(args[args.indexOf(agent==='codex'?'-m':'--model')+1],'settings-model');
        assert.ok(args.includes(agent==='codex'?'model_reasoning_effort="high"':'high'));
      } else {
        assert.equal(args.includes('-m'),false);assert.equal(args.includes('--model'),false);assert.equal(args.includes('--effort'),false);
        assert.equal(args.some(a=>a.startsWith('model_reasoning_effort=')),false);
      }
      assert.ok(args.includes(agent==='codex'?'--dangerously-bypass-approvals-and-sandbox':'--dangerously-skip-permissions'));
      assert.equal(args.includes('unverifiable-override'),false);return 0;
    }}),0);
    assert.equal(calls,1);assert.equal(stderr.text,`Model list unavailable; using ${settings?.model??'native defaults'}\n`);
    assert.doesNotMatch(stdout.text+stderr.text,/secret probe detail/);
  });
  test(`rule10 ${agent}: frozen ${label} survives Settings changes and repeated admission`,async()=>{
    const first=await resolveWorkflowLaunchModel(input(agent),unavailable(settings));
    for(let i=0;i<2;i++) {
      const next=await resolveWorkflowLaunchModel({...input(agent),frozenSelection:first.selection},unavailable({model:'later-default',effort:'low'}));
      assert.equal(next.state,'selected');assert.deepEqual(next.selection,first.selection);
    }
    const available=await resolveWorkflowLaunchModel({...input(agent),frozenSelection:first.selection},readable());
    assert.equal(available.state,settings?'refused':'selected');
    if(!settings)assert.deepEqual(available.selection,first.selection);
  });
}
test('rule10 launch fallback does not relax discovery, Settings validation or known unsupported values',async()=>{
  assert.equal((await listWorkflowModels(input('codex'),unavailable())).code,'catalog_unavailable');
  assert.equal((await resolveWorkflowModel(input('codex'),unavailable())).code,'catalog_unavailable');
  for(const selection of [{model:'hidden-or-unknown'},{effort:'unsupported'}])assert.equal((await resolveWorkflowLaunchModel({...input('codex'),selection},readable())).code,'bad_args');
  assert.equal((await resolveWorkflowLaunchModel(input('codex'),readable({model:'unobserved',effort:'high'}))).code,'catalog_unavailable');
  for(const selection of [{model:''},{effort:null},{arbitrary:'value'}])assert.equal((await resolveWorkflowLaunchModel({...input('codex'),selection},unavailable())).code,'bad_args');
});
test('rule10 never accepts a foreign machine/tool observation or frozen binding',async()=>{
  const local=createLocalWorkflowModelPorts({machineId:'local',cwd:process.cwd(),executable:'/nonexistent-synthetic-codex'});
  assert.equal((await resolveWorkflowLaunchModel({machineId:'other',agent:'codex'},local)).state,'refused');
  for(const raw of [{machineId:'other',agent:'codex',models:[]},{machineId:'local',agent:'claude',models:[]}]) {
    assert.equal((await resolveWorkflowLaunchModel(input('codex'),{...unavailable(),nativeCatalog:{read:async()=>raw}})).state,'refused');
  }
  const frozen=(await resolveWorkflowLaunchModel(input('codex'),unavailable())).selection;
  for(const changed of [{machineId:'other'},{agent:'claude'},{model:'unexpected'},{effort:'high'}])assert.equal((await resolveWorkflowLaunchModel({...input('codex'),frozenSelection:{...frozen,...changed}},unavailable())).state,'refused');
  assert.throws(()=>nativeArgs({agent:'claude',cwd:'/project',selection:frozen}),TypeError);
  assert.throws(()=>nativeArgs({agent:'codex',cwd:'/project',selection:{model:null,effort:null}}),TypeError);
});
test('rule10 empty visible list and failing Settings use native defaults without invented evidence',async()=>{
  const ports={nativeCatalog:{read:async()=>({machineId:'local',agent:'codex',models:[]})},toolDefaults:{read:async()=>{throw Error('credential');}}};
  const result=await resolveWorkflowLaunchModel(input('codex'),ports);
  assert.equal(result.state,'selected');assert.equal(result.selection.model,null);assert.equal(result.selection.effort,null);
  assert.equal(result.selection.catalogRevision,null);assert.equal(result.selection.cliVersion,null);
  assert.equal(result.warning,'Model list unavailable; using native defaults');
});
test('rule10 real local executable failure reaches workflow preparation and controller once',async()=>{
  const stdout=capture(),stderr=capture();let prepares=0,starts=0;
  const modelPorts=createLocalWorkflowModelPorts({machineId:'local',cwd:process.cwd(),executable:'/nonexistent-synthetic-codex',timeoutMs:100,settings:{read:async()=>({model:'settings-codex',effort:'high'})}});
  const code=await runPdd(['workflow','run','small-change','17'],{stdout,stderr,modelPorts,
    workflowRunner:{prepareWorkflow:async(options,ports)=>{
      prepares++;assert.equal(options.launchSelection.model,'settings-codex');
      const admission=await resolveWorkflowLaunchModel({...input('codex'),frozenSelection:options.launchSelection},ports);
      assert.deepEqual(admission.selection,options.launchSelection);
      return {state:'prepared',runId:'synthetic-run'};
    }},workflowController:{startWorkflowController:async()=>{starts++;return {state:'started'};}}});
  assert.equal(code,0);assert.equal(prepares,1);assert.equal(starts,1);
  assert.equal(stderr.text,'Model list unavailable; using settings-codex\n');
});

test('rule10 a previously effort-free frozen pair cannot acquire an effort on recovery',async()=>{
  const frozen={machineId:'local',agent:'codex',model:'observed',effort:null,cliVersion:'old',catalogRevision:'old',source:'defaults'};
  assert.equal((await resolveWorkflowLaunchModel({...input('codex'),frozenSelection:frozen},readable())).code,'bad_args');
});
