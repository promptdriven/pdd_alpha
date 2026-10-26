// Generated from prompts/cli/workflow-run-records.prompt.md (sha256: a827f4ca30074ea68eae58b6acfab78f105d0f41fb790a943fb3a6706fbdb6a1).
import * as nodeFs from 'node:fs/promises';
import { join, basename } from 'node:path';
import { randomBytes as nodeRandomBytes } from 'node:crypto';
import {replayWorkflowJournalRecord} from './workflow-journal.mjs';
import {readKeeperDecision} from './workflow-keeper-log.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUN_DIR = id => new RegExp(`/(?:pdd/workflows|runs/archive)/${id}$`);
const KNOWN_STATUS = new Set(['completed','waiting','failed','recovery_required','running','unknown']);
const STEP_STATES = new Set(['done','skipped','current','next','failed','unknown']);
const CONTROL = new Set(['running','waiting_agent','quota_wait','WAIT','waiting_person','question_lost','completed','failed','recovery_required']);
const fsOf = p => p?.fs ?? nodeFs;
const isObj = value => value && typeof value === 'object' && !Array.isArray(value);
const cut = (v, n) => typeof v === 'string' ? [...v].slice(0, n).join('') : v;
const safeInt = v => Number.isSafeInteger(v) && v >= 0;

async function readText(path, ports = {}) {
  const fs = fsOf(ports);
  try { return await fs.readFile(path, 'utf8'); } catch (e) { if (e?.code === 'ENOENT') return null; throw e; }
}
function normalizedEntry(raw) {
  return { v: raw.v ?? null, runId: raw.runId, workflow: raw.workflow ?? null, repo: raw.repo ?? null,
    issue: isObj(raw.issue) ? { number: raw.issue.number ?? null, url: raw.issue.url ?? null } : null,
    agent: raw.agent ?? null, root: raw.root ?? null, runDir: raw.runDir, startedAt: raw.startedAt ?? null, pdd: raw.pdd ?? null, project: raw.project ?? null, archived: raw.archived ?? null, archiveRunDir: raw.archiveRunDir ?? null };
}
export async function appendRunIndex(entry, ports = {}) {
  try {
    const home = ports.home ?? process.env.HOME;
    if (typeof home !== 'string' || !isObj(entry)) throw Error('bad_input');
    const text = JSON.stringify(entry) + '\n';
    if (Buffer.byteLength(text) > 4096) return { ok: false, code: 'too_large' };
    const fs = fsOf(ports), dir = join(home, '.pdd', 'runs'), path = join(dir, 'index.jsonl');
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const handle = await fs.open(path, 'a', 0o600);
    try { await handle.write(text); } finally { await handle.close(); }
    return { ok: true };
  } catch (e) { return { ok: false, code: e?.code || 'write_failed' }; }
}
export async function readRunIndex(ports = {}) {
  try {
    const home = ports.home ?? process.env.HOME; if (typeof home !== 'string') return { entries: [], dropped: 0 };
    const text = await readText(join(home, '.pdd', 'runs', 'index.jsonl'), ports);
    if (text == null) return { entries: [], dropped: 0 };
    const lines = text.split('\n'); let dropped = 0; const map = new Map();
    lines.pop(); // The last unterminated line is never a complete index entry.
    for (const line of lines) {
      if (!line || Buffer.byteLength(line) > 16384) { dropped++; continue; }
      let raw; try { raw = JSON.parse(line); } catch { dropped++; continue; }
      if (!isObj(raw) || !UUID.test(raw.runId ?? '') || typeof raw.runDir !== 'string' || !raw.runDir.startsWith('/') || !RUN_DIR(raw.runId).test(raw.runDir)) { dropped++; continue; }
      if (!map.has(raw.runId)) map.set(raw.runId, normalizedEntry(raw)); else map.set(raw.runId, normalizedEntry(raw));
    }
    return { entries: [...map.values()], dropped };
  } catch { return { entries: [], dropped: 0 }; }
}

