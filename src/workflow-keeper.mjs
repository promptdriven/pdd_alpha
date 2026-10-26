// Generated from prompts/cli/workflow-keeper.prompt.md (sha256: 073a599ddf97dee35cc0b277735ddb7327d89a32fa9e9d27fd365294c06f4bbb).
import * as nodeFs from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { isDeepStrictEqual } from 'node:util';
import { withWorkflowLock, inspectWorkflowLock, claimWorkflowSession } from './workflow-claims.mjs';
import { startWorkflowController, controllerLaunchBudget, readControllerLaunches, createLocalWorkflowControllerPorts } from './workflow-controller.mjs';
import { checkWorkflowRuntime } from './workflow-runtime.mjs';
import { readRunIndex } from './workflow-run-records.mjs';
import {appendKeeperDecision} from './workflow-keeper-log.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const observations=new Map();
const compositions=new WeakMap();
const fsOf=p=>p.fs??nodeFs;
const eligible=s=>['running','waiting_agent','quota_wait','WAIT'].includes(s?.controlState)&&s.adopted!==false&&!s.archived&&!s.removing&&!s.waitingPerson&&!s.blockedQuestion&&s.pending?.backend?.agentStatus!=='blocked';
const fleetRequired=()=>Object.assign(Error('This recovery operation is unavailable: this needs the fleet client.'),{code:'fleet_client_required'});
const unavailable=async()=>{throw fleetRequired();};
const invalidRestoreProvider=()=>({state:'refused',code:'unsupported',message:'Managed restore requires callable recovery providers.'});
const controllerMessage=seen=>['herdr_not_found','launch_budget'].includes(seen.code)&&typeof seen.message==='string'?{message:seen.message,...(seen.code==='launch_budget'&&Number.isFinite(seen.resetAt)?{resetAt:seen.resetAt}:{})}:{};
const controllerState=seen=>seen.code==='launch_budget'&&seen.state==='refused'?'needs_you':seen.state;
export async function createWorkflowKeeperPorts(ports={}){
  const local=await createLocalWorkflowControllerPorts(ports);
  const defaults={
    observeQuota:async()=>({fresh:false,room:false,code:'fleet_client_required',message:fleetRequired().message}),
    readManagedLaunch:unavailable,validateManagedRuntime:unavailable,validateManagedFlags:unavailable,
    validateOwner:unavailable,restoreNative:unavailable,
    accountAdapter:{reconcileRestore:unavailable},
    warn:message=>{try{(ports.stderr??process.stderr).write(`${message}\n`);}catch{}}
  };
  for(const [key,value] of Object.entries(defaults))if(local[key]===undefined)local[key]=value;
  compositions.set(local,{input:ports,runs:new Map()});
  return local;
}
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
  const results=[],memo=ports.observations??observations,passPorts=ports;
  for(const entry of entries??[]){
    let ports=passPorts,journalSeq=null,controller='unknown',decision;
    const finish=(state,code,extra={})=>{decision={runId:entry?.runId??null,state,code,...extra};if(state==='started')controller='started';results.push(decision);};
    try{
      if(entry?.recoveryRegistry==='missing_or_invalid'){finish('stopped','registry_missing_or_invalid');continue;}
      if(!UUID.test(entry?.runId??'')||!isAbsolute(entry.runDir??'')||typeof ports.validateLocator!=='function'||await ports.validateLocator(entry)!==true){finish('stopped','locator_invalid');continue;}
      if(!ports.readWorkflowJournal){finish('stopped','unsupported');continue;}
      const journal=await ports.readWorkflowJournal({runDir:entry.runDir}),s=journal?.state;journalSeq=journal?.seq??s?.seq??null;
      if(s?.runId!==entry.runId||!eligible(s)){memo.delete(entry.runId);finish('stopped','ineligible');continue;}
      if(s.controlState==='WAIT'){
        if(!Number.isFinite(s.quota?.until)||now<s.quota.until){finish('WAIT','renewal_not_due');continue;}
        let q;try{q=await ports.observeQuota?.({entry,state:s});}catch{}
        if(q?.fresh!==true||q?.room!==true){
          const conditional=q?.code==='fleet_client_required';
          finish('WAIT',conditional?'fleet_client_required':'observation_pending',{
            retryObservation:true,...(conditional?{message:fleetRequired().message}:{})});continue;
        }
      }
      const composition=compositions.get(passPorts);
      if(composition){
        let saved=composition.runs.get(entry.runId);
        if(!saved||!isDeepStrictEqual(saved.runtime,s.runtime)){
          saved={runtime:structuredClone(s.runtime),ports:await createLocalWorkflowControllerPorts({...composition.input,runtime:s.runtime})};
          composition.runs.set(entry.runId,saved);
        }
        ports={...passPorts,...saved.ports};
      }
      const herdr=await ports.observeHerdr?.();
      if(herdr?.code==='herdr_not_found'){memo.delete(entry.runId);finish('needs_you',herdr.code,{message:herdr.message,...(herdr.reason==='server_absent'?{reason:herdr.reason}:{})});continue;}
      const first=memo.get(entry.runId);
      const serverKnown=Number.isSafeInteger(herdr?.server?.pid)&&herdr.server.pid>0&&typeof herdr.server.startIdentity==='string'&&herdr.server.startIdentity.length>0;
      const sameObservation=first&&first.runDir===entry.runDir&&first.upSince===herdr?.upSince&&first.at<=now&&isDeepStrictEqual(first.server,herdr?.server);
      const inspect=ports.inspectWorkflowLock??((spec)=>inspectWorkflowLock(spec,ports));
      if(!herdr?.complete||!Number.isFinite(herdr.upSince)||!Number.isFinite(herdr.stableSince)||now-herdr.upSince<30000||now-herdr.stableSince<30000||Object.hasOwn(herdr,'server')&&!serverKnown){
        if(!(herdr?.complete&&serverKnown&&sameObservation&&Number.isFinite(herdr.upSince)&&Number.isFinite(herdr.stableSince)&&herdr.upSince<=now&&herdr.stableSince<=now))memo.delete(entry.runId);
        else{
          const lock=await inspect({path:join(entry.runDir,'controller.lock')});controller=lock==='free'?'absent':lock==='held'?'held':'unknown';
          if(lock!=='free')memo.delete(entry.runId);
        }
        finish('stopped','herdr_unsettled');continue;
      }
      const lock=await inspect({path:join(entry.runDir,'controller.lock')});controller=lock==='free'?'absent':lock==='held'?'held':'unknown';
      if(lock!=='free'){memo.delete(entry.runId);finish('stopped',lock==='held'?'controller_busy':'lock_unknown');continue;}
      if(!sameObservation){memo.set(entry.runId,{at:now,runDir:entry.runDir,upSince:herdr.upSince,...(serverKnown?{server:{...herdr.server}}:{})});finish('stopped','observing_lock');continue;}
      if(now-first.at<30000){finish('stopped','observing_lock');continue;}
      const launches=await (ports.readControllerLaunches??(spec=>readControllerLaunches(spec,ports)))({runDir:entry.runDir});
      const prior=launches.at(-1);
      const runtime=await (ports.checkWorkflowRuntime??(spec=>checkWorkflowRuntime(spec,ports)))({runDir:entry.runDir});
      if(!runtime.ok){finish('needs_you',runtime.code,runtime.message?{message:runtime.message}:{});continue;}
      if(prior&&prior.phase!=='exited'){
        controller='unknown';
        const seen=await (ports.startWorkflowController??(spec=>startWorkflowController(spec,ports)))({runId:s.runId,runDir:entry.runDir,root:s.root??entry.root,workflow:s.name,issueNumber:s.issue?.number,runtime:s.runtime,decision:prior.decision});
        finish(controllerState(seen),seen.code,{...controllerMessage(seen),inspectOriginal:true});continue;
      }
      const budget=controllerLaunchBudget(launches,now);
      if(budget.used>=3){finish('needs_you','launch_budget',{resetAt:budget.resetAt,message:budget.message});continue;}
      // Launcher performs a fresh strict read and lock recheck under its admission gate.
      controller='unknown';
      const seen=await (ports.startWorkflowController??(spec=>startWorkflowController(spec,ports)))({runId:s.runId,runDir:entry.runDir,root:s.root??entry.root,workflow:s.name,issueNumber:s.issue?.number,runtime:s.runtime});
      memo.delete(entry.runId);finish(controllerState(seen),seen.code,controllerMessage(seen));
    }catch(error){memo.delete(entry?.runId);if(error?.code==='herdr_not_found')finish('needs_you',error.code,{message:error.message});else finish('stopped','recovery_inspection_failed');}
    finally{
      if(decision)try{await (passPorts.appendKeeperDecision??appendKeeperDecision)({runId:UUID.test(entry?.runId??'')?entry.runId:null,decision:decision.state,code:decision.code??null,at:now,journalSeq,controller,...(decision.reason?{reason:decision.reason}:{}),...(decision.resetAt!==undefined?{resetAt:decision.resetAt}:{})},passPorts);}catch{/* Diagnostic failure cannot change recovery. */}
    }
  }
  return results;
}
function wait(ms,signal){return new Promise(r=>{if(signal.aborted)return r();const done=()=>{clearTimeout(t);signal.removeEventListener('abort',done);r();};const t=setTimeout(done,ms);signal.addEventListener('abort',done,{once:true});});}
export async function runWorkflowKeeper({home=homedir()},ports={}){
  const abort=new AbortController(),signal=ports.signal??abort.signal,stop=()=>abort.abort();
  if(!ports.signal){process.on('SIGTERM',stop);process.on('SIGINT',stop);}
  try{return await withWorkflowLock({path:join(home,'.pdd','runs','keeper.lock'),busyCode:'keeper_busy'},async()=>{
    const local=await createWorkflowKeeperPorts({...ports,home});
    // Await each pass before scheduling: slow discovery can never overlap itself.
    while(!signal.aborted){
      try{
        const found=await discoverWorkflowRuns({home},local);for(const warning of found.warnings)local.warn?.(warning);
        const results=await reconcileWorkflowControllers({entries:found.entries,now:local.now?.()??Date.now()},local);
        for(const row of results)if(row.code==='fleet_client_required')local.warn?.(fleetRequired().message);else if(['herdr_not_found','launch_budget'].includes(row.code))local.warn?.(row.message);
      }
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
    ports=await createWorkflowKeeperPorts(ports);
    if(typeof ports.readManagedLaunch!=='function')return invalidRestoreProvider();
    const record=await ports.readManagedLaunch?.({launchId});
    if(!record||record.launchId!==launchId||record.generation!==generation||record.retired||record.successor)return {state:'retired'};
    if(record.owner?.runId)return {state:'refused',code:'controller_owns_restore'};
    if(['validateManagedRuntime','validateManagedFlags','validateOwner','restoreNative'].some(key=>typeof ports[key]!=='function'))return invalidRestoreProvider();
    if(!record.runtime||!record.flags||await ports.validateManagedRuntime?.(record)!==true||await ports.validateManagedFlags?.(record.flags,record)!==true)return {state:'refused',code:'runtime_missing'};
    if(record.managedAccount){if(typeof ports.accountAdapter?.reconcileRestore!=='function')return invalidRestoreProvider();const a=await ports.accountAdapter.reconcileRestore(record);if(a?.ready!==true)return {state:'stopped',code:a?.code??'policy_pending'};}
    if(ports.validateOwner===unavailable||ports.restoreNative===unavailable)throw fleetRequired();
    const claim=await claimWorkflowSession({kind:record.kind,nativeSessionId:record.nativeSessionId,owner:{launchId,generation}},ports);
    if(claim.state!=='owned')return claim;
    try{return await ports.restoreNative(record,claim);}catch{await claim.release();return {state:'uncertain'};}
  }catch(e){return e?.code==='fleet_client_required'?{state:'refused',code:'fleet_client_required',message:fleetRequired().message}:{state:'uncertain'};}
}
