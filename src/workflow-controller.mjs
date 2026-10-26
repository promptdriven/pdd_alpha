// Generated from prompts/cli/workflow-controller.prompt.md (sha256: 0b636adf22f0f6292a0bd351904e9ac5caf0a6c589bfe9f22746dcedbb78d593).
import * as nodeFs from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, isAbsolute, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { withWorkflowLock } from './workflow-claims.mjs';
import { traceHerdrRequest } from './herdr-trace.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NAME=/^(?=.{1,64}$)[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const safePath=p=>typeof p==='string'&&isAbsolute(p)&&!/[\p{Cc}'\\]/u.test(p);
const fsOf=p=>p.fs??nodeFs;
const compositionInputs=new WeakMap();
const herdrRequest=(p,operation,method,request)=>traceHerdrRequest({operation,request},()=>p.herdr[method](request),p);
const result=(state,code=null,controller=null)=>({state,code,controller});
const identityRefusal=intent=>({...result('refused','herdr_identity_unavailable',intent),message:'Herdr process identity is unavailable for the new controller pane. No controller command was sent.'});
function launchKind(launches, spec){
  if(spec.decision&&decisionArgs(spec.decision)&&!launches.some(x=>isDeepStrictEqual(x.decision,spec.decision)))return 'decision';
  return launches.length===0&&!spec.decision?'initial':'recovery';
}
export function controllerLaunchBudget(launches,now){
  const recovery=launches.filter((x,i)=>{
    const kind=x.launchKind??(x.admission===i+1?launchKind(launches.slice(0,i),x):'recovery');
    return kind==='recovery'&&now-x.admittedAt<3600000;
  }).map(x=>x.admittedAt).sort((a,b)=>a-b);
  const resetAt=recovery.length>=3?recovery[recovery.length-3]+3600000:null;
  return {used:recovery.length,resetAt,message:resetAt===null?null:`Controller recovery limit reached (3 unplanned launches per hour). Retry available at ${new Date(resetAt).toISOString()}. Inspect pdd workflow status and pdd doctor; resume the saved run after that time.`};
}
function traceSelector(p){
  try{
    const raw=p.env?.PDD_TRACE??process.env.PDD_TRACE;
    if(typeof raw!=='string')return null;
    const tokens=raw.split(',').map(x=>x.trim());
    return ['herdr','git'].filter(x=>tokens.includes(x)).join(',')||null;
  }catch{return null;}
}
export async function createLocalWorkflowControllerPorts(ports={}){
  const {createWorkflowControllerAuthorityPorts}=await import('./workflow-runner.mjs');
  const authority=createWorkflowControllerAuthorityPorts(ports);
  const needsTransport=(ports.startWorkflowController===undefined&&(ports.herdr===undefined||ports.processStartIdentity===undefined))||ports.observeHerdr===undefined;
  const transport=needsTransport?await (await import('./workflow-herdr-client.mjs')).createWorkflowHerdrPorts(ports):{};
  const validateLocator=async entry=>{
    try{
      const {state}=await authority.readWorkflowJournal({runDir:entry.runDir});
      if(entry.runId!==state.runId||entry.root!==state.root||entry.commonDir!==state.assignment?.commonDir)return false;
      return await authority.validateRun({runId:state.runId,runDir:entry.runDir,root:state.root,
        workflow:state.name,issueNumber:state.issue?.number,runtime:state.runtime},state);
    }catch{return false;}
  };
  const composed={...ports};
  for(const [key,value] of Object.entries({...transport,...authority,validateLocator}))if(composed[key]===undefined)composed[key]=value;
  compositionInputs.set(composed,{input:ports,bindings:[]});
  return composed;
}
async function syncDir(fs,path){const h=await fs.open(path,'r');try{await h.sync();}finally{await h.close();}}
async function save(intent,p){
  const fs=fsOf(p),dir=join(intent.runDir,'controller-launch',intent.launchId);await fs.mkdir(dir,{recursive:true,mode:0o700});
  await syncDir(fs,dirname(dir));await syncDir(fs,dirname(dirname(dir)));
  const h=await fs.open(join(dir,`${String(intent.step).padStart(4,'0')}.json`),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW??0),0o600);
  try{await h.writeFile(JSON.stringify(intent)+'\n');await h.sync();}finally{await h.close();}await syncDir(fs,dir);
}
export async function readControllerLaunches({runDir},ports={}){
  const fs=fsOf(ports),dir=join(runDir,'controller-launch');let names;try{names=await fs.readdir(dir);}catch(e){if(e.code==='ENOENT')return [];throw e;}
  const launches=[];
  for(const name of names.sort()){
    if(!UUID.test(name))throw Error('invalid launch');
    const files=await fs.readdir(join(dir,name));if(!files.length)throw Error('incomplete launch');
    let last,first,step=0;
    for(const file of files.sort()){
      if(!/^\d{4}\.json$/.test(file))throw Error('invalid launch');
      const h=await fs.open(join(dir,name,file),constants.O_RDONLY|(constants.O_NOFOLLOW??0));
      try{const stat=await h.stat();if(!stat.isFile()||stat.nlink!==1||stat.size>256*1024)throw Error('invalid launch');last=JSON.parse(await h.readFile('utf8'));}finally{await h.close();}
      if(last.step!==step++)throw Error('launch sequence invalid');
      if(first&&!isDeepStrictEqual(Object.fromEntries(['runId','runtime','decision','admittedAt','admission','argv','previousGeneration','traceSelector','line','launchKind'].map(k=>[k,first[k]])),Object.fromEntries(['runId','runtime','decision','admittedAt','admission','argv','previousGeneration','traceSelector','line','launchKind'].map(k=>[k,last[k]]))))throw Error('launch binding changed');
      first??=last;
      if(!Number.isSafeInteger(last.admission)||last.admission<1||last.runDir!==runDir||last.launchId!==name||last.step!==Number(file.slice(0,4))||!Number.isFinite(last.admittedAt))throw Error('invalid launch');
    }
    launches.push(last);
  }
  launches.sort((a,b)=>a.admission-b.admission);
  if(launches.some((l,i)=>l.admission!==i+1))throw Error('launch admissions invalid');
  for(let i=0;i<launches.length;i++)if(launches[i].launchKind!==undefined&&launches[i].launchKind!==launchKind(launches.slice(0,i),launches[i]))throw Error('launch kind invalid');
  return launches;
}
function decisionArgs(d){
  if(d===null)return [];
  if(!d||Object.keys(d).some(k=>!['decision','id','rev','expectStage','expectSeq'].includes(k))||!['approve','skip'].includes(d.decision)||!UUID.test(d.id??'')||!Number.isSafeInteger(d.rev)||d.rev<1)return null;
  const args=['--decision',d.decision,'--id',d.id,'--rev',String(d.rev)];
  if(d.expectStage!=null||d.expectSeq!=null){if(!NAME.test(d.expectStage??'')||!Number.isSafeInteger(d.expectSeq)||d.expectSeq<1)return null;args.push('--expect-stage',d.expectStage,'--expect-seq',String(d.expectSeq));}return args;
}
async function strictRead(runDir,p){
  if(typeof p.readWorkflowJournal!=='function')throw Object.assign(Error('unsupported'),{code:'unsupported'});
  const j=await p.readWorkflowJournal({runDir});if(!j?.state||!Number.isSafeInteger(j.seq))throw Error('journal_invalid');return j;
}
function admission(state,spec){
  if(state.runId!==spec.runId||state.archived||state.removing||['completed','failed','unknown','question_lost'].includes(state.controlState)||!['running','waiting_agent','quota_wait','WAIT','waiting_person'].includes(state.controlState))return 'run_not_startable';
  if(spec.decision){if(state.rev!==spec.decision.rev)return 'stale_decision';if(state.controlState!=='waiting_person')return 'run_not_waiting';if(!state.waitingPerson?.decisions?.includes(spec.decision.decision))return 'decision_refused';}
  else if(state.controlState==='waiting_person')return 'human_wait';
  if(state.runtime&&!isDeepStrictEqual(state.runtime,spec.runtime))return 'runtime_mismatch';
  return null;
}
const pendingProof=(intent,code='process_unproved')=>({...result('uncertain',code,intent),message:`Workflow controller may be running; check pdd workflow status ${intent.runId}.`});
async function prove(intent,p){
  if(!intent.paneId)return pendingProof(intent,'launch_uncertain');
  const now=p.controllerProofNow??(()=>performance.now()),sleep=p.controllerProofSleep??(ms=>new Promise(resolve=>setTimeout(resolve,ms)));
  const deadline=now()+15000;let pending=pendingProof(intent);
  for(let sample=0;sample<=150;sample++){
    if(now()>deadline)return pending;
    const remaining=Math.max(0,deadline-now());let timer;
    // Bound read-only observations too: a stalled transport must not turn a 15s
    // proof wait into an unbounded command. A late read cannot save a proof.
    const reads=await Promise.race([
      Promise.allSettled([herdrRequest(p,'pane.process_info','processInfo',{session:'default',paneId:intent.paneId}),strictRead(intent.runDir,p)]),
      new Promise(resolve=>{timer=setTimeout(()=>resolve(null),remaining);})
    ]).finally(()=>clearTimeout(timer));
    if(!reads||now()>deadline)return pending;
    const [processRead,journalRead]=reads;
    if(processRead.status==='rejected'&&processRead.reason?.code==='herdr_not_found')return {...result('uncertain','herdr_not_found',intent),message:processRead.reason.message};
    const process=processRead.status==='fulfilled'?processRead.value:null,journal=journalRead.status==='fulfilled'?journalRead.value:null;
    const proof=journal?.state.controller;
    const bound=journal?.state.runId===intent.runId&&proof?.started===true&&proof.launchId===intent.launchId&&proof.paneId===intent.paneId&&Number.isSafeInteger(proof.generation)&&proof.generation>0&&proof.generation===(intent.previousGeneration??0)+1&&Number.isSafeInteger(proof.pid)&&proof.pid>0&&typeof proof.startIdentity==='string'&&proof.startIdentity.length>0;
    const live=bound&&process?.stopped!==true&&process?.pid===proof.pid&&process.startIdentity===proof.startIdentity&&process.paneId===intent.paneId&&process.executable===intent.runtime.node&&isDeepStrictEqual(process.argv,intent.argv);
    if(bound&&intent.proof&&!isDeepStrictEqual(intent.proof.controller,proof))return pendingProof(intent,'proof_conflict');
    if(live){
      if(intent.proof&&!isDeepStrictEqual(intent.proof.process,process))return pendingProof(intent,'proof_conflict');
      if(now()>deadline)return pending;
      intent={...intent,phase:'proved',step:intent.step+1,proof:{process,controller:proof,journalSeq:journal.seq}};
      try{await save(intent,p);}catch{return pendingProof(intent,'proof_not_durable');}
      return result('started',null,{herdrSession:'default',...proof,workspaceId:intent.workspaceId,tabId:intent.tabId,terminalId:intent.terminalId});
    }
    const stopped=process?.stopped===true&&process.pid===proof?.pid&&process.startIdentity===proof?.startIdentity&&process.paneId===intent.paneId;
    const humanWait=journal?.state.controlState==='waiting_person';
    let exitEvidence;
    if(bound&&!stopped&&!humanWait&&typeof p.herdr.inspectProcessExit==='function'){
      let exitTimer;
      const observed=await Promise.race([
        Promise.resolve().then(()=>p.herdr.inspectProcessExit({session:'default',paneId:intent.paneId,pid:proof.pid,startIdentity:proof.startIdentity})).then(value=>({value}),error=>({error})),
        new Promise(resolve=>{exitTimer=setTimeout(()=>resolve(null),Math.max(0,deadline-now()));})
      ]).finally(()=>clearTimeout(exitTimer));
      if(!observed||now()>deadline)return pending;
      if(observed.error?.code==='herdr_not_found')return {...result('uncertain','herdr_not_found',intent),message:observed.error.message};
      const value=observed.value;
      if(value?.exited===true&&value.pid===proof.pid&&value.startIdentity===proof.startIdentity&&value.paneId===intent.paneId&&['pid_gone','identity_changed','pane_shell'].includes(value.reason))exitEvidence=value;
    }
    const exited=stopped||exitEvidence!==undefined;
    let lifetimeLock;
    if(bound&&(exited||humanWait)){
      let lockTimer;
      lifetimeLock=await Promise.race([
        Promise.resolve().then(()=>p.inspectControllerLock(intent)).catch(()=> 'unknown'),
        new Promise(resolve=>{lockTimer=setTimeout(()=>resolve('unknown'),Math.max(0,deadline-now()));})
      ]).finally(()=>clearTimeout(lockTimer));
      if(now()>deadline)return pending;
    }
    if(bound&&(exited||humanWait)&&lifetimeLock==='free'){
      if(now()>deadline)return pending;
      intent={...intent,phase:'exited',step:intent.step+1,exitedProof:{process,controller:proof,journalSeq:journal.seq,humanWait,...(exitEvidence?{exitEvidence}:{})}};
      try{await save(intent,p);}catch{return pendingProof(intent,'proof_not_durable');}
      return result('uncertain','controller_exited',intent);
    }
    pending=pendingProof(intent,journalRead.status==='rejected'||processRead.status==='rejected'?'proof_unavailable':'process_unproved');
    const left=deadline-now();if(left<=0||sample===150)return pending;
    await sleep(Math.min(100,left));
  }
  return pending;
}
export async function startWorkflowController(spec,ports={}){
  const input=spec??{};
  spec=Object.fromEntries(['runId','runDir','root','workflow','issueNumber','runtime'].map(k=>[k,input[k]]));
  spec.decision=input.decision??null;
  let args=decisionArgs(spec.decision);
  if(!UUID.test(spec.runId??'')||!safePath(spec.runDir)||!safePath(spec.root)||!safePath(spec.runtime?.node)||!safePath(spec.runtime?.bin)||!NAME.test(spec.workflow??'')||!Number.isSafeInteger(spec.issueNumber)||spec.issueNumber<1||!args)return result('refused','unsupported');
  const composition=compositionInputs.get(ports);
  if(composition&&!isDeepStrictEqual(ports.runtime,spec.runtime)){
    let bound=composition.bindings.find(item=>isDeepStrictEqual(item.runtime,spec.runtime));
    if(!bound){bound={runtime:structuredClone(spec.runtime),ports:await createLocalWorkflowControllerPorts({...composition.input,runtime:spec.runtime})};composition.bindings.push(bound);}
    ports=bound.ports;
  }
  // Check interfaces before admission; actual OS evidence belongs to the new pane.
  if(!['supportsProcessIdentity','listWorkspaces','createWorkspace','createTab','paneRun','processInfo'].every(name=>typeof ports.herdr?.[name]==='function')||!ports.withLifecycleGuard||!ports.readWorkflowJournal||!ports.validateRun||!ports.inspectControllerLock)return result('refused','unsupported');
  try{return await withWorkflowLock({path:join(spec.runDir,'controller-start.lock'),busyCode:'controller_busy'},async()=>{
    let launches;try{launches=await readControllerLaunches(spec,ports);}catch{return result('uncertain','launch_history_invalid');}
    let prior=launches.at(-1);
    if(prior && prior.phase!=='exited'){
      if(prior.runId!==spec.runId||prior.root!==spec.root||!isDeepStrictEqual(prior.runtime,spec.runtime))return result('refused','launch_binding_conflict',prior);
      if(prior.phase==='herdr.identity_unavailable')return identityRefusal(prior);
      const reconciled=await prove(prior,ports),sameDecision=isDeepStrictEqual(prior.decision,spec.decision);
      const recoveredExit=reconciled.controller?.exitedProof?.exitEvidence&&!reconciled.controller.exitedProof.humanWait;
      if(reconciled.code!=='controller_exited'||sameDecision&&!recoveredExit)return !sameDecision&&reconciled.state==='started'?result('refused','controller_busy',reconciled.controller):reconciled;
      // The prior proof is now durably exited. A new decision still passes all
      // existing current-state, assignment, revision and lifetime-lock checks.
      prior=reconciled.controller;
      if(sameDecision&&recoveredExit){spec={...spec,decision:null};args=[];}
    }
    let intent;
    const admitted=await ports.withLifecycleGuard(spec,async()=>{
      const {state}=await strictRead(spec.runDir,ports),code=admission(state,spec);if(code)return result('refused',code);
      if(ports.validateRun && await ports.validateRun(spec,state)!==true)return result('refused','assignment_invalid');
      if(ports.inspectControllerLock && await ports.inspectControllerLock(spec)!=='free')return result('refused','controller_busy');
      const now=ports.now?.()??Date.now(),kind=launchKind(launches,spec),budget=controllerLaunchBudget(launches,now);
      if(kind==='recovery'&&budget.used>=3)return {...result('refused','launch_budget'),resetAt:budget.resetAt,message:budget.message};
      const launchId=randomUUID(),argv=[spec.runtime.node,spec.runtime.bin,'workflow','drive',spec.runId,'--launch-id',launchId,...args];
      const selector=traceSelector(ports),line=(selector?`PDD_TRACE='${selector}' `:'')+argv.map(x=>`'${x}'`).join(' ');
      intent={...spec,launchId,launchKind:kind,argv,line,...(selector?{traceSelector:selector}:{}),phase:'admitted',step:0,admission:launches.length+1,admittedAt:now,previousGeneration:state.controller?.generation??0};
      await save(intent,ports);return null;
    });if(admitted)return admitted;
    let effected=false;
    const checkpoint=async(phase,extra={})=>{intent={...intent,...extra,phase,step:intent.step+1};await save(intent,ports);};
    try{
      const workspaces=await herdrRequest(ports,'workspace.list','listWorkspaces',{session:'default'});
      if(!Array.isArray(workspaces)||workspaces.some(w=>typeof w?.workspaceId!=='string'||!w.workspaceId)||new Set(workspaces.map(w=>w.workspaceId)).size!==workspaces.length)return result('uncertain','workspace_unknown',intent);
      const sameRun=prior?.phase==='exited'&&prior.runId===spec.runId&&prior.root===spec.root&&isDeepStrictEqual(prior.runtime,spec.runtime);
      let workspace=(sameRun&&workspaces.find(w=>w.workspaceId===prior.workspaceId&&(w.cwd==null||w.cwd===spec.root)))||workspaces.find(w=>w.cwd===spec.root);
      if(!workspace){await checkpoint('workspace.create.intent');effected=true;workspace=await herdrRequest(ports,'workspace.create','createWorkspace',{session:'default',cwd:spec.root,focus:false});if(!workspace?.workspaceId)return result(workspace?.refused?'failed':'uncertain','workspace_create_failed',intent);await checkpoint('workspace.created',{workspaceId:workspace.workspaceId,workspaceCreation:workspace});}
      else await checkpoint('workspace.selected',{workspaceId:workspace.workspaceId});
      await checkpoint('tab.create.intent');effected=true;
      const tab=await herdrRequest(ports,'tab.create','createTab',{session:'default',workspaceId:intent.workspaceId,cwd:spec.root,label:`run #${spec.issueNumber} ${spec.workflow}`,focus:false});
      if(!tab?.tabId||!tab.paneId||!tab.terminalId)return result(tab?.refused?'failed':'uncertain','tab_create_failed',intent);
      await checkpoint('tab.created',{tabId:tab.tabId,paneId:tab.paneId,terminalId:tab.terminalId});
      let supported=false;
      try{supported=await ports.herdr.supportsProcessIdentity({session:'default',paneId:intent.paneId})===true;}catch(error){if(error?.code==='herdr_not_found')throw error;}
      if(!supported){await checkpoint('herdr.identity_unavailable');return identityRefusal(intent);}
      await checkpoint('pane.run.intent');
      try{await herdrRequest(ports,'pane.run','paneRun',{session:'default',paneId:intent.paneId,command:intent.line});}catch{/* Unknown delivery must be reconciled, never repeated. */}
      return prove(intent,ports);
    }catch(error){return error?.code==='herdr_not_found'?{...result(effected?'uncertain':'refused',error.code,intent),message:error.message}:result(effected?'uncertain':'failed','launch_io',intent);}
  },ports);}catch(e){return result(e.code==='controller_busy'?'refused':'failed',e.code??'launch_io');}
}
