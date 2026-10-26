import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {runHerdrStage,inspectHerdrStage,closeHerdrStage,attachHerdrStage,resumeHerdrStage} from '../src/workflow-stage-herdr.mjs';
import vectors from '../vectors/cli/workflow-stage-herdr.json' with {type:'json'};
import {readHerdrTrace} from '../src/herdr-trace.mjs';
const nativeId='11111111-2222-4333-8444-555555555555';
async function harness(t,options={}) {
  const cwd=await realpath(await mkdtemp(join(tmpdir(),'pdd-stage-')));t.after(()=>rm(cwd,{recursive:true,force:true}));
  const calls=[],checkpoints=[],runId=randomUUID(),attemptId=randomUUID();let started=false,prompted=false,closed=false,seq=1,name,clock=0;
  const agent=(status=prompted?'done':'idle',n=prompted?3:1)=>({workspace_id:'w1',tab_id:'w1:t1',pane_id:'w1:p2',terminal_id:'term2',name,agent:'codex',cwd,agent_status:status,state_change_seq:n,interactive_ready:['idle','done'].includes(status),launch_pending:false,agent_session:options.noNative?null:{kind:'id',value:nativeId,agent:'codex'}});
  const encode=value=>({stdout:JSON.stringify(value)});
  const ports={controller:{herdrSession:'default',workspaceId:'w1',tabId:'w1:t1',paneId:'w1:p1'},withStageGuard:async(b,action)=>{calls.push(['guard']);return action();},now:()=>clock,sleep:async ms=>{clock+=ms;},pollMs:1,observeMs:5,startupMs:30,
    processStartIdentity:async()=>options.noProof?null:'start-1',claimWorkflowSession:async()=>({state:'owned',release:async()=>{}}),promoteWorkflowClaim:async({claim})=>claim,
    execFile:async(file,argv,opts)=>{
      assert.equal(file,'herdr');assert.equal(argv[1],'default');assert.equal(opts.cwd,cwd);assert.equal(opts.shell,false);assert.equal(opts.env,undefined);
      const args=argv.slice(2);calls.push(args);
      if(args[0]==='pane'&&args[1]==='split')return encode({result:{pane:{workspace_id:'w1',tab_id:'w1:t1',pane_id:'w1:p2',terminal_id:'term2'}}});
      if(args[0]==='pane'&&args[1]==='process-info')return encode({result:{process_info:{pane_id:'w1:p2',foreground_processes:[{pid:123,name:'codex',cwd,argv:['codex']}]}}});
      if(args[0]==='agent'&&args[1]==='start') {name=args[2];started=true;if(options.startLost)throw Error('lost');if(options.blocked)throw Object.assign(Error('blocked'),{stderr:JSON.stringify({error:{code:'agent_not_ready'}})});return encode({result:{agent:agent()}});}
      if(args[0]==='agent'&&args[1]==='get') {
        assert.ok(started);let a=options.blocked?{...agent('blocked',1),launch_pending:true}:!prompted?agent():options.working?agent('working',++seq):options.idle?agent('idle',1):seq++===1?agent('working',2):agent('done',3);
        if(options.replaced)a={...a,agent_session:{kind:'id',value:'replacement'}};
        if(options.later)a={...a,state_change_seq:9};return encode({result:{agent:a}});
      }
      if(args[0]==='agent'&&args[1]==='prompt') {
        assert.equal(checkpoints.at(-1).phase,'prompt_intent');assert.equal(prompted,false);assert.ok(args[3].startsWith('# Entire guide'));assert.match(args[3],/literal \$\(not shell\)/);prompted=true;
        if(options.lostPrompt)throw Error('lost reply');return encode({result:{agent:agent('working',2)}});
      }
      if(args[0]==='pane'&&args[1]==='close'){assert.equal(args[2],'w1:p2');assert.equal(checkpoints.at(-1).phase,'close_intent');closed=true;if(options.closeLost)throw Error('lost');return encode({id:'cli:pane:close',result:{type:'ok'}});}
      if(args[0]==='pane'&&args[1]==='list')return encode({result:{type:'pane_list',panes:[{pane_id:'w1:p1'},{pane_id:'person'},...(options.closeRemains?[{pane_id:'w1:p2'}]:[])]}});
      assert.fail(JSON.stringify(args));
    },spawnAttach:async(session,agentName,path)=>{calls.push(['attach',session,agentName,path]);return 0;}};
  const input={runId,attemptId,stageId:'check',agent:'codex',cwd,context:'# Entire guide\nActual selected recipe',instructions:'literal $(not shell)',launchSelection:null,checkpoint:async b=>{checkpoints.push(structuredClone(b));if(options.checkpointFails===b.phase)throw Error('fsync failed');}};
  return {input,ports,calls,checkpoints,options,closed:()=>closed};
}
const acceptance=b=>({runId:b.runId,stageId:b.stageId,attemptId:b.attemptId,promptDigest:b.promptDigest,terminalId:b.terminalId,backendGen:b.backendGen,evidenceDigest:'a'.repeat(64)});
const count=(h,group,operation)=>h.calls.filter(c=>c[0]===group&&c[1]===operation).length;
test('candidate-is-not-pass: checkpoints IDs, process and generation, sends guide once, observes work then ready',async t=>{
  const h=await harness(t),r=await runHerdrStage(h.input,h.ports);assert.equal(r.state,vectors.cases.find(c=>c.id==='candidate-is-not-pass').expected.transport,r.reason);assert.deepEqual(r.evidence,{readySeq:1,workingSeq:2,settledSeq:3});assert.equal(r.backend.nativeSession.value,nativeId);assert.equal(count(h,'agent','prompt'),1);assert.equal(h.closed(),false);
  assert.ok(h.checkpoints.some(b=>b.phase==='ready'&&b.processProof?.startIdentity==='start-1'&&b.backendGen===1));
});
test('close-own-pane preserves controller/person and never closes workspace or tab',async t=>{
  const h=await harness(t),r=await runHerdrStage(h.input,h.ports);const done=await closeHerdrStage({backend:r.backend,acceptance:acceptance(r.backend)},{...h.ports,checkpoint:h.input.checkpoint});assert.equal(done.state,'closed',done.reason);assert.equal(count(h,'pane','close'),1);assert.ok(h.calls.every(c=>!['workspace','tab'].includes(c[0])));
});
for(const phase of ['pane_intent','start_intent','ready','prompt_intent'])test(`checkpoint failure at ${phase} fences later effects`,async t=>{
  const h=await harness(t,{checkpointFails:phase}),r=await runHerdrStage(h.input,h.ports);assert.equal(r.state,'recovery_required');assert.equal(count(h,'agent','prompt'),0);if(phase==='start_intent')assert.equal(count(h,'agent','start'),0);
});
test('actual-start-ack-pinned rejects changed native before first prompt',async t=>{
  const h=await harness(t);const original=h.ports.execFile;h.ports.execFile=async(file,args,opts)=>{const r=await original(file,args,opts);if(args[2]==='agent'&&args[3]==='get'){const data=JSON.parse(r.stdout);data.result.agent.agent_session.value='replacement';r.stdout=JSON.stringify(data);}return r;};
  assert.equal((await runHerdrStage(h.input,h.ports)).state,'recovery_required');assert.equal(count(h,'agent','prompt'),0);
});
test('ack-checkpoint-fails: no live lookup or prompt after acknowledgment durability fails',async t=>{
  const h=await harness(t);let n=0;h.input.checkpoint=async b=>{h.checkpoints.push(b);if(b.phase==='start_intent'&&b.nativeSession&&++n===1)throw Error('disk');};
  await runHerdrStage(h.input,h.ports);assert.equal(count(h,'agent','get'),0);assert.equal(count(h,'agent','prompt'),0);
});
test('same-ready-first-prompt continues original startup after person clears dialog',async t=>{
  const h=await harness(t,{blocked:true}),first=await runHerdrStage(h.input,h.ports);assert.equal(first.state,'blocked');assert.equal(first.backend.nativeSession.value,nativeId);h.options.blocked=false;
  const next=await runHerdrStage({...h.input,backend:first.backend},h.ports);assert.equal(next.state,'settled',next.reason);assert.equal(count(h,'agent','start'),1);assert.equal(count(h,'agent','prompt'),1);
});
test('prompt-intent-not-resend after lost reply preserves original and only inspects',async t=>{
  const h=await harness(t,{lostPrompt:true}),first=await runHerdrStage(h.input,h.ports);assert.equal(first.backend.phase,'prompt_intent');await runHerdrStage({...h.input,backend:first.backend},h.ports);assert.equal(count(h,'agent','prompt'),1);assert.equal(count(h,'agent','start'),1);
});
test('candidate-requires-activity: idle without working is never settlement',async t=>{
  const h=await harness(t,{idle:true});const original=h.ports.execFile;h.ports.execFile=async(file,args,opts)=>{const r=await original(file,args,opts);if(args[2]==='agent'&&args[3]==='prompt'){const x=JSON.parse(r.stdout);x.result.agent.agent_status='idle';x.result.agent.state_change_seq=1;r.stdout=JSON.stringify(x);}return r;};const r=await runHerdrStage(h.input,h.ports);assert.equal(r.state,'active');assert.equal(r.evidence.workingSeq,undefined);
});
test('guard-busy-poll never queries outside guard or invents another attempt',async t=>{
  const h=await harness(t),r=await runHerdrStage(h.input,h.ports);const before=h.calls.length;const seen=await inspectHerdrStage({backend:r.backend},{...h.ports,withStageGuard:async()=>{throw Object.assign(Error('busy'),{code:'WORKFLOW_STAGE_BUSY'});}});assert.equal(seen.state,'active');assert.equal(h.calls.length,before);
});
for(const option of ['closeLost','closeRemains'])test(`close-reply-lost or contradictory inventory (${option}) is inspection only`,async t=>{
  const h=await harness(t,{[option]:true}),r=await runHerdrStage(h.input,h.ports),closed=await closeHerdrStage({backend:r.backend,acceptance:acceptance(r.backend)},{...h.ports,checkpoint:h.input.checkpoint});assert.equal(closed.state,'recovery_required');assert.equal(closed.backend.phase,'close_intent');await inspectHerdrStage({backend:closed.backend},h.ports);assert.equal(count(h,'pane','close'),1);
});
test('native-id-null remains null and attachment uses exact active conversation',async t=>{
  const h=await harness(t,{noNative:true}),r=await runHerdrStage(h.input,h.ports);assert.equal(r.backend.nativeSession,null);assert.equal(await attachHerdrStage({backend:r.backend},h.ports),0);assert.deepEqual(h.calls.at(-1),['attach','default',r.backend.agentName,h.input.cwd]);assert.equal(await attachHerdrStage({backend:{...r.backend,phase:'closed'}},h.ports),2);
});
test('legacy-backend stays inspection only with no bootstrap or close',async t=>{
  const h=await harness(t),legacy={version:1,runId:h.input.runId,session:'pdd-hidden',phase:'ready'};assert.equal((await runHerdrStage({...h.input,backend:legacy},h.ports)).reason,'stage_backend_requires_adoption');await inspectHerdrStage({backend:legacy},h.ports);await closeHerdrStage({backend:legacy,acceptance:{}},h.ports);assert.equal(h.calls.length,0);
});
test('stage-no-hard-timeout: ongoing work returns active without kill or repeated prompt',async t=>{
  const h=await harness(t,{working:true}),r=await runHerdrStage(h.input,h.ports);assert.equal(r.state,'active');assert.equal(count(h,'agent','prompt'),1);assert.equal(count(h,'pane','close'),0);
});
test('idle-without-process-proof and process-without-stage-generation cannot prompt',async t=>{
  const h=await harness(t,{noProof:true}),r=await runHerdrStage(h.input,h.ports);assert.equal(r.state,'recovery_required');assert.equal(count(h,'agent','prompt'),0);
  const bad={...r.backend,backendGen:null};assert.equal((await inspectHerdrStage({backend:bad},h.ports)).state,'recovery_required');
});
test('selection-passed-unchanged is saved before start and unsupported saved choice blocks',async t=>{
  const h=await harness(t),selection={machineId:'m1',agent:'codex',model:'a',effort:'high'};h.input.launchSelection=selection;
  h.ports.validateLaunchSelection=async()=>false;const r=await runHerdrStage(h.input,h.ports);assert.equal(r.state,'blocked');assert.equal(count(h,'agent','start'),0);assert.deepEqual(h.checkpoints[0].launchSelection,selection);
});
test('history resume requires stopped proof and never repeats original prompt',async t=>{
  const h=await harness(t),r=await runHerdrStage(h.input,h.ports);const resumeIntent={runId:r.backend.runId,stageId:r.backend.stageId,attemptId:r.backend.attemptId,oldGeneration:1,newGeneration:2,nativeSession:r.backend.nativeSession,launchSelection:null,stoppedProof:{complete:true}};
  const resumed=await resumeHerdrStage({backend:r.backend,resumeIntent,checkpoint:h.input.checkpoint},{...h.ports,verifyStoppedStage:async()=>true,admitStageResume:async()=>({allowed:true,actualAccount:'next',machineToolPolicy:{revision:8,targetAccountId:'next'}})});
  assert.equal(resumed.state,'active',resumed.reason);assert.equal(resumed.backend.backendGen,2);assert.equal(count(h,'agent','prompt'),1);assert.equal(count(h,'agent','start'),2);
});
test('changed process or candidate sequence prevents cleanup',async t=>{
  const h=await harness(t),r=await runHerdrStage(h.input,h.ports);h.options.later=true;assert.equal((await closeHerdrStage({backend:r.backend,acceptance:acceptance(r.backend)},{...h.ports,checkpoint:h.input.checkpoint})).state,'recovery_required');assert.equal(count(h,'pane','close'),0);
});