function stageInfo(state) {
  const defs = Array.isArray(state?.definitions) ? state.definitions : null;
  const index = Number.isInteger(state?.index) && state.index >= 0 ? state.index : null;
  return { defs, index, valid: !!defs && index !== null };
}
export function runStatusFromState(state, extras = {}) {
  try {
    const phase = ['record','exit','journal'].includes(extras.phase) ? extras.phase : 'journal';
    const { defs, index, valid } = stageInfo(state);
    const outState = phase === 'exit' ? (['completed','waiting','failed','recovery_required'].includes(extras.outcome?.state) ? extras.outcome.state : 'unknown')
      : !valid ? 'unknown' : phase === 'record' ? (index >= defs.length ? 'completed' : 'running') : (index >= defs.length ? 'completed' : 'unknown');
    const current = valid && index < defs.length ? defs[index] : null;
    const completed = Array.isArray(state?.completed) ? state.completed : [];
    const skipped = new Set(completed.filter(x => x?.skipped).map(x => x.id));
    const done = new Set(completed.filter(x => !x?.skipped).map(x => x.id));
    const steps = valid ? defs.map((d, i) => ({ id: d?.id ?? null, kind: d?.kind ?? null,
      state: skipped.has(d?.id) ? 'skipped' : done.has(d?.id) ? 'done' : i === index ? outState === 'failed' ? 'failed' : 'current' : i > (index ?? -1) ? 'next' : 'unknown', optional: d?.optional === true })) : [];
    const optionalKey = current && current.optional === true && !state?.optional?.[current.id];
    let waitingFor = null;
    if (outState === 'waiting') {
      const decisions = Array.isArray(extras.outcome?.decisions) ? extras.outcome.decisions.filter(x => x === 'approve' || x === 'skip') : null;
      if (state?.waitingPerson?.origin === 'quota') waitingFor = {decisions: (Array.isArray(state.waitingPerson.decisions)?state.waitingPerson.decisions:[]).filter(x => ['continue','wait'].includes(x)), questionId: state.waitingPerson.questionId ?? null, rev: state.rev ?? state.waitingPerson.rev ?? null};
      else if (decisions) waitingFor = { decisions, what: cut(extras.outcome?.what ?? null, 200) };
      else if (optionalKey) waitingFor = { decisions: ['approve','skip'], what: `Run or skip ${current.id}` };
      else if (current?.kind === 'human') waitingFor = { decisions: ['approve'], what: 'Approve the current proposal and test plan' };
      else if (current?.kind === 'merge') waitingFor = { decisions: [], what: 'Merge the PR on GitHub' };
    } else if (['running','completed','failed','recovery_required'].includes(outState)) waitingFor = { decisions: [], what: null };
    const resumeDecisions = state?.waitingPerson?.origin === 'quota' ? [] : valid ? (optionalKey ? ['approve','skip'] : current?.kind === 'human' ? ['approve'] : []) : [];
    const pr = completed.filter(x => x?.kind === 'pr' && Number.isSafeInteger(x?.pr?.number) && typeof x.pr.url === 'string').map(x => ({ stage: x.id, number: x.pr.number, url: x.pr.url }));
    let stageAgent = null; const pending = state?.pending;
    if (pending && ['agent','cleanup'].includes(pending.kind) && pending.backend) {
      const b = pending.backend, ns = b.nativeSession?.kind === 'id' ? b.nativeSession.value : null;
      stageAgent = { kind: b.agentKind ?? state.agent ?? null, nativeSessionId: ns, herdrSession: b.session ?? null, paneId: b.paneId ?? null };
    }
    const backend = state?.pending?.backend ?? state?.backend;
    const fields = Object.fromEntries(['machineId','startId','rev','runtime','quota','stall','machineToolPolicy','actualAccount','accountTransition','project','launchSelection','runtimeNotice','waitingPerson'].map(k=>[k,state?.[k] ?? null]));
    fields.controlState = state?.controlState == null ? null : CONTROL.has(state.controlState) ? state.controlState : 'unknown';
    fields.heartbeatAt = extras.heartbeatAt ?? state?.heartbeatAt ?? null;
    fields.backendGen = backend?.backendGen ?? state?.backendGen ?? null;
    fields.actualAccount = backend?.actualAccount ?? fields.actualAccount;
    fields.effectiveSelection = backend?.launchSelection ?? (backend?.agentKind && backend.agentKind !== state?.agent ? null : fields.launchSelection);
    return { ...fields, v: 1, runId: state?.runId ?? null, workflow: state?.name ?? null, state: outState,
      stage: current && valid ? { id: current.id, kind: current.kind, index, total: defs.length } : null,
      waitingFor, resumeDecisions, steps, pr, stageAgent, controller: extras.controller ?? null,
      message: phase === 'exit' ? cut(extras.outcome?.message ?? null, 300) : null,
      journalSeq: safeInt(state?.seq) ? state.seq : 0, updatedAt: extras.now ?? null };
  } catch { return { v: 1, runId: null, workflow: null, state: 'unknown', stage: null, waitingFor: null, resumeDecisions: [], steps: [], pr: [], stageAgent: null, controller: null, message: null, journalSeq: 0, updatedAt: extras.now ?? null }; }
}

