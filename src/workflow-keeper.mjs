// Generated from prompts/cli/workflow-keeper.prompt.md (sha256: 381fbea5d0afb83da8c58e524dfa981b40cb1ff82693ea5ea56ce47f55da08cd).
import * as nodeFs from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { withWorkflowLock, inspectWorkflowLock, claimWorkflowSession } from './workflow-claims.mjs';
import { startWorkflowController, readControllerLaunches } from './workflow-controller.mjs';
import { checkWorkflowRuntime } from './workflow-runtime.mjs';
import { readRunIndex } from './workflow-run-records.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const observations=new Map();
const fsOf=p=>p.fs??nodeFs;
const eligible=s=>['running','waiting_agent','quota_wait','WAIT'].includes(s?.controlState)&&s.adopted!==false&&!s.archived&&!s.removing&&!s.waitingPerson&&!s.blockedQuestion&&s.pending?.backend?.agentStatus!=='blocked';
export async function discoverWorkflowRuns({home},ports={}){
  const fs=fsOf(ports),warnings=[],registry=new Map();let names=[];
  try{names=await fs.readdir(join(home,'.pdd','runs','registry'));}catch(e){warnings.push(e.code==='ENOENT'?'registry_missing':'registry_unreadable');}
  for(const name of names.sort()){
    try{
      if(!UUID.test(name.replace(/\.json$/,''))||!name.endsWith('.json'))throw Error();
      const path=join(home,'.pdd','runs','registry',name),stat=await fs.lstat(path);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>65536)throw Error();
      const e=JSON.parse(await fs.readFile(path,'utf8'));
      if(e.v!==1||`${e.runId}.json`!==name||!['root','runDir','commonDir'].every(k=>isAbsolute(e[k]??'')))throw Error();
      registry.set(e.runId,e);
    }catch{warnings.push(`registry_invalid:${name}`);}
  }
  const index=await readRunIndex({...ports,home});if(index.dropped)warnings.push('index_dropped');
  for(const e of index.entries)if(!registry.has(e.runId)){registry.set(e.runId,{...e,recoveryRegistry:'missing_or_invalid'});warnings.push(`registry_missing_or_invalid:${e.runId}`);}
  return {entries:[...registry.values()],warnings};
}
export async function reconcileWorkflowControllers({entries,now},ports={}){
  const results=[],memo=ports.observations??observations;
  for(const entry of entries??[]){
    const finish=(state,code,extra={})=>results.push({runId:entry?.runId??null,state,code,...extra});
    try{
      if(entry?.recoveryRegistry==='missing_or_invalid'){finish('stopped','registry_missing_or_invalid');continue;}
      if(!UUID.test(entry?.runId??'')||!isAbsolute(entry.runDir??'')||typeof ports.validateLocator!=='function'||await ports.validateLocator(entry)!==true){finish('stopped','locator_invalid');continue;}
      if(!ports.readWorkflowJournal){finish('stopped','unsupported');continue;}
      const journal=await ports.readWorkflowJournal({runDir:entry.runDir}),s=journal?.state;
      if(s?.runId!==entry.runId||!eligible(s)){memo.delete(entry.runId);finish('stopped','ineligible');continue;}
      if(s.controlState==='WAIT'){
        if(!Number.isFinite(s.quota?.until)||now<s.quota.until){finish('WAIT','renewal_not_due');continue;}
        let q;try{q=await ports.observeQuota?.({entry,state:s});}catch{}
        if(q?.fresh!==true||q?.room!==true){finish('WAIT','observation_pending',{retryObservation:true});continue;}
      }
      const herdr=await ports.observeHerdr?.();
      if(!herdr?.complete||!Number.isFinite(herdr.upSince)||!Number.isFinite(herdr.stableSince)||now-herdr.upSince<30000||now-herdr.stableSince<5000){memo.delete(entry.runId);finish('stopped','herdr_unsettled');continue;}
      const inspect=ports.inspectWorkflowLock??((spec)=>inspectWorkflowLock(spec,ports));
      const lock=await inspect({path:join(entry.runDir,'controller.lock')});
      if(lock!=='free'){memo.delete(entry.runId);finish('stopped',lock==='held'?'controller_busy':'lock_unknown');continue;}
      const first=memo.get(entry.runId);
      if(!first||first.runDir!==entry.runDir||first.upSince!==herdr.upSince||first.at>now){memo.set(entry.runId,{at:now,runDir:entry.runDir,upSince:herdr.upSince});finish('stopped','observing_lock');continue;}
      if(now-first.at<30000){finish('stopped','observing_lock');continue;}
      const launches=await (ports.readControllerLaunches??(spec=>readControllerLaunches(spec,ports)))({runDir:entry.runDir});
      const prior=launches.at(-1);
      const runtime=await (ports.checkWorkflowRuntime??(spec=>checkWorkflowRuntime(spec,ports)))({runDir:entry.runDir});
      if(!runtime.ok){finish('needs_you',runtime.code);continue;}
      if(prior&&prior.phase!=='exited'){
        const seen=await (ports.startWorkflowController??(spec=>startWorkflowController(spec,ports)))({runId:s.runId,runDir:entry.runDir,root:s.root??entry.root,workflow:s.name,issueNumber:s.issue?.number,runtime:s.runtime,decision:prior.decision});
        finish(seen.state,seen.code,{inspectOriginal:true});continue;
      }
      if(launches.filter(l=>now-l.admittedAt<3600000).length>=3){finish('needs_you','launch_budget');continue;}
      // Launcher performs a fresh strict read and lock recheck under its admission gate.
      const seen=await (ports.startWorkflowController??(spec=>startWorkflowController(spec,ports)))({runId:s.runId,runDir:entry.runDir,root:s.root??entry.root,workflow:s.name,issueNumber:s.issue?.number,runtime:s.runtime});
      memo.delete(entry.runId);finish(seen.state,seen.code);
    }catch{memo.delete(entry?.runId);finish('stopped','recovery_inspection_failed');}
  }
  return results;
}
function wait(ms,signal){return new Promise(r=>{if(signal.aborted)return r();const done=()=>{clearTimeout(t);signal.removeEventListener('abort',done);r();};const t=setTimeout(done,ms);signal.addEventListener('abort',done,{once:true});});}
export async function runWorkflowKeeper({home=homedir()},ports={}){
  const abort=new AbortController(),signal=ports.signal??abort.signal,stop=()=>abort.abort();
  if(!ports.signal){process.on('SIGTERM',stop);process.on('SIGINT',stop);}
  try{return await withWorkflowLock({path:join(home,'.pdd','runs','keeper.lock'),busyCode:'keeper_busy'},async()=>{
    // Await each pass before scheduling: slow discovery can never overlap itself.
    while(!signal.aborted){
      try{const found=await discoverWorkflowRuns({home},ports);for(const warning of found.warnings)ports.warn?.(warning);await reconcileWorkflowControllers({entries:found.entries,now:ports.now?.()??Date.now()},ports);}
      catch{ports.warn?.('recovery_pass_failed');}
      if(!signal.aborted)await (ports.wait??wait)(30000,signal);
    }
    return {state:'stopped',exitCode:0};
  },ports);}catch(e){return {state:e.code==='keeper_busy'?'busy':'unsupported',exitCode:1,code:e.code??'unsupported'};}
  finally{if(!ports.signal){process.off('SIGTERM',stop);process.off('SIGINT',stop);}}
}
// Generic restore refuses stage and retired records before any native effect. Account
// policy, when applicable, is reconciled by its adapter rather than selected here.
export async function restoreManagedWorkflowSession({launchId,generation},ports={}){
  if(!launchId)return {state:'unmanaged'};
  if(!UUID.test(launchId)||!Number.isSafeInteger(generation)||generation<1)return {state:'refused',code:'unsupported'};
  try{
    const record=await ports.readManagedLaunch?.({launchId});
    if(!record||record.launchId!==launchId||record.generation!==generation||record.retired||record.successor)return {state:'retired'};
    if(record.owner?.runId)return {state:'refused',code:'controller_owns_restore'};
    if(!record.runtime||!record.flags||await ports.validateManagedRuntime?.(record)!==true||await ports.validateManagedFlags?.(record.flags,record)!==true)return {state:'refused',code:'runtime_missing'};
    if(record.managedAccount){if(!ports.accountAdapter)return {state:'refused',code:'unsupported'};const a=await ports.accountAdapter.reconcileRestore(record);if(a?.ready!==true)return {state:'stopped',code:a?.code??'policy_pending'};}
    const claim=await claimWorkflowSession({kind:record.kind,nativeSessionId:record.nativeSessionId,owner:{launchId,generation}},ports);
    if(claim.state!=='owned')return claim;
    try{return await ports.restoreNative(record,claim);}catch{await claim.release();return {state:'uncertain'};}
  }catch{return {state:'uncertain'};}
}
