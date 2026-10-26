import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,realpath,mkdir,writeFile,unlink} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {runHerdrStage,inspectHerdrStage,closeHerdrStage,attachHerdrStage,resumeHerdrStage,readSettledHerdrStageError,retrySettledHerdrStage} from '../src/workflow-stage-herdr.mjs';
import vectors from '../vectors/cli/workflow-stage-herdr.json' with {type:'json'};
import {readHerdrTrace} from '../src/herdr-trace.mjs';
const nativeId='11111111-2222-4333-8444-555555555555';
async function harness(t,options={}) {
  const cwd=await realpath(await mkdtemp(join(tmpdir(),'pdd-stage-')));t.after(()=>rm(cwd,{recursive:true,force:true}));
  const calls=[],checkpoints=[],runId=randomUUID(),attemptId=randomUUID(),tool=options.agent??'codex';let started=false,prompted=false,closed=false,seq=1,name,clock=0;
  const agent=(status=prompted?'done':'idle',n=prompted?3:1)=>({workspace_id:'w1',tab_id:'w1:t1',pane_id:'w1:p2',terminal_id:'term2',name,agent:tool,cwd,agent_status:status,state_change_seq:n,interactive_ready:['idle','done'].includes(status),launch_pending:false,agent_session:options.noNative?null:{kind:'id',value:nativeId,agent:tool}});
  const encode=value=>({stdout:JSON.stringify(value)});
  const ports={herdrExecutable:process.execPath,controller:{herdrSession:'default',workspaceId:'w1',tabId:'w1:t1',paneId:'w1:p1'},withStageGuard:async(b,action)=>{calls.push(['guard']);return action();},now:()=>clock,sleep:async ms=>{clock+=ms;},pollMs:1,observeMs:5,startupMs:30,
    processStartIdentity:async()=>options.noProof?null:'start-1',claimWorkflowSession:async()=>({state:'owned',release:async()=>{}}),promoteWorkflowClaim:async({claim})=>claim,
    execFile:async(file,argv,opts)=>{
      assert.equal(file,process.execPath);assert.equal(argv[1],'default');assert.equal(opts.cwd,cwd);assert.equal(opts.shell,false);assert.equal(opts.env,ports.env);
      const args=argv.slice(2);calls.push(args);
      if(args[0]==='pane'&&args[1]==='split')return encode({result:{pane:{workspace_id:'w1',tab_id:'w1:t1',pane_id:'w1:p2',terminal_id:'term2'}}});
      if(args[0]==='pane'&&args[1]==='process-info')return encode({result:{process_info:{pane_id:'w1:p2',foreground_processes:[{pid:123,name:tool,cwd,argv:[tool]}]}}});
      if(args[0]==='pane'&&args[1]==='read'){assert.deepEqual(args,['pane','read','w1:p2','--source','visible','--format','text']);return encode({result:{read:{pane_id:'w1:p2',workspace_id:'w1',tab_id:'w1:t1',text:options.screen??'',...options.readReply}}});}
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
  const input={runId,attemptId,stageId:'check',agent:tool,cwd,context:'# Entire guide\nActual selected recipe',instructions:'literal $(not shell)',launchSelection:null,checkpoint:async b=>{checkpoints.push(structuredClone(b));if(options.checkpointFails===b.phase)throw Error('fsync failed');}};
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

test('stage with missing frozen Herdr never uses another executable or sends a native request',async t=>{
 const h=await harness(t);h.ports.runtime={herdr:join(h.input.cwd,'missing-saved-herdr')};
 const result=await runHerdrStage(h.input,h.ports);
 assert.equal(result.state,'recovery_required');assert.equal(result.reason,'herdr_not_found');
 assert.equal(result.message,`Herdr not found at ${h.ports.runtime.herdr}`);
 assert.deepEqual(h.calls,[['guard']]);assert.equal(count(h,'agent','start'),0);assert.equal(count(h,'agent','prompt'),0);
});

function inspectionBackend(cwd){
 return {version:2,runId:randomUUID(),attemptId:randomUUID(),stageId:'check',agent:'codex',backendGen:1,cwd,session:'default',workspaceId:'w1',tabId:'w1:t1',paneId:'w1:p2',terminalId:'term2',agentName:'synthetic',nativeSession:null,phase:'ready',evidence:{readySeq:1}};
}
test('selected Herdr deleted at exec keeps its exact path and original backend without retry',async t=>{
 const h=await harness(t),herdr=join(h.input.cwd,'selected-herdr'),backend=inspectionBackend(h.input.cwd),attempts=[];
 await writeFile(herdr,'#!/bin/sh\nexit 99\n',{mode:0o700});
 const result=await inspectHerdrStage({backend},{runtime:{herdr},env:{PATH:''},withStageGuard:async(_,action)=>action(),execFile:async(file,args,opts)=>{
  attempts.push(file);await unlink(file);return promisify(execFile)(file,args,opts);
 }});
 assert.equal(result.state,'recovery_required');assert.equal(result.reason,'herdr_not_found');assert.equal(result.message,`Herdr not found at ${herdr}`);
 assert.deepEqual(result.backend,backend);assert.deepEqual(attempts,[herdr]);
});
test('ENOENT with a still executable selected file retains command uncertainty',async t=>{
 const h=await harness(t),herdr=join(h.input.cwd,'selected-herdr'),backend=inspectionBackend(h.input.cwd);let attempts=0;
 await writeFile(herdr,'#!/missing-synthetic-interpreter\n',{mode:0o700});
 const result=await inspectHerdrStage({backend},{runtime:{herdr},withStageGuard:async(_,action)=>action(),execFile:async(file,args,opts)=>{
  attempts++;return promisify(execFile)(file,args,opts);
 }});
 assert.equal(result.reason,'herdr_command_uncertain');assert.equal(result.message,undefined);assert.deepEqual(result.backend,backend);assert.equal(attempts,1);
});
for(const removeDuringInspection of [true,false])test(`legacy stage retains first absolute selection across inspection and attachment, removeDuringInspection=${removeDuringInspection}`,async t=>{
 const h=await harness(t),backend=inspectionBackend(h.input.cwd),one=join(h.input.cwd,'one'),two=join(h.input.cwd,'two'),chosen=[],screenCalls=[];
 for(const dir of [one,two]){await mkdir(dir);await writeFile(join(dir,'herdr'),'#!/bin/sh\nexit 99\n',{mode:0o700});}
 backend.processProof={pid:789,startIdentity:'stable-start',paneId:backend.paneId,terminalId:backend.terminalId,backendGen:1};
 const ports={env:{PATH:`${one}:${two}`},withStageGuard:async(_,action)=>action(),processStartIdentity:async()=> 'stable-start',execFile:async(file,args)=>{
  if(args[2]==='pane'&&args[3]==='read'){screenCalls.push(file);assert.equal(file,join(one,'herdr'));assert.deepEqual(args.slice(2),['pane','read',backend.paneId,'--source','visible','--format','text']);return {stdout:JSON.stringify({result:{read:{pane_id:backend.paneId,text:''}}})};}
  chosen.push(file);
  if(args[2]==='agent'){
   if(removeDuringInspection)await unlink(join(one,'herdr'));
   return {stdout:JSON.stringify({result:{agent:{workspace_id:backend.workspaceId,tab_id:backend.tabId,pane_id:backend.paneId,terminal_id:backend.terminalId,name:backend.agentName,agent:backend.agent,cwd:backend.cwd,state_change_seq:1,agent_status:'idle',interactive_ready:true,launch_pending:false}}})};
  }
  return {stdout:JSON.stringify({result:{process_info:{pane_id:backend.paneId,foreground_processes:[{pid:789,name:'codex',cwd:backend.cwd,argv:['codex']}]}}})};
 },spawn:()=>assert.fail('missing original cannot attach through a replacement')};
 const first=await inspectHerdrStage({backend},ports);
 if(!removeDuringInspection){assert.equal(first.reason,'no_observed_prompt_activity');assert.deepEqual(chosen,[join(one,'herdr'),join(one,'herdr')]);await unlink(join(one,'herdr'));}
 else {assert.equal(first.reason,'herdr_not_found');assert.equal(first.message,`Herdr not found at ${join(one,'herdr')}`);assert.deepEqual(chosen,[join(one,'herdr')]);}
 const before=chosen.length,again=await inspectHerdrStage({backend},ports);
 assert.equal(again.reason,'herdr_not_found');assert.equal(again.message,`Herdr not found at ${join(one,'herdr')}`);assert.deepEqual(again.backend,backend);
 assert.equal(await attachHerdrStage({backend},ports),1);assert.equal(chosen.length,before);
 assert.equal(screenCalls.length,removeDuringInspection?0:1);
});


// Synthetic replies reproduce the npm launcher/native-child relationship from
// Herdr process_info; these are contract cases, not captured lab fixtures.
async function foregroundHarness(t,{agent='codex',group,processes,startIdentity}={}) {
  const h=await harness(t),exec=h.ports.execFile,proofRequests=[];
  h.input.agent=agent;
  h.ports.processStartIdentity=async identity=>{proofRequests.push(identity);return startIdentity?startIdentity(identity,proofRequests.length):'stable-start';};
  h.ports.execFile=async(file,args,opts)=>{
    const response=await exec(file,args,opts),data=JSON.parse(response.stdout);
    if(data.result?.agent){data.result.agent.agent=agent;if(data.result.agent.agent_session)data.result.agent.agent_session.agent=agent;}
    if(args[2]==='pane'&&args[3]==='process-info')data.result.process_info={pane_id:'w1:p2',foreground_process_group_id:group,foreground_processes:processes(h.input.cwd)};
    return {...response,stdout:JSON.stringify(data)};
  };
  return {...h,proofRequests};
}
const npmProcesses=cwd=>[
  {pid:4101,name:'node',cwd,argv:['node','/opt/native/bin/codex','--no-daemon']},
  {pid:4102,name:'codex',cwd,argv:['/opt/native/vendor/codex','--no-daemon']}
];
for(const reversed of [false,true])test(`npm Codex foreground group leader wins over exact child name, reversed=${reversed}`,async t=>{
  const h=await foregroundHarness(t,{group:4101,processes:cwd=>reversed?npmProcesses(cwd).reverse():npmProcesses(cwd)});
  const r=await runHerdrStage(h.input,h.ports);
  assert.equal(r.state,'settled',r.reason);assert.equal(r.backend.processProof.pid,4101);
  assert.equal(r.backend.processProof.startIdentity,'stable-start');assert.equal(r.backend.processProof.backendGen,1);
  assert.ok(h.proofRequests.length>1);assert.ok(h.proofRequests.every(x=>x.pid===4101&&x.paneId==='w1:p2'));
  assert.equal(count(h,'agent','start'),1);assert.equal(count(h,'agent','prompt'),1);assert.equal(count(h,'pane','close'),0);
  assert.ok(h.checkpoints.find(b=>b.phase==='ready'&&b.processProof?.pid===4101));
});
test('single native Claude process retains its proof without a reported group leader',async t=>{
  const h=await foregroundHarness(t,{agent:'claude',processes:cwd=>[{pid:4201,name:'claude',cwd,argv:['/usr/local/bin/claude']}]});
  const r=await runHerdrStage(h.input,h.ports);
  assert.equal(r.state,'settled',r.reason);assert.equal(r.backend.processProof.pid,4201);
  assert.equal(count(h,'agent','start'),1);assert.equal(count(h,'agent','prompt'),1);assert.equal(count(h,'pane','close'),0);
});
for(const group of [undefined,9999])test(`unique exact agent name resolves multiple candidates when group=${group}`,async t=>{
  const h=await foregroundHarness(t,{group,processes:npmProcesses});const r=await runHerdrStage(h.input,h.ports);
  assert.equal(r.state,'settled',r.reason);assert.equal(r.backend.processProof.pid,4102);
  assert.ok(h.proofRequests.every(x=>x.pid===4102));assert.equal(count(h,'agent','prompt'),1);
});
for(const scenario of [
  {name:'duplicate matching leaders',group:4101,processes:cwd=>[npmProcesses(cwd)[0],{...npmProcesses(cwd)[0]},npmProcesses(cwd)[1]]},
  {name:'ambiguous exact agent names',group:9999,processes:cwd=>[npmProcesses(cwd)[1],{...npmProcesses(cwd)[1],pid:4103}]},
  {name:'argv-only candidates with no exact name or leader',processes:cwd=>[npmProcesses(cwd)[0],{...npmProcesses(cwd)[0],pid:4103}]},
  {name:'group leader cannot bypass cwd or positive PID eligibility',group:4101,processes:cwd=>[{...npmProcesses(cwd)[0],cwd:cwd+'/other'},{...npmProcesses(cwd)[1],pid:0}]}
])test(`stage process selection refuses ${scenario.name} before first prompt`,async t=>{
  const h=await foregroundHarness(t,scenario),r=await runHerdrStage(h.input,h.ports);
  assert.equal(r.state,'recovery_required');assert.equal(r.reason,'stage_process_unproved');
  assert.equal(h.proofRequests.length,0);assert.equal(count(h,'agent','prompt'),0);assert.equal(count(h,'agent','start'),1);assert.equal(count(h,'pane','close'),0);
});
for(const changed of ['leader','start'])test(`npm stage refuses changed ${changed} after durable ready proof without delivery`,async t=>{
  const h=await foregroundHarness(t,{group:4101,processes:npmProcesses,startIdentity:(_,n)=>changed==='start'&&n>1?'replacement-start':'stable-start'});
  if(changed==='leader'){
    const exec=h.ports.execFile;let n=0;
    h.ports.execFile=async(...args)=>{const response=await exec(...args),data=JSON.parse(response.stdout);if(data.result?.process_info&&++n>1)data.result.process_info.foreground_process_group_id=4102;return {...response,stdout:JSON.stringify(data)};};
  }
  const r=await runHerdrStage(h.input,h.ports);
  assert.equal(r.state,'recovery_required');assert.equal(r.reason,'stage_process_changed');
  assert.equal(r.backend.processProof.pid,4101);assert.equal(r.backend.processProof.startIdentity,'stable-start');
  assert.equal(count(h,'agent','prompt'),0);assert.equal(count(h,'agent','start'),1);assert.equal(count(h,'pane','close'),0);
});

const loginMenu={codex:'\x1b[1m> 1. Sign in with ChatGPT\x1b[0m\n  2. Sign in with Device Code\n  3. Provide your own API key',claude:'❯ 1. Claude account with subscription\n  2. Anthropic Console account'};
for(const tool of ['codex','claude'])for(const blocked of [true,false])test(`issue20 C5 ${tool} sign-in menu blocks ${blocked?'startup refusal':'apparently ready agent'} without prompt or replacement`,async t=>{
  const h=await harness(t,{agent:tool,blocked,screen:loginMenu[tool]}),first=await runHerdrStage(h.input,h.ports);
  assert.equal(first.state,'blocked');assert.equal(first.code,'agent_sign_in_required');assert.equal(first.reason,'agent is waiting for sign-in');assert.match(first.message,/Attach to the original stage/);
  assert.equal(first.backend.nativeSession.value,nativeId);assert.equal(first.backend.backendGen,1);assert.equal(first.backend.phase,'start_intent');assert.equal(first.evidence.settledSeq,undefined);
  assert.equal(count(h,'agent','start'),1);assert.equal(count(h,'agent','prompt'),0);assert.equal(count(h,'pane','close'),0);
  h.options.blocked=false;h.options.screen='';const next=await runHerdrStage({...h.input,backend:first.backend},h.ports);
  assert.equal(next.state,'settled',next.reason);assert.equal(next.backend.attemptId,first.backend.attemptId);assert.equal(next.backend.nativeSession.value,nativeId);
  assert.equal(count(h,'agent','start'),1);assert.equal(count(h,'agent','prompt'),1);
});

for(const lostPrompt of [false,true])test(`issue20 C5 watcher preserves ${lostPrompt?'uncertain prompt intent':'submitted phase'} and never resends on a sign-in screen`,async t=>{
  const h=await harness(t,{lostPrompt});const exec=h.ports.execFile;
  h.ports.execFile=async(...args)=>{if(args[1][2]==='agent'&&args[1][3]==='prompt')h.options.screen=loginMenu.codex;return exec(...args);};
  const first=await runHerdrStage(h.input,h.ports),phase=lostPrompt?'prompt_intent':'submitted';
  const seen=await inspectHerdrStage({backend:first.backend},h.ports);
  assert.equal(seen.state,'blocked');assert.equal(seen.reason,'agent is waiting for sign-in');assert.equal(seen.backend.phase,phase);assert.equal(seen.backend.attemptId,first.backend.attemptId);
  assert.equal(seen.evidence.settledSeq,undefined);assert.equal(count(h,'agent','prompt'),1);assert.equal(count(h,'agent','start'),1);assert.equal(count(h,'pane','close'),0);
  assert.equal((await runHerdrStage({...h.input,backend:seen.backend},h.ports)).state,'blocked');assert.equal(count(h,'agent','prompt'),1);assert.equal(count(h,'agent','start'),1);
});

test('issue20 C5 new sign-in screen immediately before first prompt retains ready proof without delivery',async t=>{
  const h=await harness(t);let reads=0;const exec=h.ports.execFile;
  h.ports.execFile=async(...args)=>{if(args[1][2]==='pane'&&args[1][3]==='read'&&++reads===2)h.options.screen=loginMenu.codex;return exec(...args);};
  const result=await runHerdrStage(h.input,h.ports);
  assert.equal(result.state,'blocked');assert.equal(result.backend.phase,'ready');assert.equal(result.backend.processProof.startIdentity,'start-1');assert.equal(count(h,'agent','prompt'),0);assert.equal(count(h,'agent','start'),1);
  h.ports.processStartIdentity=async()=> 'replacement-start';
  const changed=await runHerdrStage({...h.input,backend:result.backend},h.ports);
  assert.equal(changed.state,'recovery_required');assert.equal(changed.reason,'stage_process_changed');assert.equal(count(h,'agent','prompt'),0);assert.equal(count(h,'agent','start'),1);
});

for(const changed of ['native','process'])test(`issue20 C5 sign-in menu cannot mask changed ${changed} identity`,async t=>{
  const h=await harness(t,{working:true}),first=await runHerdrStage(h.input,h.ports);h.options.screen=loginMenu.codex;
  if(changed==='native')h.options.replaced=true;else h.ports.processStartIdentity=async()=> 'replacement-start';
  const reads=count(h,'pane','read'),seen=await inspectHerdrStage({backend:first.backend},h.ports);
  assert.equal(seen.state,'recovery_required');assert.equal(seen.reason,changed==='native'?'native_identity_changed':'stage_process_changed');assert.equal(count(h,'pane','read'),reads);
  assert.equal(count(h,'agent','prompt'),1);assert.equal(count(h,'agent','start'),1);assert.equal(count(h,'pane','close'),0);
});

for(const scenario of [
  {name:'quoted prose',screen:'The guide says "1. Sign in with ChatGPT" if you need access.'},
  {name:'unnumbered prose',screen:'Sign in with ChatGPT to use the native CLI.'},
  {name:'wrong pane',screen:loginMenu.codex,readReply:{pane_id:'w1:p9'}},
  {name:'wrong workspace',screen:loginMenu.codex,readReply:{workspace_id:'w9'}},
  {name:'oversized screen',screen:loginMenu.codex+'\n'+'x'.repeat(65536)},
  {name:'malformed screen',readReply:{text:null}}
])test(`issue20 C5 ${scenario.name} cannot manufacture sign-in evidence or replace lifecycle proof`,async t=>{
  const h=await harness(t,scenario),result=await runHerdrStage(h.input,h.ports);
  assert.equal(result.state,'settled',result.reason);assert.equal(result.backend.processProof.startIdentity,'start-1');assert.equal(count(h,'agent','prompt'),1);assert.equal(count(h,'agent','start'),1);
});

test('issue20 C5 unreadable screen remains unknown with existing strict proof and no extra native effect',async t=>{
  const h=await harness(t),exec=h.ports.execFile;
  h.ports.execFile=async(...args)=>{if(args[1][2]==='pane'&&args[1][3]==='read')throw Object.assign(Error('synthetic private screen failure'),{code:'ECONNRESET'});return exec(...args);};
  const result=await runHerdrStage(h.input,h.ports);assert.equal(result.state,'settled',result.reason);assert.equal(count(h,'agent','prompt'),1);assert.equal(count(h,'agent','start'),1);assert.doesNotMatch(JSON.stringify(result),/synthetic private/);
});

test('issue20 C5 screen read preserves known missing executable path without fallback or repeat',async t=>{
  const h=await harness(t),exec=h.ports.execFile;
  h.ports.execFile=async(...args)=>{if(args[1][2]==='pane'&&args[1][3]==='read')throw Object.assign(Error('Herdr not found at /synthetic/selected-herdr'),{code:'herdr_not_found'});return exec(...args);};
  const result=await runHerdrStage(h.input,h.ports);assert.equal(result.state,'recovery_required');assert.equal(result.reason,'herdr_not_found');assert.equal(result.message,'Herdr not found at /synthetic/selected-herdr');assert.equal(count(h,'agent','start'),1);assert.equal(count(h,'agent','prompt'),0);
});

test('issue20 C5 sign-in during proved history resume preserves new generation and never sends original prompt again',async t=>{
  const h=await harness(t),first=await runHerdrStage(h.input,h.ports);h.options.screen=loginMenu.codex;
  const resumeIntent={runId:first.backend.runId,stageId:first.backend.stageId,attemptId:first.backend.attemptId,oldGeneration:1,newGeneration:2,nativeSession:first.backend.nativeSession,launchSelection:null,stoppedProof:{complete:true}};
  const resumed=await resumeHerdrStage({backend:first.backend,resumeIntent,checkpoint:h.input.checkpoint},{...h.ports,verifyStoppedStage:async()=>true,admitStageResume:async()=>({allowed:true})});
  assert.equal(resumed.state,'blocked');assert.equal(resumed.reason,'agent is waiting for sign-in');assert.equal(resumed.backend.backendGen,2);assert.equal(resumed.backend.phase,'resume_intent');assert.equal(resumed.backend.nativeSession.value,nativeId);
  assert.equal(count(h,'agent','start'),2);assert.equal(count(h,'agent','prompt'),1);assert.equal(count(h,'pane','close'),0);
});

test('issue20 C5 sign-in screen text never enters trace, checkpoint or public result and precedes idle alarm',async t=>{
  const h=await harness(t,{working:true}),first=await runHerdrStage(h.input,h.ports),privateText='SYNTHETIC_SCREEN_MUST_STAY_LOCAL';h.options.screen=loginMenu.codex+'\n'+privateText;
  h.ports.home=h.input.cwd;h.ports.env={PDD_TRACE:'herdr'};h.ports.onStageObservation=()=>assert.fail('sign-in wins over the idle alarm');
  const seen=await inspectHerdrStage({backend:first.backend},h.ports);
  assert.equal(seen.state,'blocked');assert.equal(seen.reason,'agent is waiting for sign-in');
  assert.doesNotMatch(JSON.stringify({seen,checkpoints:h.checkpoints,trace:readHerdrTrace({home:h.input.cwd})}),new RegExp(privateText));
  assert.equal(count(h,'agent','prompt'),1);assert.equal(count(h,'pane','close'),0);
});

for(const agent of ['codex','claude'])for(const quote of ['backticks','quoted tildes','unclosed example'])test(`R1-C5-B1 ${agent} ${quote} login documentation preserves working stage without human block`,async t=>{
  const h=await harness(t,{agent,working:true}),first=await runHerdrStage(h.input,h.ports),label=agent==='codex'?'Sign in with ChatGPT':'Claude account with subscription';
  assert.equal(first.state,'active');
  h.options.screen=quote==='backticks'?`Example login guidance (quoted documentation):\n\`\`\`text\n1. ${label}\n\`\`\`\nThis is an example, not a sign-in request.`
    :quote==='quoted tildes'?`Example login guidance:\n> ~~~~text\n> 1. ${label}\n> ~~~\n> 2. ${label}\n> ~~~~\nExample ended.`
    :`Example login guidance:\n\`\`\`\`text\n1. ${label}\n~~~\n2. ${label}`;
  const seen=await inspectHerdrStage({backend:first.backend},h.ports);
  assert.equal(seen.state,'active',seen.reason);assert.equal(seen.code,undefined);assert.equal(seen.reason,undefined);assert.equal(seen.backend.phase,first.backend.phase);assert.equal(seen.backend.attemptId,first.backend.attemptId);assert.deepEqual(seen.backend.processProof,first.backend.processProof);
  assert.equal(count(h,'agent','prompt'),1);assert.equal(count(h,'agent','start'),1);assert.equal(count(h,'pane','close'),0);
  assert.ok(!JSON.stringify({seen,checkpoints:h.checkpoints}).includes(h.options.screen));
});

for(const agent of ['codex','claude'])test(`R1-C5-B1 ${agent} real menu after closed quoted guidance still blocks original without resend`,async t=>{
  const h=await harness(t,{agent,working:true}),first=await runHerdrStage(h.input,h.ports);
  h.options.screen='Example only:\n```text\n'+loginMenu[agent]+'\n```\n\n'+loginMenu[agent];
  const seen=await inspectHerdrStage({backend:first.backend},h.ports);
  assert.equal(seen.state,'blocked');assert.equal(seen.code,'agent_sign_in_required');assert.equal(seen.reason,'agent is waiting for sign-in');assert.equal(seen.backend.phase,first.backend.phase);assert.equal(seen.backend.attemptId,first.backend.attemptId);
  assert.equal(count(h,'agent','prompt'),1);assert.equal(count(h,'agent','start'),1);assert.equal(count(h,'pane','close'),0);
});


for(const [text,code] of [['exceeded retry limit, last status: 429 Too Many Requests','busy_429'],['model capacity exceeded','capacity'],['quota exceeded','quota'],['done with no report','unknown']])test(`C13 settled pane diagnostic classifies ${code} without retaining text`,async t=>{
  const h=await harness(t),first=await runHerdrStage(h.input,h.ports),exec=h.ports.execFile;
  h.ports.execFile=async(file,args,opts)=>args[2]==='pane'&&args[3]==='read'?{stdout:JSON.stringify({result:{read:{pane_id:first.backend.paneId,text}}})}:exec(file,args,opts);
  const found=await readSettledHerdrStageError({backend:first.backend},{...h.ports,checkpoint:h.input.checkpoint});assert.deepEqual(found,{code});
  assert.equal(count(h,'agent','prompt'),1);
});
test('C13 settled continuation is durable before one send and lost acknowledgement never resends',async t=>{
  const h=await harness(t),first=await runHerdrStage(h.input,h.ports),exec=h.ports.execFile;let retries=0;
  h.ports.execFile=async(file,args,opts)=>{
    if(args[2]==='agent'&&args[3]==='prompt'){retries++;assert.equal(h.checkpoints.at(-1).handoffRetry.settledSeq,3);assert.equal(h.checkpoints.at(-1).phase,'prompt_intent');assert.notEqual(args[5],h.input.instructions);throw Error('lost');}
    return exec(file,args,opts);
  };
  const ports={...h.ports,checkpoint:h.input.checkpoint};
  const next=await retrySettledHerdrStage({backend:first.backend,settledSeq:3},ports);assert.equal(next.state,'recovery_required');assert.equal(next.backend.phase,'prompt_intent');assert.equal(retries,1);
  await retrySettledHerdrStage({backend:next.backend,settledSeq:3},ports);assert.equal(retries,1);assert.equal(count(h,'agent','start'),1);assert.equal(count(h,'pane','close'),0);
});
for(const fault of ['checkpoint','process','sequence'])test(`C13 continuation refuses ${fault} before delivery`,async t=>{
  const h=await harness(t),first=await runHerdrStage(h.input,h.ports);const ports={...h.ports,checkpoint:h.input.checkpoint};
  if(fault==='checkpoint')ports.checkpoint=async()=>{throw Error('disk');};
  if(fault==='process')ports.processStartIdentity=async()=>'different';
  if(fault==='sequence')h.options.later=true;
  const next=await retrySettledHerdrStage({backend:first.backend,settledSeq:3},ports);assert.equal(next.state,'recovery_required');assert.equal(count(h,'agent','prompt'),1);
});

test('C13 successful continuation preserves identity and requires a fresh working-to-settled sequence',async t=>{
  const h=await harness(t),first=await runHerdrStage(h.input,h.ports),exec=h.ports.execFile;let retrying=false,delivered=0;
  h.ports.execFile=async(file,args,opts)=>{
    if(args[2]==='agent'&&args[3]==='prompt'){
      delivered++;retrying=true;
      const reply=JSON.parse((await exec(file,['--session','default','agent','get',first.backend.agentName],opts)).stdout);
      reply.result.agent.agent_status='working';reply.result.agent.state_change_seq=4;reply.result.agent.interactive_ready=false;
      return {stdout:JSON.stringify(reply)};
    }
    const reply=await exec(file,args,opts);
    if(retrying&&args[2]==='agent'&&args[3]==='get'){const data=JSON.parse(reply.stdout);data.result.agent.state_change_seq=5;return {stdout:JSON.stringify(data)};}
    return reply;
  };
  const ports={...h.ports,checkpoint:h.input.checkpoint};
  const next=await retrySettledHerdrStage({backend:first.backend,settledSeq:3},ports);assert.equal(next.state,'active',next.reason);
  assert.deepEqual(next.backend.nativeSession,first.backend.nativeSession);assert.deepEqual(next.backend.processProof,first.backend.processProof);assert.equal(next.backend.promptDigest,first.backend.promptDigest);
  const settled=await inspectHerdrStage({backend:next.backend},ports);assert.equal(settled.state,'settled',settled.reason);assert.deepEqual(settled.evidence,{readySeq:3,workingSeq:4,settledSeq:5});
  await retrySettledHerdrStage({backend:settled.backend,settledSeq:3},ports);assert.equal(delivered,1);assert.equal(count(h,'agent','start'),1);
});


test('C13 continuation needs the saved process proof, not only a fresh matching process',async t=>{
  const h=await harness(t),first=await runHerdrStage(h.input,h.ports);delete first.backend.processProof;
  const next=await retrySettledHerdrStage({backend:first.backend,settledSeq:3},{...h.ports,checkpoint:h.input.checkpoint});assert.equal(next.state,'recovery_required');assert.equal(count(h,'agent','prompt'),1);
});
