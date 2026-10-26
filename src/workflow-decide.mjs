// Generated from prompts/cli/workflow-decide.prompt.md (sha256: fd0878fb410534ff4834ea77c75ebbbb4fda43015827a32c58828b4dc749f3cd).
import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {lookupIssueWorktree} from './workflow-worktree.mjs';
import {readWorkflowJournal,isControllerLive} from './workflow-runner.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const STAGE=/^(?=.{1,64}$)[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const positive=n=>Number.isSafeInteger(n)&&n>0;
function valid(i) {
  const pair=i.expectStage!==undefined||i.expectSeq!==undefined;
  return UUID.test(i.runId??'')&&UUID.test(i.decisionId??'')&&['approve','skip'].includes(i.decision)
    && (i.expectedRev!==undefined||pair) && (i.expectedRev===undefined||positive(i.expectedRev))
    && (!pair||STAGE.test(i.expectStage??'')&&positive(i.expectSeq));
}
function provedLaunch(value){
  const c=value?.controller;
  return value?.state==='started'&&c?.herdrSession==='default'&&['workspaceId','tabId','paneId','startIdentity'].every(k=>typeof c[k]==='string'&&c[k].length>0)
    &&c.started===true&&UUID.test(c.launchId??'')&&positive(c.generation)&&positive(c.pid);
}
const expectOf=i=>({rev:i.expectedRev??null,stage:i.expectStage??null,seq:i.expectSeq??null});
async function syncDir(path) {const h=await fs.open(path,'r');try{await h.sync();}finally{await h.close();}}
async function safeDirectory(path) {if(await fs.realpath(path)!==path||!(await fs.lstat(path)).isDirectory())throw Error('unsafe_metadata');}
async function readIntent(runDir,id) {
  const dir=join(runDir,'decide'),path=join(dir,`${id}.json`);
  try {
    await safeDirectory(runDir);await safeDirectory(dir);const s=await fs.lstat(path);if(!s.isFile()||s.nlink!==1||await fs.realpath(path)!==path)throw Error('unsafe_intent');
    const h=await fs.open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const opened=await h.stat();if(opened.ino!==s.ino||opened.dev!==s.dev||opened.nlink!==1)throw Error('unsafe_intent');const raw=await h.readFile('utf8');const after=await h.stat();if(after.size!==opened.size||after.mtimeMs!==opened.mtimeMs||after.ctimeMs!==opened.ctimeMs)throw Error('changed_intent');return {value:JSON.parse(raw)};}finally{await h.close();}
  } catch(e) {return e.code==='ENOENT'?null:{unreadable:true};}
}
async function writeIntent(runDir,id,value,initial=false) {
  await safeDirectory(runDir);const dir=join(runDir,'decide');try{await fs.mkdir(dir,{mode:0o700});await syncDir(runDir);}catch(e){if(e.code!=='EEXIST')throw e;}
  await safeDirectory(dir);const path=join(dir,`${id}.json`),target=initial?path:join(dir,`.${id}.${randomUUID()}.tmp`);
  const h=await fs.open(target,'wx',0o600);try{await h.writeFile(JSON.stringify(value)+'\n');await h.sync();}finally{await h.close();}
  if(!initial)await fs.rename(target,path);await syncDir(dir);
}
export async function decideWorkflow(input,ports={}) {
  const i=structuredClone(input??{});let stage=null,journalSeq=null;
  const answer=(state,code=null,controller=null)=>({exitCode:['recorded','started'].includes(state)?0:code==='bad_args'?2:1,state,code,
    runId:UUID.test(i.runId??'')?i.runId:null,decisionId:UUID.test(i.decisionId??'')?i.decisionId:null,decision:['approve','skip'].includes(i.decision)?i.decision:null,
    stage,journalSeq,controller,message:`${state}: run ${UUID.test(i.runId??'')?i.runId:'(unknown)'}${stage?` / ${stage}`:''}.${code?` ${code}.`:''}`});
  if(!valid(i))return answer('refused','bad_args');
  try {
    const found=await (ports.lookupIssueWorktree??lookupIssueWorktree)({cwd:i.cwd,runId:i.runId},ports.commandPorts??ports);
    if(found?.state!=='ready'||!found.assignment)return answer('refused','unknown_run');
    const a=found.assignment,runDir=join(a.gitDir,'pdd','workflows',i.runId);
    const journal=await (ports.readWorkflowJournal??readWorkflowJournal)({runDir},ports),s=journal.state;
    if(!s||s.runId!==i.runId||!isDeepStrictEqual(s.assignment,a))return answer('failed');
    stage=s.definitions?.[s.index]?.id??null;journalSeq=s.seq;
    const expect=expectOf(i),binding={decision:i.decision,expect};
    const previous=[...(journal.decisions??[]),...(s.decisions??[])].filter(d=>d.decisionId===i.decisionId);
    if(previous.length) {
      const match=d=>d.decision===i.decision&&isDeepStrictEqual(d.expect??{rev:d.expectedRev??d.rev??null,stage:d.stage??null,seq:d.seq??null},expect);
      return previous.every(match)?answer('recorded'):answer('refused','bad_args');
    }
    const prior=await readIntent(runDir,i.decisionId);
    if(prior) {
      if(prior.unreadable)return answer('uncertain');
      if(prior.value.runId!==i.runId||prior.value.decision!==binding.decision||!isDeepStrictEqual(prior.value.expect,binding.expect))return answer('refused','bad_args');
      return answer(prior.value.phase==='started'&&provedLaunch(prior.value.launchProof)?'started':prior.value.phase==='failed'?'failed':'uncertain',null,prior.value.controller??null);
    }
    const wait=s.waitingPerson;
    if(i.expectedRev!==undefined&&wait?.rev!==i.expectedRev || i.expectStage!==undefined&&(stage!==i.expectStage||s.seq!==i.expectSeq)
      || wait&&i.expectedRev===undefined&&i.expectSeq!==wait.rev || !stage) return answer('refused','stale_decision');
    if(await (ports.isControllerLive??isControllerLive)({gitDir:a.gitDir,runId:i.runId},ports))return answer('refused','run_not_waiting');
    // The validated journal alone grants admission; a status heartbeat is never authority.
    const current=s.definitions?.[s.index],accepts=wait?.decisions??(current?.optional&&!s.optional?.[current.id]?['approve','skip']:current?.kind==='human'?['approve']:[]);
    if(!accepts.includes(i.decision)||wait?.origin==='quota'||s.controlState&&s.controlState!=='waiting_person')return answer('refused','run_not_waiting');
    if(!s.runtime||!s.adopted&&s.p1!==true)return answer('refused','unsupported');
    let start=ports.startWorkflowController;
    if(!start)try{start=(await import('./workflow-controller.mjs')).startWorkflowController;}catch{return answer('refused','unsupported');}
    const intent={v:1,runId:i.runId,decisionId:i.decisionId,decision:i.decision,expect,phase:'intent',controller:null,at:(ports.now??Date.now)()};
    try{await writeIntent(runDir,i.decisionId,intent,true);}catch(e){const raced=await readIntent(runDir,i.decisionId);if(raced)return answer('uncertain');return answer('failed');}
    let launched;
    try {const spec={runId:i.runId,runDir,root:a.worktreePath,workflow:s.name,issueNumber:s.issue.number,runtime:s.runtime,
      decision:{decision:i.decision,id:i.decisionId,rev:i.expectedRev??wait?.rev??i.expectSeq,...(i.expectStage!==undefined?{expectStage:i.expectStage,expectSeq:i.expectSeq}:{})}};const invoke=()=>start(spec,ports);launched=ports.withWorkflowAdmission?await ports.withWorkflowAdmission({runId:i.runId,kind:'controller'},invoke):await invoke();}
    catch{return answer('uncertain');}
    const state=launched?.state==='started'?(provedLaunch(launched)?'started':'uncertain'):['refused','failed','uncertain'].includes(launched?.state)?launched.state:'uncertain';
    const next={...intent,phase:state,controller:launched?.controller??null,launchProof:state==='started'?launched:null};
    try{await writeIntent(runDir,i.decisionId,next);}catch{return answer('uncertain',null,next.controller);}
    return answer(state,launched?.code??null,next.controller);
  } catch {return answer('failed');}
}
