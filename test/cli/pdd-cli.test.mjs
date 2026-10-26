import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vectors from '../../vectors/cli/pdd-cli-p1.json' with {type:'json'};
import {runPdd} from '../../src/pdd-cli.mjs';
import {parseArgv} from '../../src/argument-parser.mjs';
const id='2f9c1d1e-4b7a-4c6e-9b1a-0d2f3e4a5b6c',action='123e4567-e89b-42d3-a456-426614174000';
const capture=()=>({text:'',write(s){this.text+=s;}});
const selected={machineId:'local',agent:'codex',model:'native',effort:'high',cliVersion:'1',catalogRevision:'observed',source:'defaults'};
const workflowModels={resolveWorkflowModel:async()=>({state:'selected',selection:selected})};
const stagePorts=Object.fromEntries(['runHerdrStage','inspectHerdrStage','attachHerdrStage','closeHerdrStage','resumeHerdrStage'].map(n=>[n,()=>assert.fail('CLI cannot dispatch stages')]));
const io=()=>({stdout:capture(),stderr:capture()});
const records=(status,lastSeq=57)=>({readRunIndex:async()=>({entries:[{runId:id,runDir:'/exact/pdd/workflows/'+id}],dropped:0}),
 readRunStatus:async()=>({value:status,warnings:[]}),readJournalLast:async()=>({value:{seq:lastSeq,state:{runId:id,seq:lastSeq}},warnings:[]}),
 runStatusFromState:state=>({v:1,runId:state.runId,journalSeq:state.seq,state:'unknown'})});