test('guarded runner stall callback pauses observation without killing, closing or resending',async t=>{
  const h=await harness(t,{working:true}),samples=[];h.ports.onStageObservation=async value=>{samples.push(value);return {pause:true};};const r=await runHerdrStage(h.input,h.ports);assert.equal(r.state,'active');assert.equal(r.reason,'stage_idle_alarm');assert.equal(samples[0].backend.attemptId,h.input.attemptId);assert.equal(count(h,'agent','prompt'),1);assert.equal(count(h,'pane','close'),0);
});

function delayedIdentity(h,at) {
  const exec=h.ports.execFile;let prompted=false,observations=0;
  h.ports.execFile=async(file,args,opts)=>{
    if(args[2]==='agent'&&args[3]==='prompt'){
      prompted=true;if(at==='prompt acknowledgement')h.options.noNative=false;
    } else if(prompted&&args[2]==='agent'&&args[3]==='get'){
      observations++;
      if(at==='working observation'||at==='ready observation'&&observations>=2)h.options.noNative=false;
    }
    return exec(file,args,opts);
  };
}
for(const at of ['prompt acknowledgement','working observation','ready observation'])test(`delayed-native-id-claim: ${at} is durable and owned before progression`,async t=>{
  const expected=vectors.cases.find(c=>c.id==='delayed-native-id-claim').expected;
  const h=await harness(t,{noNative:true});delayedIdentity(h,at);let promotions=0;
  h.ports.promoteWorkflowClaim=async({claim,nativeSessionId})=>{
    promotions++;assert.equal(h.checkpoints.at(-1).nativeSession?.value,nativeSessionId);
    assert.equal(nativeSessionId,nativeId);return claim;
  };
  h.ports.onStageObservation=async({backend})=>{if(backend.nativeSession)assert.ok(promotions>0);};
  const result=await runHerdrStage(h.input,h.ports);
  assert.equal(result.state,expected.state,result.reason);assert.ok(promotions>0);
  assert.equal(count(h,'agent','prompt'),expected.prompts);assert.equal(result.backend.nativeSession.value,nativeId);
});
for(const at of ['prompt acknowledgement','ready observation'])for(const state of ['busy','retired','uncertain','unacknowledged'])test(`delayed-native-id-claim-refused: ${at}, ${state}, never settles or resends`,async t=>{
  const expected=vectors.cases.find(c=>c.id==='delayed-native-id-claim-refused').expected;
  const h=await harness(t,{noNative:true});delayedIdentity(h,at);let promotions=0;
  h.ports.promoteWorkflowClaim=async({nativeSessionId})=>{
    promotions++;assert.equal(h.checkpoints.at(-1).nativeSession?.value,nativeSessionId);
    return state==='unacknowledged'?{}:{state};
  };
  const first=await runHerdrStage(h.input,h.ports);
  assert.equal(first.state,expected.state);assert.equal(first.reason,'stage_claim_unavailable');assert.ok(promotions>0);
  assert.equal(first.backend.nativeSession.value,nativeId);assert.equal(first.evidence.settledSeq,undefined);
  assert.equal(first.backend.phase,at==='prompt acknowledgement'?'prompt_intent':'submitted');
  const replay=await runHerdrStage({...h.input,backend:first.backend},h.ports);
  assert.equal(replay.state,'recovery_required');assert.equal(replay.backend.phase,first.backend.phase);
  assert.equal(count(h,'agent','prompt'),expected.prompts);assert.equal(count(h,'agent','start'),expected.newStarts);assert.equal(count(h,'pane','close'),expected.closeCalls);
  h.ports.promoteWorkflowClaim=async({claim})=>claim;
  if(at==='prompt acknowledgement')h.options.working=true;
  let reconciled=await runHerdrStage({...h.input,backend:replay.backend},h.ports);
  if(at==='prompt acknowledgement'){
    assert.equal(reconciled.state,'active',reconciled.reason);
    h.options.working=false;h.options.later=true;
    reconciled=await inspectHerdrStage({backend:reconciled.backend},h.ports);
  }
  assert.equal(reconciled.state,'settled',reconciled.reason);
  assert.equal(count(h,'agent','prompt'),1);assert.equal(count(h,'agent','start'),1);
});
for(const save of ['missing','failed'])test(`delayed-native-id-checkpoint-fails: inspection ${save} durability prevents claim and settlement`,async t=>{
  const expected=vectors.cases.find(c=>c.id==='delayed-native-id-checkpoint-fails').expected;
  const h=await harness(t,{noNative:true}),first=await runHerdrStage(h.input,h.ports);h.options.noNative=false;let promotions=0;
  h.ports.promoteWorkflowClaim=async({claim})=>{promotions++;return claim;};
  const result=await inspectHerdrStage({backend:first.backend},{...h.ports,...(save==='failed'?{checkpoint:async()=>{throw Error('disk');}}:{})});
  assert.equal(result.state,expected.state);assert.equal(promotions,expected.promotions);assert.equal(result.backend.nativeSession.value,nativeId);
  assert.equal(count(h,'agent','prompt'),1);assert.equal(count(h,'agent','start'),1);assert.equal(count(h,'pane','close'),0);
});
test('delayed-native-id-inspection-reconciles: checkpoints discovery and claims before settlement without delivery',async t=>{
  const expected=vectors.cases.find(c=>c.id==='delayed-native-id-inspection-reconciles').expected;
  const h=await harness(t,{noNative:true}),first=await runHerdrStage(h.input,h.ports);h.options.noNative=false;let promotions=0,inGuard=false;
  h.ports.promoteWorkflowClaim=async({claim,nativeSessionId})=>{assert.ok(inGuard);promotions++;assert.equal(h.checkpoints.at(-1).nativeSession.value,nativeSessionId);return claim;};
  const result=await inspectHerdrStage({backend:first.backend},{...h.ports,checkpoint:h.input.checkpoint,withStageGuard:async(b,action)=>{inGuard=true;try{return await action();}finally{inGuard=false;}}});
  assert.equal(result.state,expected.state,result.reason);assert.equal(promotions,1);assert.equal(count(h,'agent','prompt'),1);assert.equal(count(h,'agent','start'),1);
});
test('delayed identity discovered before first prompt is claimed before delivery',async t=>{
  const h=await harness(t,{noNative:true});let reads=0,promotions=0;const exec=h.ports.execFile;
  h.ports.execFile=async(file,args,opts)=>{if(args[2]==='agent'&&args[3]==='get'&&++reads===2)h.options.noNative=false;if(args[2]==='agent'&&args[3]==='prompt')assert.ok(promotions>0);return exec(file,args,opts);};
  h.ports.promoteWorkflowClaim=async({claim,nativeSessionId})=>{assert.equal(h.checkpoints.at(-1).nativeSession.value,nativeSessionId);promotions++;return claim;};
  const result=await runHerdrStage(h.input,h.ports);assert.equal(result.state,'settled',result.reason);assert.equal(count(h,'agent','prompt'),1);
});