export async function writeRunStatus(runDir, status, ports = {}) {
  let tmpPath, created=false;
  try {
    const fs = fsOf(ports), text = JSON.stringify(status) + '\n';
    if (Buffer.byteLength(text) > 256 * 1024) return { ok: false, code: 'too_large' };
    const rb = ports.randomBytes ?? nodeRandomBytes, suffix = Buffer.from(rb(8)).toString('hex');
    tmpPath = join(runDir, `.status.json.${suffix}.tmp`);
    const handle = await fs.open(tmpPath, 'wx', 0o600); created=true;
    try { await handle.write(text); if (handle.sync) await handle.sync(); } finally { await handle.close(); }
    await fs.rename(tmpPath, join(runDir, 'status.json'));
    try { const d = await fs.open(runDir, 'r'); try {if (d.sync) await d.sync();} finally {await d.close();} } catch { /* directory sync is best effort */ }
    return { ok: true };
  } catch (e) { if (created && tmpPath) try { await fsOf(ports).unlink(tmpPath); } catch {} return { ok: false, code: e?.code || 'write_failed' }; }
}
const statusFields = new Set(['v','runId','workflow','repo','issue','agent','root','runDir','startedAt','pdd','state','stage','waitingFor','resumeDecisions','steps','pr','stageAgent','controller','message','journalSeq','updatedAt','machineId','startId','controlState','rev','runtime','heartbeatAt','backendGen','quota','stall','machineToolPolicy','actualAccount','accountTransition','project','launchSelection','effectiveSelection','runtimeNotice','waitingPerson']);
export async function readRunStatus(runDir, ports = {}) {
  const warnings = []; try {
    const text = await readText(join(runDir, 'status.json'), ports); if (text == null) return { value: null, warnings: ['missing'] };
    if (Buffer.byteLength(text) > 256 * 1024) return { value: null, warnings: ['too_large'] };
    let raw; try { raw = JSON.parse(text); } catch { return { value: null, warnings: ['bad_json'] }; }
    if (!isObj(raw)) return {value:null,warnings:['bad_json']};
    if (raw.runId !== basename(runDir) || !Number.isInteger(raw.journalSeq) || raw.journalSeq < 0) return { value: null, warnings: [raw?.runId !== basename(runDir) ? 'run_mismatch' : 'bad_record'] };
    const value = {}; for (const [k,v] of Object.entries(raw)) { if (!statusFields.has(k)) warnings.push(`unknown_field:${k}`); else value[k] = v; }
    value.waitingFor ??= null; if (value.controlState != null && !CONTROL.has(value.controlState)) value.controlState = 'unknown'; if (!KNOWN_STATUS.has(value.state)) value.state = 'unknown';
    if (Array.isArray(value.steps)) value.steps = value.steps.filter(s => { if (!s || typeof s.id !== 'string') { warnings.push('dropped_item:steps'); return false; } if (!STEP_STATES.has(s.state)) s.state = 'unknown'; return true; });
    if(value.state==='running'){
      const recovery=await readKeeperDecision({runId:value.runId},ports);
      if(recovery&&recovery.journalSeq===value.journalSeq&&Number.isFinite(value.updatedAt)&&recovery.at>=value.updatedAt&&['absent','unknown'].includes(recovery.controller)){
        value.state=recovery.controller==='absent'?'recovery_required':'unknown';
        value.message=`controller ${recovery.controller==='absent'?'not running':'status unknown'}; recovery: ${recovery.code??recovery.decision}`;
        if(recovery.reason==='server_absent'){
          value.state='recovery_required';
          value.message='Herdr is not running. Run pdd setup to start the Herdr service, then inspect pdd workflow status before resuming the saved run.';
        }else if(recovery.code==='launch_budget'&&Number.isFinite(recovery.resetAt)){
          value.state='recovery_required';
          value.message=`Controller recovery limit reached (3 unplanned launches per hour). Retry available at ${new Date(recovery.resetAt).toISOString()}. Inspect pdd workflow status and pdd doctor; resume the saved run after that time.`;
        }
      }
    }
    return { value, warnings };
  } catch (e) { return { value: null, warnings: [e?.code === 'ENOENT' ? 'missing' : 'read_failed'] }; }
}