const vector=id=>vectors.cases.find(v=>v.id===id);
test(vector('run-prepares-and-launches').id,async()=>{
 const deps=io(),calls=[];
 assert.equal(await runPdd(['workflow','run','feature','12'],{...deps,workflowModels,
  workflowRunner:{prepareWorkflow:async(input,ports)=>{calls.push(input);assert.equal(ports.runHerdrStage,undefined);return {state:'prepared',runId:id,runDir:'/saved',root:'/assigned',runtime:{releaseId:'R1'},workflow:'feature',issueNumber:12};}},
  workflowController:{startWorkflowController:async input=>{calls.push(input);return {state:'started',code:null,controller:{proved:true}};}}}),0);
 assert.equal(calls.length,2);assert.equal(calls[0].launchSelection,selected);assert.equal(calls[1].runId,id);assert.equal(deps.stdout.text.trim().split('\n').length,1);
});
test(vector('run-lost-launch').id,async()=>{
 let starts=0;const deps=io();assert.equal(await runPdd(['workflow','run','feature','12'],{...deps,workflowModels,workflowRunner:{prepareWorkflow:async()=>({state:'prepared',runId:id})},workflowController:{startWorkflowController:async()=>{starts++;return {state:'uncertain',code:'missing_proof'};}}}),1);assert.equal(starts,1);
});
test(vector('drive-current-revision').id,async()=>{
 const deps=io(),calls=[];assert.equal(await runPdd(['workflow','drive',id,'--decision','approve','--id',action,'--rev','57','--launch-id',action],{...deps,workflowStages:stagePorts,
 workflowRunner:{driveWorkflow:async(input,ports)=>{calls.push(input);assert.equal(ports.resumeHerdrStage,stagePorts.resumeHerdrStage);return {state:'waiting',exitCode:2,message:'Wait for current review.'};}}}),2);
 assert.deepEqual(calls[0].expectedRev,57);assert.equal(calls[0].launchId,action);assert.equal(calls[0].decisionId,action);
});
test(vector('adopt-no-run').id,async()=>{const deps=io();let count=0;assert.equal(await runPdd(['workflow','adopt',id],{...deps,workflowRunner:{adoptWorkflow:async()=>{count++;return {state:'adopted',exitCode:0,message:'Adopted.'};}}}),0);assert.equal(count,1);});
test(vector('clean-dry-run').id,async()=>{const deps=io();assert.equal(await runPdd(['workflow','clean','--dry-run'],{...deps,workflowCleaner:{cleanWorkflowRuns:async input=>{assert.equal(input.dryRun,true);return {removed:[],retained:[{runId:id,reason:'unpushed commits'}],warnings:[]};}}}),0);assert.match(deps.stdout.text,/unpushed commits/);});
test(vector('remote-no-client').id,async()=>{const deps=io();assert.equal(await runPdd(['workflow','run','feature','12','--on','desktop'],{...deps,workflowRunner:{prepareWorkflow:()=>assert.fail('No local start')}}),1);assert.match(deps.stderr.text,/unsupported/);});
test(vector('decide-json-once').id,async()=>{const deps=io();assert.equal(await runPdd(['workflow','decide',id,'--decision','approve','--id',action,'--rev','57','--json'],{...deps,workflowDecider:{decideWorkflow:async input=>{assert.equal(input.expectedRev,57);return {state:'recorded',exitCode:0,message:'Recorded.',decisionId:action};}}}),0);const r=JSON.parse(deps.stdout.text);assert.equal(r.v,1);assert.equal(r.exitCode,undefined);assert.equal(deps.stdout.text.trim().split('\n').length,1);});
for(const name of ['status-json-object','status-journal-fallback'])test(vector(name).id,async()=>{
 const deps=io(),stale=name==='status-journal-fallback';assert.equal(await runPdd(['workflow','status',id,'--json'],{...deps,workflowRecords:records({runId:id,journalSeq:stale?56:57,state:'waiting'})}),0);
 const r=JSON.parse(deps.stdout.text);assert.equal(r.v,1);assert.equal(r.runId,id);assert.equal(r.journalSeq,57);assert.equal(r.state,stale?'unknown':'waiting');assert.equal(r.runs,undefined);
});
for(const name of ['status-unknown-id','status-empty-index'])test(vector(name).id,async()=>{
 const deps=io(),known=name==='status-unknown-id';assert.equal(await runPdd(['workflow','status',...(known?[id]:[]),'--json'],{...deps,workflowRecords:{readRunIndex:async()=>({entries:[],dropped:0})}}),known?1:0);
 assert.deepEqual(JSON.parse(deps.stdout.text),known?{v:1,runId:id,state:'unknown',message:'Run not found'}:{v:1,runs:[]});
});
test(vector('upgrade-cancel').id,async()=>{
 const deps=io();assert.equal(await runPdd(['workflow','upgrade',id],{...deps,workflowRecords:records({runId:id,journalSeq:57,rev:57,runtime:{releaseId:'old'},state:'waiting'}),upgradeTarget:async()=>({releaseId:'new'}),confirmUpgrade:async()=>false,workflowRuntime:{upgradeWorkflowRuntime:()=>assert.fail('No write')}}),0);assert.match(deps.stdout.text,/old -> new/);
});
test(vector('root-public-recovery-route').id,async()=>{const deps=io();assert.equal(await runPdd(['runs-keeper'],{...deps,workflowKeeper:{runWorkflowKeeper:async input=>{assert.ok(input.home);return {exitCode:0};}}}),0);});
test(vector('alpha-doctor-proposal').id,async()=>{const deps=io();assert.equal(await runPdd(['doctor','--check-only'],{...deps,doctorModule:{runDoctorCommand:async argv=>{assert.deepEqual(argv,['--check-only']);return 0;}}}),0);});
for(const name of ['help-no-effects','model-help-local'])test(name,async()=>{
 const deps=io();assert.equal(await runPdd(vector(name).given.argv,{...deps,packageRoot:'/missing',workflowModels:{resolveWorkflowModel:()=>assert.fail('No model query')},workflowRunner:{prepareWorkflow:()=>assert.fail('No launch')}}),0);assert.match(deps.stdout.text,/--model/);assert.match(deps.stdout.text,/--effort/);
});
for(const name of ['session-account-flag-removed','workflow-mode-flag-removed'])test(name,async()=>{
 const deps=io();assert.equal(await runPdd(vector(name).given.argv,{...deps,workflowRunner:{prepareWorkflow:()=>assert.fail('No prepare')},nativeSession:()=>assert.fail('No native')}),2);assert.match(deps.stderr.text,/Set accounts per machine and tool in Settings/);
});
test('all declared bad syntax fails before injected effects, including launch revision and account scopes',async()=>{
 const commands=[['workflow','drive',id,'--launch-id','bad'],['workflow','decide',id,'--decision','approve','--id',action,'--rev','01'],['workflow','resume',id,'--rev','1'],['session','--model','--effort','high'],['doctor','--json','--check-only'],['update','--check','--now'],['update','--force'],['models'],['settings','model','hidden'],['settings','alerts'],['workflow','drive',id,'--model','foo']];
 for(const args of commands){assert.throws(()=>parseArgv(args));assert.equal(await runPdd(args,{...io(),nativeSession:()=>assert.fail('No native')}),2);}
});
test('explicit unsupported model refuses before preparing or opening a native conversation',async()=>{
 for(const args of [['workflow','run','feature','7','--effort','ultra'],['session','--model','hidden']])assert.equal(await runPdd(args,{...io(),workflowModels:{resolveWorkflowModel:async()=>({state:'refused',code:'bad_args'})},workflowRunner:{prepareWorkflow:()=>assert.fail('No preparation')},nativeSession:()=>assert.fail('No native')}),2);
});
test('remote dispatch persists the target request first, carries overrides and never prepares locally',async t=>{
 const home=mkdtempSync(join(tmpdir(),'pdd-remote-'));t.after(()=>rmSync(home,{recursive:true,force:true}));let dispatches=0;
 assert.equal(await runPdd(['workflow','run','feature','7','--on','desktop','--model','target-model'],{...io(),home,
  workflowPlacement:{selectStartTarget:async()=>({state:'selected',target:{id:'desktop'}}),dispatchStart:async input=>{
   dispatches++;const saved=JSON.parse(readFileSync(join(home,'.pdd/runs/starts',input.startId+'.json'),'utf8'));
   assert.equal(saved.target.id,'desktop');assert.deepEqual(saved.selectionOverrides,{model:'target-model'});assert.equal(saved.launchSelection,undefined);assert.equal(saved.account,undefined);return {state:'uncertain',message:'Receipt unavailable.'};}},
  workflowRunner:{prepareWorkflow:()=>assert.fail('No source preparation')},workflowModels:{resolveWorkflowModel:()=>assert.fail('Target owns resolution')}}),1);
 assert.equal(dispatches,1);assert.equal(readdirSync(join(home,'.pdd/runs/starts')).length,1);
});
test('settings validates the final pair before one write; updates preserve their public code envelope',async()=>{
 const writes=[];assert.equal(await runPdd(['settings','model','native','--tool','codex'],{...io(),workflowModels,settings:{write:async input=>{writes.push(input);return {ok:true};}}}),0);assert.deepEqual(writes[0].selection,{model:'native',effort:'high'});
 const deps=io();assert.equal(await runPdd(['update','--to','1.2.3','--force'],{...deps,updateModule:{runUpdateCommand:async input=>{assert.deepEqual(input,{action:'to',value:'1.2.3',fleet:false,force:true});return {state:'pinned',code:0,message:'Pinned 1.2.3.'};}}}),0);assert.equal(deps.stdout.text,'Pinned 1.2.3.\n');
});