for(const settings of [null,{model:'settings-model',effort:'high'}])test(`rule10 unavailable list preserves ${settings?'Settings pair':'native defaults'} through real stage admission`,async t=>{
  const h=await harness(t);
  const {resolveWorkflowLaunchModel}=await import('../src/workflow-models.mjs');
  const modelPorts={nativeCatalog:{read:async()=>{throw Error('unavailable');}},toolDefaults:{read:async()=>settings}};
  const chosen=await resolveWorkflowLaunchModel({machineId:'local',agent:'codex'},modelPorts);
  h.input.launchSelection=chosen.selection;Object.assign(h.ports,modelPorts);
  const first=await runHerdrStage(h.input,h.ports);assert.equal(first.state,'settled',first.reason);
  const start=h.calls.find(c=>c[0]==='agent'&&c[1]==='start'),args=start.slice(start.indexOf('--')+1);
  assert.ok(args.includes('--dangerously-bypass-approvals-and-sandbox'));assert.ok(args.includes('--dangerously-bypass-hook-trust'));
  if(settings){assert.equal(args[args.indexOf('-m')+1],'settings-model');assert.ok(args.includes('model_reasoning_effort="high"'));}
  else {assert.equal(args.includes('-m'),false);assert.equal(args.some(a=>a.startsWith('model_reasoning_effort=')),false);}
  h.ports.toolDefaults.read=async()=>({model:'changed-default',effort:'low'});
  const next=await runHerdrStage({...h.input,backend:first.backend},h.ports);
  assert.equal(next.state,'settled',next.reason);assert.deepEqual(next.backend.launchSelection,chosen.selection);
  assert.equal(count(h,'agent','start'),1);assert.equal(count(h,'agent','prompt'),1);
});

