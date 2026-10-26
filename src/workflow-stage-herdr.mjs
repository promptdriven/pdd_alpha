// Generated from prompts/cli/workflow-stage-herdr.prompt.md (sha256: 04d2535edd7168b403fe4c40d9e90f029b9ef6dd958df0ace389580706ab81d7).
import {execFile as callbackExec,spawn} from 'node:child_process';
import {promisify,isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {readFile,realpath} from 'node:fs/promises';
import {basename} from 'node:path';
import {resolveHerdrExecutable} from './workflow-herdr-executable.mjs';
import {traceHerdrRequest} from './herdr-trace.mjs';
import {nativeArgs} from './native-flags.mjs';
const execute=promisify(callbackExec),UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const STAGE=/^(?=.{1,64}$)[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const hash=x=>createHash('sha256').update(x).digest('hex'),copy=x=>structuredClone(x);
const fault=code=>Object.assign(Error(code),{code});
const claims=new Map();
const executableBindings=new WeakMap();
function rt(p) {
  if(!executableBindings.has(p))executableBindings.set(p,{});
  return {p,binding:executableBindings.get(p),now:p.now??Date.now,sleep:p.sleep??(ms=>new Promise(r=>setTimeout(r,ms))),exec:p.execFile??execute,guard:p.withStageGuard??(()=>{throw fault('stage_guard_required');}),pollMs:p.pollMs??100,startupMs:p.startupMs??30000,observeMs:p.observeMs??p.timeoutMs??1800000};
}
async function selectedExecutable(r){
  if((r.p.runtime!=null&&Object.hasOwn(r.p.runtime,'herdr'))||Object.hasOwn(r.p,'herdrExecutable'))return resolveHerdrExecutable(r.p);
  if(!r.binding.selection){
    const selection=resolveHerdrExecutable(r.p);r.binding.selection=selection;
    try{await selection;}catch(e){if(r.binding.selection===selection)delete r.binding.selection;throw e;}
  }
  return resolveHerdrExecutable({herdrExecutable:await r.binding.selection});
}
function inspectionPorts(r,checkpoint){
  const ports={...r.p,checkpoint};executableBindings.set(ports,r.binding);return ports;
}
const outcome=(b,reason,state='recovery_required')=>({state,backend:b?copy(b):null,evidence:copy(b?.evidence??{}),...(reason?{reason}:{})});
const stageFailure=(b,e,fallback)=>({...outcome(b,e.code??fallback),...(e.code==='herdr_not_found'?{message:e.message}:{})});
async function command(r,b,args) {
  let response,executable;try{response=await traceHerdrRequest({operation:`${args[0]}.${args[1].replaceAll('-','_')}`,request:{argv:['--session',b.session,...args]}},async()=>{
    executable=await selectedExecutable(r);
    return r.exec(executable,['--session',b.session,...args],{cwd:b.cwd,...(r.p.env!==undefined?{env:r.p.env}:{}),shell:false,encoding:'utf8',timeout:r.startupMs+5000,maxBuffer:1024*1024});
  },r.p);}
  catch(e){
    if(e.code==='herdr_not_found')throw e;
    if(e.code==='ENOENT'&&executable){
      try{await resolveHerdrExecutable({herdrExecutable:executable});}catch(missing){if(missing.code==='herdr_not_found')throw missing;}
    }
    let error;try{error=JSON.parse(e.stderr)?.error?.code;}catch{}throw fault(typeof error==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(error)?error:'herdr_command_uncertain');
  }
  let x;try{x=JSON.parse(response.stdout);}catch{throw fault('herdr_invalid_reply');}
  if(response.code!==undefined&&response.code!==0||!x||x.error){const code=x?.error?.code;throw fault(typeof code==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(code)?code:'herdr_command_uncertain');}return x;
}
async function checkpoint(b,fn) {if(typeof fn!=='function')throw fault('durable_checkpoint_required');await fn(copy(b));}
function validate(b) {
  if(!b||b.version!==2||b.session!=='default'||!UUID.test(b.runId??'')||!UUID.test(b.attemptId??'')||!STAGE.test(b.stageId??'')
    ||!['codex','claude'].includes(b.agent)||!Number.isSafeInteger(b.backendGen)||b.backendGen<1||typeof b.cwd!=='string')throw fault('stage_backend_requires_adoption');
}
function agentValue(x) {const a=x?.result?.agent;if(!a||!Number.isSafeInteger(a.state_change_seq)||a.state_change_seq<0)throw fault('invalid_agent_reply');return a;}
async function agent(r,b,supplied) {
  const a=supplied??agentValue(await command(r,b,['agent','get',b.agentName]));
  for(const [key,val] of Object.entries({workspace_id:b.workspaceId,tab_id:b.tabId,pane_id:b.paneId,terminal_id:b.terminalId,name:b.agentName,agent:b.agent}))if(!val||a[key]!==val)throw fault('stage_identity_changed');
  if(await realpath(a.cwd??'')!==b.cwd||a.state_change_seq<(b.lastSeq??0))throw fault('stage_identity_changed');
  if(b.nativeSession&&!isDeepStrictEqual(b.nativeSession,a.agent_session??null))throw fault('native_identity_changed');
  return a;
}
const ready=a=>['idle','done'].includes(a.agent_status)&&a.interactive_ready===true&&!a.launch_pending;
function remember(b,a) {b.lastSeq=a.state_change_seq;if(!b.nativeSession&&a.agent_session)b.nativeSession=copy(a.agent_session);}
async function processProof(r,b) {
  const x=(await command(r,b,['pane','process-info','--pane',b.paneId])).result?.process_info;
  if(x?.pane_id!==b.paneId||!Array.isArray(x.foreground_processes))throw fault('stage_process_unproved');
  let candidates=x.foreground_processes.filter(p=>Number.isSafeInteger(p.pid)&&p.pid>0&&p.cwd===b.cwd&&(p.name===b.agent||basename(p.argv0??'')===b.agent||(p.argv??[]).some(v=>basename(v)===b.agent)));
  if(candidates.length>1){
    const leaders=candidates.filter(p=>p.pid===x.foreground_process_group_id);
    candidates=leaders.length?leaders:candidates.filter(p=>p.name===b.agent);
  }
  if(candidates.length!==1)throw fault('stage_process_unproved');
  const p=candidates[0];let start;
  if(r.p.processStartIdentity)start=await r.p.processStartIdentity({pid:p.pid,paneId:b.paneId});
  else if(process.platform==='linux'){const text=await readFile(`/proc/${p.pid}/stat`,'utf8');start=text.slice(text.lastIndexOf(')')+2).split(' ')[19];}
  if(typeof start!=='string'||!start)throw fault('unsupported');
  const proof={pid:p.pid,startIdentity:start,paneId:b.paneId,terminalId:b.terminalId,backendGen:b.backendGen};
  if(b.processProof&&!isDeepStrictEqual(b.processProof,proof))throw fault('stage_process_changed');return proof;
}
const claimKey=b=>`${b.runId}/${b.attemptId}/${b.backendGen}`;
async function claim(r,b) {
  if(claims.has(claimKey(b)))return;
  const fn=r.p.claimWorkflowSession??(await import('./workflow-claims.mjs')).claimWorkflowSession;
  const handle=await fn({kind:b.agent,nativeSessionId:null,owner:{runId:b.runId,attemptId:b.attemptId,backendGen:b.backendGen}},r.p);
  if(handle?.state!=='owned')throw fault('stage_claim_unavailable');claims.set(claimKey(b),handle);
}
async function promote(r,b) {
  if(b.nativeSession?.kind!=='id')return;
  const handle=claims.get(claimKey(b));if(handle?.state!=='owned')throw fault('stage_claim_unavailable');
  const fn=r.p.promoteWorkflowClaim??(await import('./workflow-claims.mjs')).promoteWorkflowClaim;
  const promoted=await fn({claim:handle,kind:b.agent,nativeSessionId:b.nativeSession.value},r.p);
  if(promoted?.state!=='owned')throw fault('stage_claim_unavailable');claims.set(claimKey(b),promoted);
}
async function rememberAndClaim(r,b,a,save) {
  const discovered=!b.nativeSession&&a.agent_session;
  remember(b,a);
  // The claims owner binds against durable journal identity, including ids first
  // disclosed after delivery. A failed promotion must retain that discovery.
  if(discovered)await checkpoint(b,save);
  if(b.nativeSession?.kind==='id'){await claim(r,b);await promote(r,b);}
}
async function supportedSelection(b,ports){
  if(!b.launchSelection)return true;
  if(b.launchSelection.agent!==b.agent)return false;
  if(ports.validateLaunchSelection)return await ports.validateLaunchSelection(b.launchSelection)===true;
  try{const resolveModel=ports.resolveWorkflowModel??(await import('./workflow-models.mjs')).resolveWorkflowLaunchModel;const selection=b.launchSelection;const r=await resolveModel({machineId:selection.machineId,agent:b.agent,frozenSelection:selection,selection:selection.model===null?undefined:{model:selection.model,...(selection.effort==null?{}:{effort:selection.effort})}},ports);return r?.state==='selected'&&r.selection.model===selection.model&&r.selection.effort===selection.effort;}catch{return false;}
}
function launchArgs(b,ports,resume){
  const encode=ports.nativeArgs??nativeArgs,input={agent:b.agent,cwd:b.cwd,selection:b.launchSelection,...(resume?{resume}:{})},args=encode(input);
  if(b.launchSelection&&b.launchSelection.source!=='native-defaults'&&isDeepStrictEqual(args,encode({...input,selection:undefined})))throw fault('unsupported');
  return args;
}
async function signInScreen(r,b){
  try{
    const screen=(await command(r,b,['pane','read',b.paneId,'--source','visible','--format','text'])).result?.read;
    if(screen?.pane_id!==b.paneId||typeof screen.text!=='string'||Buffer.byteLength(screen.text)>65536
      ||screen.workspace_id!==undefined&&screen.workspace_id!==b.workspaceId||screen.tab_id!==undefined&&screen.tab_id!==b.tabId)return false;
    const choice=b.agent==='codex'?/^(?:sign in with chatgpt|sign in with device code|provide your own api key)$/i:/^(?:sign in to claude|claude account with subscription|anthropic console account)$/i;
    let fence=null;
    for(const line of screen.text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').split(/\r?\n/)){
      const marker=/^\s*(?:>\s*)?(`{3,}|~{3,})(.*)$/u.exec(line);
      if(fence){if(marker&&marker[1][0]===fence.kind&&marker[1].length>=fence.length&&!marker[2].trim())fence=null;continue;}
      if(marker){fence={kind:marker[1][0],length:marker[1].length};continue;}
      const menu=/^\s*(?:[>›❯●○]\s*)?\d+[.)]\s*(.*?)\s*$/u.exec(line);if(menu!==null&&choice.test(menu[1]))return true;
    }
    return false;
  }catch(e){if(e.code==='herdr_not_found')throw e;return false;}
}
const needsSignIn=b=>({...outcome(b,'agent is waiting for sign-in','blocked'),code:'agent_sign_in_required',message:'Agent is waiting for sign-in. Attach to the original stage to sign in, then inspect it again.'});
async function observed(r,b,save) {
  try{return await r.guard(b,async()=>{
    const a=await agent(r,b);await rememberAndClaim(r,b,a,save??r.p.checkpoint);if(b.processProof)await processProof(r,b);
    if(await signInScreen(r,b))return needsSignIn(b);
    if((await r.p.onStageObservation?.({backend:copy(b),status:a.agent_status,reason:a.agent_status==='blocked'?'native_person_action_required':null}))?.pause)return outcome(b,'stage_idle_alarm','active');
    if(a.agent_status==='blocked'||a.launch_pending){if(save)await checkpoint(b,save);return outcome(b,'native_person_action_required','blocked');}
    if(a.agent_status==='working') {
      if(!['prompt_intent','submitted','history_resumed'].includes(b.phase))return outcome(b,'unexpected_native_activity');
      if(a.state_change_seq>(b.evidence.readySeq??Infinity))b.evidence.workingSeq??=a.state_change_seq;
      if(save)await checkpoint(b,save);return outcome(b,null,'active');
    }
    if(ready(a)&&b.evidence.workingSeq&&a.state_change_seq>b.evidence.workingSeq) {
      await processProof(r,b);
      if(b.phase==='candidate'&&a.state_change_seq!==b.evidence.settledSeq)return outcome(b,'candidate_sequence_changed');
      b.evidence.settledSeq??=a.state_change_seq;b.phase='candidate';if(save)await checkpoint(b,save);return outcome(b,null,'settled');
    }
    return outcome(b,ready(a)?'no_observed_prompt_activity':'native_state_unknown');
  });}catch(e){if(e.code==='WORKFLOW_STAGE_BUSY')return outcome(b,'stage_temporarily_guarded','active');throw e;}
}
export async function runHerdrStage(input={},ports={}) {
  const r=rt(ports);let b=input.backend?copy(input.backend):null;
  try {
    if(!UUID.test(input.runId??'')||!UUID.test(input.attemptId??'')||!STAGE.test(input.stageId??'')||!['codex','claude'].includes(input.agent)
      ||typeof input.context!=='string'||!input.context.trim()||typeof input.instructions!=='string'||!input.instructions.trim()||typeof input.checkpoint!=='function'||!ports.withStageGuard)throw fault('invalid_stage_input');
    const cwd=await realpath(input.cwd),prompt=`${input.context}\n\n# Current workflow stage\n${input.instructions}`,promptDigest=hash(prompt);
    if(b&&b.version!==2)return outcome(b,'stage_backend_requires_adoption');
    const same=b&&b.runId===input.runId&&b.stageId===input.stageId&&b.attemptId===input.attemptId;
    if(same) {
      validate(b);if(b.cwd!==cwd||b.agent!==input.agent||b.promptDigest!==promptDigest||!isDeepStrictEqual(b.launchSelection,input.launchSelection??null))throw fault('stage_binding_changed');
      if(!['start_intent','ready'].includes(b.phase)||Object.keys(b.evidence??{}).some(k=>k!=='readySeq'))return inspectHerdrStage({backend:b,cwd},inspectionPorts(r,input.checkpoint));
    } else {
      if(b&&(b.phase!=='closed'||!b.acceptanceDigest))throw fault('previous_stage_not_released');
      const c=ports.controller;if(c?.herdrSession!=='default'||![c.workspaceId,c.tabId,c.paneId].every(v=>typeof v==='string'&&v))throw fault('unsupported');
      const backendGen=input.backendGen??ports.backendGen??1;
      b={version:2,runId:input.runId,stageId:input.stageId,attemptId:input.attemptId,agent:input.agent,cwd,session:'default',workspaceId:c.workspaceId,tabId:c.tabId,controllerPaneId:c.paneId,agentName:`pdd-${hash(input.attemptId).slice(0,24)}`,nativeSession:null,backendGen,launchSelection:copy(input.launchSelection??null),promptDigest,phase:'pane_intent',evidence:{}};
      validate(b);await checkpoint(b,input.checkpoint);
    }
    if(!await supportedSelection(b,ports))return outcome(b,'saved_selection_unsupported','blocked');
    const args=launchArgs(b,ports);
    const setup=await r.guard(b,async()=>{
      await claim(r,b);
      if(b.phase==='pane_intent') {
        const created=(await command(r,b,['pane','split','--pane',b.controllerPaneId,'--direction','right','--cwd',cwd,'--no-focus'])).result?.pane;
        if(created?.workspace_id!==b.workspaceId||created.tab_id!==b.tabId||![created.pane_id,created.terminal_id].every(v=>typeof v==='string'&&v)||created.pane_id===b.controllerPaneId)throw fault('invalid_stage_pane');
        b.paneId=created.pane_id;b.terminalId=created.terminal_id;b.phase='start_intent';await checkpoint(b,input.checkpoint);
        let started;
        try{started=await command(r,b,['agent','start',b.agentName,'--kind',b.agent,'--pane',b.paneId,'--timeout',String(r.startupMs),'--',...args]);}
        catch(e){if(e.code!=='agent_not_ready')throw e;const actual=await agent(r,b);await rememberAndClaim(r,b,actual,input.checkpoint);await checkpoint(b,input.checkpoint);if(b.processProof)await processProof(r,b);return await signInScreen(r,b)?needsSignIn(b):outcome(b,'native_start_person_action_required','blocked');}
        const actual=await agent(r,b,agentValue(started));await rememberAndClaim(r,b,actual,input.checkpoint);await checkpoint(b,input.checkpoint);
      }
      const actual=await agent(r,b);await rememberAndClaim(r,b,actual,input.checkpoint);await checkpoint(b,input.checkpoint);
      if(b.processProof)await processProof(r,b);
      if(await signInScreen(r,b))return needsSignIn(b);
      if(!ready(actual))return outcome(b,'native_start_person_action_required','blocked');
      await promote(r,b);b.processProof=await processProof(r,b);b.phase='ready';b.evidence.readySeq=actual.state_change_seq;await checkpoint(b,input.checkpoint);
      if(await signInScreen(r,b))return needsSignIn(b);
      const fresh=await agent(r,b);await rememberAndClaim(r,b,fresh,input.checkpoint);if(!ready(fresh)||fresh.state_change_seq!==b.evidence.readySeq)throw fault('fresh_agent_changed_before_prompt');await processProof(r,b);
      b.phase='prompt_intent';await checkpoint(b,input.checkpoint);
      const delivered=await agent(r,b,agentValue(await command(r,b,['agent','prompt',b.agentName,prompt])));await rememberAndClaim(r,b,delivered,input.checkpoint);
      if(delivered.agent_status==='working'&&delivered.state_change_seq>b.evidence.readySeq)b.evidence.workingSeq=delivered.state_change_seq;
      b.phase='submitted';await checkpoint(b,input.checkpoint);
    });
    if(setup)return setup;
    const until=r.now()+r.observeMs;
    while(r.now()<until) {
      const seen=await observed(r,b,input.checkpoint);b=seen.backend;
      if(seen.state==='settled'||seen.state==='blocked'||seen.reason==='stage_idle_alarm')return seen;
      if(seen.state==='recovery_required'&&seen.reason!=='no_observed_prompt_activity')return seen;
      await r.sleep(r.pollMs);
    }
    // Observation budget is an alarm, never a duration-based failure or termination.
    return outcome(b,'stage_observation_pending','active');
  }catch(e){return stageFailure(b,e,'stage_transport_uncertain');}
}
export async function inspectHerdrStage({backend,cwd}={},ports={}) {
  const b=copy(backend),r=rt(ports);
  try{validate(b);if(await realpath(cwd??b.cwd)!==b.cwd)throw fault('stage_cwd_changed');if(['closed','close_intent','resume_intent'].includes(b.phase))return outcome(b,b.phase==='closed'?'stage_archived':'stage_effect_unconfirmed');return await observed(r,b);}
  catch(e){return stageFailure(b,e,'stage_inspection_unavailable');}
}
async function settledIdentity(r,b) {
  validate(b);
  if(b.phase!=='candidate'||!b.processProof||!Number.isSafeInteger(b.evidence?.settledSeq))throw fault('stage_not_quiescent');
  const a=await agent(r,b);await rememberAndClaim(r,b,a,r.p.checkpoint);
  if(!ready(a)||a.state_change_seq!==b.evidence.settledSeq)throw fault('stage_not_quiescent');
  await processProof(r,b);
  return a;
}
export async function readSettledHerdrStageError({backend}={},ports={}) {
  const b=copy(backend),r=rt(ports);
  try{return await r.guard(b,async()=>{
    await settledIdentity(r,b);
    const read=(await command(r,b,['pane','read',b.paneId,'--source','visible','--format','text'])).result?.read;
    if(read?.pane_id!==b.paneId||typeof read.text!=='string')return {code:'unknown'};
    const tail=read.text.slice(-4096);
    const lines=tail.split(/\r?\n/).filter(line=>/429|capacity|quota|rate.?limit|too many requests/i.test(line));
    const last=lines.at(-1)??'';
    return {code:/429|too many requests/i.test(last)?'busy_429':/capacity/i.test(last)?'capacity':/quota|rate.?limit/i.test(last)?'quota':'unknown'};
  });}catch{return {code:'unknown'};}
}
export async function retrySettledHerdrStage({backend,settledSeq}={},ports={}) {
  const b=copy(backend),r=rt(ports);
  try {
    validate(b);
    if(b.handoffRetry?.settledSeq===settledSeq)return inspectHerdrStage({backend:b},ports);
    return await r.guard(b,async()=>{
      if(b.evidence?.settledSeq!==settledSeq||!await supportedSelection(b,ports))throw fault('stage_retry_unproved');
      const a=await settledIdentity(r,b);
      b.handoffRetry={settledSeq};b.evidence={readySeq:a.state_change_seq};b.phase='prompt_intent';
      await checkpoint(b,ports.checkpoint);
      const prompt='Continue the same original workflow stage with its unchanged input and handoff path. Preserve all completed work; do not repeat completed actions or start another stage. Finish the remaining work and write the originally requested handoff.';
      const delivered=await agent(r,b,agentValue(await command(r,b,['agent','prompt',b.agentName,prompt])));
      await rememberAndClaim(r,b,delivered,ports.checkpoint);
      if(delivered.agent_status==='working'&&delivered.state_change_seq>b.evidence.readySeq)b.evidence.workingSeq=delivered.state_change_seq;
      b.phase='submitted';await checkpoint(b,ports.checkpoint);
      return outcome(b,'stage_continuation_pending','active');
    });
  }catch(e){return stageFailure(b,e,'stage_continuation_uncertain');}
}
export async function attachHerdrStage({backend}={},ports={}) {
  const b=copy(backend),r=rt(ports);
  try{validate(b);if(b.phase==='closed')return 2;return await r.guard(b,async()=>{
    await rememberAndClaim(r,b,await agent(r,b),ports.checkpoint);if(b.processProof)await processProof(r,b);
    return traceHerdrRequest({operation:'agent.attach',request:{argv:['--session',b.session,'agent','attach',b.agentName]}},async()=>{
      if(ports.spawnAttach)return ports.spawnAttach(b.session,b.agentName,b.cwd);
      const executable=await selectedExecutable(r);
      return new Promise(resolve=>{const child=(ports.spawn??spawn)(executable,['--session',b.session,'agent','attach',b.agentName],{cwd:b.cwd,stdio:'inherit',shell:false});child.once('error',()=>resolve(1));child.once('close',code=>resolve(Number.isInteger(code)?code:1));});
    },ports);
  });}catch{return 1;}
}
export async function closeHerdrStage({backend,acceptance}={},ports={}) {
  const b=copy(backend),r=rt(ports);
  try {
    validate(b);
    if(b.phase!=='candidate'||!acceptance||acceptance.runId!==b.runId||acceptance.stageId!==b.stageId||acceptance.attemptId!==b.attemptId
      ||acceptance.promptDigest!==b.promptDigest||acceptance.terminalId!==b.terminalId||acceptance.backendGen!==b.backendGen||!/^[a-f0-9]{64}$/.test(acceptance.evidenceDigest??''))throw fault('durable_stage_acceptance_required');
    return await r.guard(b,async()=>{
      const a=await agent(r,b);await rememberAndClaim(r,b,a,ports.checkpoint);if(!ready(a)||a.state_change_seq!==b.evidence.settledSeq)throw fault('stage_not_quiescent');await processProof(r,b);
      b.acceptanceDigest=hash(JSON.stringify(acceptance));b.phase='close_intent';await checkpoint(b,ports.checkpoint);
      const ack=await command(r,b,['pane','close',b.paneId]);if(ack.id!=='cli:pane:close'||ack.result?.type!=='ok')throw fault('pane_close_unconfirmed');
      const list=(await command(r,b,['pane','list','--workspace',b.workspaceId])).result;
      if(list?.type!=='pane_list'||!Array.isArray(list.panes)||list.panes.some(p=>typeof p.pane_id!=='string')||new Set(list.panes.map(p=>p.pane_id)).size!==list.panes.length||list.panes.some(p=>p.pane_id===b.paneId))throw fault('pane_close_unconfirmed');
      b.phase='closed';b.cleanupConfirmation={acknowledgement:'ok',absentPaneId:b.paneId};await checkpoint(b,ports.checkpoint);
      const handle=claims.get(claimKey(b));await handle?.release?.();claims.delete(claimKey(b));return outcome(b,null,'closed');
    });
  }catch(e){return stageFailure(b,e,'stage_cleanup_uncertain');}
}
export async function resumeHerdrStage({backend,cwd,resumeIntent,checkpoint:save}={},ports={}) {
  const b=copy(backend),r=rt(ports);
  try {
    validate(b);if(await realpath(cwd??b.cwd)!==b.cwd||!resumeIntent||resumeIntent.runId!==b.runId||resumeIntent.attemptId!==b.attemptId
      ||resumeIntent.stageId!==b.stageId||resumeIntent.oldGeneration!==b.backendGen||resumeIntent.newGeneration!==b.backendGen+1
      ||!isDeepStrictEqual(resumeIntent.nativeSession,b.nativeSession)||!isDeepStrictEqual(resumeIntent.launchSelection,b.launchSelection)||resumeIntent.stoppedProof?.complete!==true)throw fault('native_resume_unproved');
    if(!await supportedSelection(b,ports)||b.nativeSession?.kind!=='id'||!UUID.test(b.nativeSession.value??''))throw fault('native_resume_unproved');
    const args=launchArgs(b,ports,b.nativeSession.value);
    if(b.phase==='resume_intent')return outcome(b,'native_resume_uncertain');
    if(typeof ports.verifyStoppedStage!=='function'||typeof ports.admitStageResume!=='function')throw fault('unsupported');
    return await r.guard(b,async()=>{
      if(await ports.verifyStoppedStage({backend:b,resumeIntent})!==true)throw fault('native_resume_unproved');
      const admitted=await ports.admitStageResume({backend:b,resumeIntent});if(admitted?.allowed!==true)throw fault('native_resume_claim_unavailable');
      b.backendGen=resumeIntent.newGeneration;b.phase='resume_intent';delete b.processProof;b.actualAccount=admitted.actualAccount??b.actualAccount??null;b.machineToolPolicy=admitted.machineToolPolicy??null;
      await checkpoint(b,save);
      const response=await command(r,b,['agent','start',b.agentName,'--kind',b.agent,'--pane',b.paneId,'--timeout',String(r.startupMs),'--',...args]);
      const a=await agent(r,b,agentValue(response));remember(b,a);await checkpoint(b,save);
      if(await signInScreen(r,b))return needsSignIn(b);
      if(!ready(await agent(r,b)))return outcome(b,'native_resume_needs_you','blocked');
      b.processProof=await processProof(r,b);b.evidence={readySeq:a.state_change_seq};b.phase='history_resumed';await checkpoint(b,save);return outcome(b,null,'active');
    });
  }catch(e){if(e.code==='herdr_not_found')return stageFailure(b,e,'native_resume_uncertain');return outcome(b,b?.agent==='claude'?'native_resume_needs_you':e.code??'native_resume_uncertain');}
}