// Read from the tail, retaining at most one complete record at a time. The cap
// limits history traversal, not the size of the whole journal.
async function* reverseLines(path, ports = {}, cap = Infinity) {
  const fs=fsOf(ports),h=await fs.open(path,'r');
  try {
    const size=(await h.stat()).size;let pos=size,pending=Buffer.alloc(0),read=0,tail=true,partialTail=false;
    while(pos>0&&read<cap){
      const length=Math.min(1024*1024,pos,cap-read),buf=Buffer.alloc(length);pos-=length;
      const got=await h.read(buf,0,length,pos);if(got.bytesRead!==length)throw Error('short_read');
      read+=length;
      if(tail&&buf.lastIndexOf(10)<0){partialTail=true;continue;}
      pending=Buffer.concat([buf,pending]);
      let end=pending.length;
      for(let i=pending.length-1;i>=0;i--)if(pending[i]===10){
        if(tail){yield {partial:partialTail||i!==pending.length-1};tail=false;}
        else yield {line:pending.subarray(i+1,end)};
        end=i;
      }
      pending=pending.subarray(0,end);
      if(pending.length>64*1024*1024){yield {tooLarge:true};return;}
    }
    if(pos===0){if(tail){if(partialTail||pending.length)yield {partial:true};}else if(pending.length)yield {line:pending};yield {complete:true};}
    else yield {complete:false};
  } finally {await h.close();}
}
export async function readJournalLast(runDir, ports = {}) {
  const warnings=[],tail=[];
  try {
    for await(const part of reverseLines(join(runDir,'journal.jsonl'),ports)){
      if(part.partial)warnings.push('partial_line');
      if(part.tooLarge)return {value:null,warnings:[...warnings,'too_large']};
      if(part.line){
        if(part.line.length>64*1024*1024)return {value:null,warnings:[...warnings,'too_large']};
        let row;try{row=JSON.parse(part.line);}catch{return {value:null,warnings:[...warnings,'bad_json']};}
        if(!isObj(row)||!Number.isSafeInteger(row.seq)||row.seq<1)return {value:null,warnings:[...warnings,'bad_record']};
        const runId=Object.hasOwn(row,'state')?row.state?.runId:row.runId;
        if(runId!==basename(runDir))return {value:null,warnings:[...warnings,'run_mismatch']};
        tail.push(row);
        if(Object.hasOwn(row,'state')){
          let state;
          try {for(const record of tail.reverse())state=replayWorkflowJournalRecord(state,record);}
          catch{return {value:null,warnings:[...warnings,'bad_record']};}
          const last=tail.at(-1);
          return {value:{seq:last.seq,event:last.event,state},warnings};
        }
        if(row.v!==1||!Array.isArray(row.delta)||tail.length>=128)return {value:null,warnings:[...warnings,'bad_record']};
      }
    }
    return {value:null,warnings:tail.length?[...warnings,'bad_record']:warnings};
  }catch(e){return {value:null,warnings:[e?.code==='ENOENT'?'missing':'read_failed']};}
}
export async function readJournalSince(runDir, afterSeq, ports = {}) {
  const warnings=[],records=[];
  try {
    for await(const part of reverseLines(join(runDir,'journal.jsonl'),ports,64*1024*1024)){
      if(part.partial)warnings.push('partial_line');
      if(part.tooLarge)return {records:records.reverse(),complete:false,warnings:[...warnings,'too_large']};
      if('complete' in part)return {records:records.reverse(),complete:part.complete,warnings};
      if(!part.line)continue;
      let row;try{row=JSON.parse(part.line);}catch{warnings.push('bad_json');continue;}
      if(!Number.isSafeInteger(row?.seq))continue;
      if(row.seq<=afterSeq)return {records:records.reverse(),complete:true,warnings};
      records.push({seq:row.seq,event:row.event,decisionId:typeof row.decisionId==='string'?row.decisionId:null});
    }
    return {records:records.reverse(),complete:true,warnings};
  }catch(e){return {records:[],complete:false,warnings:[e?.code==='ENOENT'?'missing':'read_failed']};}
}
export async function readAssignedRuns(commonDir, ports = {}) {
  const entries=[]; let dropped=0; try { const fs=fsOf(ports), dir=join(commonDir,'pdd','worktree-assignments','issues'); const names=await fs.readdir(dir); for(const name of names.filter(n=>n.endsWith('.json')).sort()){ let raw; try{const t=await fs.readFile(join(dir,name),'utf8');if(Buffer.byteLength(t)>64*1024)throw Error();raw=JSON.parse(t);}catch{dropped++;continue;} if(!isObj(raw)||raw.version!==1||!UUID.test(raw.runId)||typeof raw.gitDir!=='string'||!raw.gitDir.startsWith('/')||typeof raw.worktreePath!=='string'||!raw.worktreePath.startsWith('/')){dropped++;continue;} entries.push({v:1,runId:raw.runId,workflow:raw.workflowName??null,repo:raw.repository??null,issue:{number:raw.issueNumber??null,url:null},agent:null,root:raw.worktreePath,runDir:join(raw.gitDir,'pdd','workflows',raw.runId),startedAt:null,pdd:null}); } } catch(e){if(e?.code!=='ENOENT') dropped++;} return {entries,dropped}; }