for(const settings of [null,{model:'saved',effort:'high'}])for(const later of ['invalid','unreadable'])test(`R10-FROZEN-DEFAULTS actual stage preserves ${settings?'settings-fallback':'native-defaults'} after ${later} later Settings`,async t=>{
  const h=await harness(t);
  const {resolveWorkflowLaunchModel}=await import('../src/workflow-models.mjs');
  const modelPorts={nativeCatalog:{read:async()=>{throw Error('list unavailable');}},toolDefaults:{read:async()=>settings}};
  const chosen=await resolveWorkflowLaunchModel({machineId:'local',agent:'codex'},modelPorts);
  assert.equal(chosen.state,'selected');h.input.launchSelection=chosen.selection;let reads=0;
  modelPorts.nativeCatalog.read=async({machineId,agent})=>({machineId,agent,cliVersion:'1',revision:'now-readable',models:[{id:'saved',label:'Saved',hidden:false,efforts:['high'],defaultEffort:'high'}],nativeDefaults:{model:'saved',effort:'high'}});
  modelPorts.toolDefaults.read=async()=>{reads++;if(later==='unreadable')throw Error('Settings unavailable');return {model:'unknown-later',effort:'low'};};
  Object.assign(h.ports,modelPorts);const first=await runHerdrStage(h.input,h.ports);
  assert.equal(first.state,'settled',first.reason);assert.deepEqual(first.backend.launchSelection,chosen.selection);
  const args=h.calls.find(c=>c[0]==='agent'&&c[1]==='start');assert.ok(args.includes('--dangerously-bypass-approvals-and-sandbox'));assert.ok(args.includes('--dangerously-bypass-hook-trust'));
  if(settings){assert.equal(args[args.indexOf('-m')+1],'saved');assert.ok(args.includes('model_reasoning_effort="high"'));}
  else {assert.equal(args.includes('-m'),false);assert.equal(args.some(a=>a.startsWith('model_reasoning_effort=')),false);}
  const next=await runHerdrStage({...h.input,backend:first.backend},h.ports);assert.equal(next.state,'settled',next.reason);
  assert.equal(count(h,'agent','start'),1);assert.equal(count(h,'agent','prompt'),1);assert.equal(reads,0);
});