test('every explicit machine name, including source id, goes through placement before native launch',async()=>{
 for(const on of ['local','desktop']){
  const deps=io(),calls=[];
  assert.equal(await runPdd(['session','--on',on],{...deps,machineId:'local',
   workflowPlacement:{selectStartTarget:async(input,ports)=>{calls.push(input);assert.equal(ports.machinePlacement,undefined);return {state:'refused',code:'remote_unsupported',message:'Remote placement requires the optional client.'};}},
   nativeSession:()=>assert.fail('No native launch')}),1);
  assert.equal(calls.length,1);assert.equal(calls[0].on,on);assert.equal(calls[0].sourceMachineId,'local');assert.match(deps.stderr.text,/remote_unsupported/);
 }
});
test('explicit auto uses placement owner local decision without requiring a client',async()=>{
 let selected=0,launched=0;
 assert.equal(await runPdd(['session','--on','auto'],{...io(),workflowPlacement:{selectStartTarget:async input=>{selected++;assert.equal(input.on,'auto');return {state:'local'};}},nativeSession:()=>{launched++;return 0;}}),0);
 assert.equal(selected,1);assert.equal(launched,1);
});
test('Alpha setup provisions public support and recovery under one lease before optional client setup',async()=>{
 for(const withClient of [false,true]){
  const calls=[],lease={},runtime={releaseId:'synthetic',herdr:process.execPath};let active=false,bindings=0;
  const setupModules={versions:{resolveRuntime:async()=>{calls.push('resolve');return runtime;}},
   lock:{withUpdateLock:async(input,operation)=>{calls.push('lock');active=true;try{return await operation(lease);}finally{active=false;calls.push('unlock');}}},
   herdrRuntime:{recordHerdrRuntime:async input=>{assert.equal(input.runtime,runtime);assert.equal(input.herdr,process.execPath);assert.equal(input.lease,lease);assert.ok(active);bindings++;return runtime;}},
   launcher:{installLauncherSupport:async input=>{assert.equal(input.runtime,runtime);assert.equal(input.lease,lease);assert.ok(active);calls.push('support');return {code:null};},
    provisionRecoveryService:async input=>{assert.equal(input.lease,lease);assert.ok(active);calls.push('service');return {code:null};}}};
  assert.equal(await runPdd(['setup'],{...io(),workflowHerdrBoot:{ensureHerdrInstalled:async()=>({state:'ready',code:null,executable:process.execPath})},setupModules,...(withClient?{clientAdapter:{runSetupCommand:async()=>{assert.equal(active,false);calls.push('client');return 0;}}}:{})}),0);
  assert.equal(bindings,1);
  assert.deepEqual(calls,['resolve','lock','support','service','unlock',...(withClient?['client']:[])]);
 }
});
test('public setup failure stops client continuation and gives local recovery instructions',async()=>{
 const deps=io(),lease={};assert.equal(await runPdd(['setup'],{...deps,workflowHerdrBoot:{ensureHerdrInstalled:async()=>({state:'ready',code:null,executable:process.execPath})},
  setupModules:{versions:{resolveRuntime:async()=>({})},lock:{withUpdateLock:async(input,op)=>op(lease)},herdrRuntime:{recordHerdrRuntime:async input=>{assert.equal(input.herdr,process.execPath);assert.equal(input.lease,lease);return input.runtime;}},launcher:{installLauncherSupport:async()=>({code:'runtime_unavailable'}),provisionRecoveryService:()=>assert.fail('No service')}},
  clientAdapter:{runSetupCommand:()=>assert.fail('No client continuation')}}),1);
 assert.match(deps.stderr.text,/verified PDD installer|pdd-launch recover/);assert.doesNotMatch(deps.stderr.text,/needs.*client/);
});
test('client status rejects out-of-range exit codes',async()=>{
 assert.equal(await runPdd(['status'],{...io(),clientAdapter:{runStatusCommand:async()=>999}}),1);
});
test('human resume decision maps runner binding to controller public binding',async()=>{
 let calls=0;
 assert.equal(await runPdd(['workflow','resume',id,'--decision','approve','--id',action,'--rev','57','--expect-stage','review','--expect-seq','4'],{...io(),
  workflowRunner:{resumeWorkflow:async input=>{assert.equal(input.decisionId,action);assert.equal(input.expectedRev,57);return {state:'prepared',runId:id};}},
  workflowController:{startWorkflowController:async input=>{calls++;assert.deepEqual(input.decision,{decision:'approve',id:action,rev:57,expectStage:'review',expectSeq:4});return {state:'started'};}}}),0);
 assert.equal(calls,1);
});