test('enabled stage trace covers actual argv transport and attachment without exposing guide or prompt',async t=>{
  const h=await harness(t);h.ports.home=h.input.cwd;h.ports.env={PDD_TRACE:'herdr'};
  h.input.instructions+='\nSYNTHETIC_SECRET_MUST_STAY_IN_REQUEST';
  const r=await runHerdrStage(h.input,h.ports);assert.equal(r.state,'settled',r.reason);
  assert.equal(count(h,'agent','start'),1);assert.equal(count(h,'agent','prompt'),1);
  assert.ok(h.calls.find(c=>c[0]==='agent'&&c[1]==='prompt')[3].includes('SYNTHETIC_SECRET_MUST_STAY_IN_REQUEST'));
  assert.equal(await attachHerdrStage({backend:r.backend},h.ports),0);
  const done=await closeHerdrStage({backend:r.backend,acceptance:acceptance(r.backend)},{...h.ports,checkpoint:h.input.checkpoint});
  assert.equal(done.state,'closed',done.reason);assert.equal(count(h,'pane','close'),1);
  const encoded=JSON.stringify(readHerdrTrace(h.ports));
  for(const operation of ['pane.split','agent.start','agent.get','pane.process_info','agent.prompt','agent.attach','pane.close','pane.list'])assert.ok(encoded.includes(operation),operation);
  for(const secret of ['SYNTHETIC_SECRET_MUST_STAY_IN_REQUEST','# Entire guide','literal $(not shell)',h.input.cwd])assert.ok(!encoded.includes(secret),secret);
});

test('enabled trace retains lost prompt delivery as inspection-only, never another start or prompt',async t=>{
  const h=await harness(t,{lostPrompt:true});h.ports.home=h.input.cwd;h.ports.env={PDD_TRACE:'herdr'};
  const first=await runHerdrStage(h.input,h.ports);assert.equal(first.backend.phase,'prompt_intent');
  const second=await runHerdrStage({...h.input,backend:first.backend},h.ports);
  assert.equal(second.state,'active');assert.equal(second.backend.phase,'prompt_intent');assert.equal(count(h,'agent','prompt'),1);assert.equal(count(h,'agent','start'),1);
  const encoded=JSON.stringify(readHerdrTrace(h.ports));assert.ok(encoded.includes('agent.prompt'));assert.ok(!encoded.includes('lost reply'));
});
