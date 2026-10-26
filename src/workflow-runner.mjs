// Generated from prompts/cli/workflow-runner.prompt.md (sha256: fd04d4430dfa9fc324d9a95fa67c0e0ab914dee6b915da5580620bd2f8a05023).
import { execFile as execFileCallback } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { constants, fstatSync, openSync, closeSync, writeSync, readSync, fsyncSync, mkdirSync, readFileSync, readdirSync,
  lstatSync, realpathSync, readlinkSync, existsSync } from 'node:fs';
import { join, resolve, relative, isAbsolute, sep, basename, dirname } from 'node:path';
import { homedir } from 'node:os';
import { AsyncLocalStorage } from 'node:async_hooks';
import { WORKFLOW_STAGES } from './workflow-definitions.mjs';
import { loadWorkflowDefinition } from './workflow-definition-loader.mjs';
import { resolveWorkflowIssue, prepareWorkflowPr, publishWorkflowPr, reconcileWorkflowPr, commitWorkflowArtifacts } from './workflow-github.mjs';
import { readWorkflowHandoff, assertWorkflowArtifacts, runWorkflowTestCommands } from './workflow-artifacts.mjs';
import { appendRunIndex, writeRunStatus, runStatusFromState } from './workflow-run-records.mjs';
export { WORKFLOW_STAGES } from './workflow-definitions.mjs';
import { traceHerdrRequest } from './herdr-trace.mjs';
import {encodeWorkflowJournalRecord,replayWorkflowJournalRecord} from './workflow-journal.mjs';
const journalStates=new WeakMap();
import { resolveHerdrExecutable } from './workflow-herdr-executable.mjs';
import {readSettledHerdrStageError,retrySettledHerdrStage} from './workflow-stage-herdr.mjs';

const ordinaryExec = promisify(execFileCallback);
const defaultExec = (file, args, { cwd, env }) => ordinaryExec(file, args, { cwd, env, encoding: 'utf8', shell: false, maxBuffer: 16 * 1024 * 1024 });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const STAGE = /^(?=.{1,64}$)[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const digest = value => createHash('sha256').update(value).digest('hex');
const text = value => typeof value === 'string' && value.trim().length > 0;
const fail = message => { throw Error(message); };

function dependencies(ports = {}) {
  const execFile=ports.execFile??defaultExec;
  return { ...ports, execFile, commandPorts: ports.execFile ? { execFile: ports.execFile } : {},
    stdout: ports.stdout ?? process.stdout, stderr: ports.stderr ?? process.stderr };
}
async function command(p, cwd, executable, args, raw = false) {
  let result;try{result=await (executable==='herdr'
    ? traceHerdrRequest({operation:'pane.process_info',request:{argv:args}},async()=>{
      const path=await resolveHerdrExecutable(p);
      const env={...(p.env??process.env),...((p.env?.PDD_TRACE===undefined&&process.env.PDD_TRACE!==undefined)?{PDD_TRACE:process.env.PDD_TRACE}:{})};
      try{return await p.execFile(path,args,{cwd,env});}catch(error){if(error?.code==='ENOENT')throw Object.assign(Error(`Herdr not found at ${path}`),{code:'herdr_not_found'});throw error;}
    },p)
    : p.execFile(executable,args,{cwd}));}catch(error){if(error?.code==='herdr_not_found')throw error;fail(`${executable} command could not be confirmed.`);}
  if (Number.isInteger(result?.code) && result.code !== 0) fail(`${executable} command failed (${result.code}).`);
  const output = String(result?.stdout ?? '');
  return raw ? output : output.replace(/\r?\n$/, '');
}
const git = (p, cwd, ...args) => command(p, cwd, 'git', args);
const json = value => { try { return JSON.parse(value); } catch { fail('A tool or saved artifact returned invalid JSON.'); } };

async function repository(cwd, p) {
  if (!text(cwd)) fail('A current project directory is required.');
  const root = realpathSync(await git(p, cwd, 'rev-parse', '--show-toplevel'));
  if (lstatSync(join(root, '.git')).isSymbolicLink()) fail('Git metadata cannot be a symlink.');
  const gitDir = realpathSync(await git(p, root, 'rev-parse', '--absolute-git-dir'));
  const commonDir = realpathSync(await git(p, root, 'rev-parse', '--path-format=absolute', '--git-common-dir'));
  return { root, gitDir, commonDir };
}
async function fingerprint(r, p) {
  const head = await git(p, r.root, 'rev-parse', 'HEAD');
  const branch = await git(p, r.root, 'symbolic-ref', '--quiet', '--short', 'HEAD').catch(() => '(detached)');
  const staged = await command(p, r.root, 'git', ['diff', '--cached', '--binary', 'HEAD', '--'], true);
  const diff = await command(p, r.root, 'git', ['diff', '--binary', 'HEAD', '--'], true);
  const names = (await command(p, r.root, 'git', ['ls-files', '--others', '--exclude-standard', '-z'], true)).split('\0').filter(Boolean).sort();
  const untracked = names.map(name => {
    const path = resolve(r.root, name), info = lstatSync(path);
    if (!contained(r.root, path)) fail('A project path escaped its root.');
    return [name, digest(info.isSymbolicLink() ? readlinkSync(path) : readFileSync(path))];
  });
  return { head, hash: digest(JSON.stringify({ head, branch, staged, diff, untracked })) };
}
function contained(root, path) { const part = relative(root, path); return part && part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part); }
function requireDirectory(path) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(path) !== path) fail('Workflow metadata directories must not follow aliases.');
}
function ensureDirectory(path) {
  if (!existsSync(path)) {
    if (dirname(path) !== path) ensureDirectory(dirname(path));
    try { mkdirSync(path, { mode: 0o700 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  requireDirectory(path);
}
function journalFile(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || realpathSync(path) !== path)
    fail('Workflow journal must be a single ordinary metadata file.');
}
function syncDirectory(path) {
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function durable(path, value) {
  const fd = openSync(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0), 0o600);
  const bytes = Buffer.from(JSON.stringify(value) + '\n');
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1) fail('Workflow journal cannot alias another file.');
    let written = 0;
    while (written < bytes.length) {
      const count = writeSync(fd, bytes, written, bytes.length - written);
      if (count < 1) fail('Workflow journal could not be completely persisted.');
      written += count;
    }
    fsyncSync(fd);
  } finally { closeSync(fd); }
  syncDirectory(dirname(path));
}

function readSaved(directory, onRecord) {
  requireDirectory(directory);
  const path = join(directory, 'journal.jsonl'); journalFile(path);
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let saved, sequence = 0, fragments = [], length = 0, padding = false, terminated = false;
  const consume = line => {
    if (!line.trim()) { padding = true; return; }
    if (padding) fail('Saved workflow journal is invalid.');
    const row = json(line);
    const state=replayWorkflowJournalRecord(saved,row);
    if (row.seq !== ++sequence || state?.seq !== row.seq || !state
      || !UUID.test(state.runId ?? '') || state.runId !== basename(directory)
      || state.version !== 2 || !Array.isArray(state.definitions) || !Array.isArray(state.completed)
      || !isDeepStrictEqual(state.definition?.stages,state.definitions) || state.name!==state.definition?.name
      || saved && (state.runId !== saved.runId || state.root !== saved.root || state.gitDir !== saved.gitDir
        || !isDeepStrictEqual(state.assignment, saved.assignment)
        || ['name','agent','repo','base','inputDigest','contextDigest'].some(k=>state[k]!==saved[k])
        || !isDeepStrictEqual(state.definition,saved.definition) || !isDeepStrictEqual(state.launchSelection,saved.launchSelection))) fail('Saved workflow journal is invalid.');
    saved = state;
    const {delta,baseSeq,...snapshot} = row;
    onRecord?.({...snapshot,state:saved});
  };
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.nlink !== 1) fail('Workflow journal cannot alias another file.');
    const chunk = Buffer.allocUnsafe(64 * 1024);
    let count;
    while ((count = readSync(fd, chunk, 0, chunk.length, null)) > 0) {
      let start = 0, newline;
      while ((newline = chunk.indexOf(10, start)) !== -1 && newline < count) {
        if (fragments.length) {
          fragments.push(chunk.subarray(start, newline));
          consume(Buffer.concat(fragments, length + newline - start).toString('utf8'));
          fragments = []; length = 0;
        } else consume(chunk.toString('utf8', start, newline));
        start = newline + 1;
      }
      if (start < count) {
        const fragment = Buffer.from(chunk.subarray(start, count));
        fragments.push(fragment); length += fragment.length;
      }
      terminated = chunk[count - 1] === 10;
    }
    if (!terminated) fail('Saved workflow journal is incomplete; inspect it without replaying effects.');
  } finally { closeSync(fd); }
  if (!saved || !UUID.test(saved.runId) || saved.runId !== basename(directory)
    || !Number.isInteger(saved.index) || saved.index < 0 || saved.index > saved.definitions?.length
    || saved.version !== 2 || !Array.isArray(saved.completed) || !saved.definition || !saved.assignment
    || !['codex', 'claude'].includes(saved.agent) || !isDeepStrictEqual(saved.definitions, saved.definition.stages)
    || saved.name !== saved.definition.name || saved.assignment.runId !== saved.runId) fail('Saved workflow identity or definitions changed.');
  journalStates.set(saved,JSON.parse(JSON.stringify(saved)));
  return saved;
}
async function record(s, directory, event, metadata = {}) {
  s.seq = (s.seq ?? 0) + 1;
  const row=encodeWorkflowJournalRecord(journalStates.get(s),s,{event,...(s.__decisionId&&!metadata.decisionId?{decisionId:s.__decisionId}:{}),...metadata});
  durable(join(directory,'journal.jsonl'),row);
  journalStates.set(s,JSON.parse(JSON.stringify(s)));
  const ports = s.__recordPorts;
  if (!ports) return;
  if (event === 'run.started') {
    try { await (ports.appendRunIndex ?? appendRunIndex)({ v: 1, runId: s.runId, workflow: s.name, repo: s.repo,
      issue: s.issue, agent: s.agent, root: s.root, runDir: directory, startedAt: Date.now(), pdd: ports.pdd ?? null }, ports); } catch { /* derived output never steers the run */ }
  }
  try { await (ports.writeRunStatus ?? writeRunStatus)(directory, runStatusFromState(s, { phase: 'record', now: Date.now(), controller: s.controller ?? null }), ports); } catch { /* derived output never steers the run */ }
}
async function lock(root, ports = {}, filename = 'controller.lock') {
  ensureDirectory(dirname(root)); ensureDirectory(root);
  const withLock = ports.withWorkflowLock ?? (await import('./workflow-claims.mjs')).withWorkflowLock;
  let release, acquired;
  const ready = new Promise((resolve, reject) => { acquired = {resolve,reject}; });
  const finished = new Promise(resolve => { release = resolve; });
  const running = Promise.resolve().then(() => withLock({path:join(root,filename)}, async () => {
    acquired.resolve(); await finished;
  },ports));
  running.catch(error=>acquired.reject(error?.code==='WORKFLOW_STAGE_BUSY'&&filename==='controller.lock'?Object.assign(Error(error.message),{code:'controller_busy'}):error));
  await ready;
  return async () => { release(); await running; };
}
async function lifecycle(assignment, runId, p) {
  const parent=join(assignment.commonDir,'pdd','run-lifecycle'); ensureDirectory(parent);
  const release=await lock(parent,p,runId+'.lock');
  try {
    const path=join(parent,runId+'.json');
    if(existsSync(path)) {journalFile(path); const value=json(readFileSync(path,'utf8'));if(['removing','archived'].includes(value.state))fail('This run is removing or archived; retained history is read-only.');}
    return release;
  } catch(e) {await release();throw e;}
}
async function controllerLock(assignment,runId,p) {
  const runDir=join(assignment.gitDir,'pdd','workflows',runId);
  requireDirectory(runDir);journalFile(join(runDir,'journal.jsonl'));
  const release=await lifecycle(assignment,runId,p);
  try {return await lock(join(assignment.gitDir,'pdd','workflows',runId),p);}
  finally {await release();}
}
export async function isControllerLive({gitDir,runId} = {}, ports = {}) {
  try {
    const inspect=ports.inspectWorkflowLock ?? (await import('./workflow-claims.mjs')).inspectWorkflowLock;
    if(typeof gitDir!=='string'||!isAbsolute(gitDir))return true;
    if(runId)return await inspect({path:join(gitDir,'pdd','workflows',runId,'controller.lock')},ports)!=='free';
    const root=join(gitDir,'pdd','workflows');if(!existsSync(root))return false;
    for(const id of readdirSync(root).filter(id=>UUID.test(id)))if(await inspect({path:join(root,id,'controller.lock')},ports)!=='free')return true;
    return false;
  }catch{return true;}
}
function result(s, state, message, code = null) {
  const runId = s?.runId ?? null, stage = s?.definitions?.[s.index]?.id ?? null;
  return { exitCode: ['failed', 'recovery_required'].includes(state) ? 1 : state === 'waiting' ? 2 : 0,
    state, ...(code ? { code } : {}), runId, stage, message: `${state}: run ${runId ?? '(not started)'}${stage ? ` / ${stage}` : ''}. ${message}` };
}
const stageGuardOwner = new AsyncLocalStorage();
function stageGuard(s, p = {}) {
  const commonDir = s.assignment?.commonDir;
  if (!commonDir || !UUID.test(s.runId)) fail('A verified issue assignment is required for the stage guard.');
  const parent = join(commonDir, 'pdd', 'workflow-stage-guards');
  ensureDirectory(parent);
  const root = join(parent, s.runId);
  return async function withStageGuard(backend, action) {
    if (!backend || backend.runId !== s.runId || backend.cwd !== s.root || typeof action !== 'function')
      fail('The shared stage guard does not match this assigned run.');
    if (stageGuardOwner.getStore()?.root === root && stageGuardOwner.getStore().active) return action();
    let release;
    try { release = await lock(root,p,'stage.lock'); }
    catch (error) { throw Object.assign(Error(error.message), { code: 'WORKFLOW_STAGE_BUSY' }); }
    const owner = { root, active: true };
    try { return await stageGuardOwner.run(owner, action); }
    finally { owner.active = false; await release(); }
  };
}
function attachmentEpoch(s, increment = false) {
  const root = join(s.assignment.commonDir, 'pdd', 'workflow-stage-guards', s.runId);
  if (stageGuardOwner.getStore()?.root !== root || !stageGuardOwner.getStore().active) fail('Attachment epoch requires the shared stage guard.');
  const path = join(root, 'attachments.jsonl');
  let epoch = 0;
  if (existsSync(path)) {
    journalFile(path);
    const bytes = readFileSync(path, 'utf8');
    if (!bytes.endsWith('\n')) fail('Attachment epoch is incomplete; inspect without accepting an older candidate.');
    for (const line of bytes.trimEnd().split('\n')) {
      const entry = json(line);
      if (entry.runId !== s.runId || entry.epoch !== epoch + 1) fail('Attachment epoch is invalid.');
      epoch = entry.epoch;
    }
  }
  if (increment) { epoch++; durable(path, { runId: s.runId, epoch }); }
  return epoch;
}
async function sourceValid(s, r) { await assertWorkflowArtifacts({ cwd: r.root, files: s.accepted?.files ?? [] }); }
function authority(s, r) {
  if (s.root !== r.root || s.gitDir !== r.gitDir || s.repo !== r.repo || s.base !== r.base) fail('The saved run belongs to a different project or repository.');
}
async function current(s, r, p) {
  authority(s, r);
  await assignedRepository(s.assignment, p);
  if (!isDeepStrictEqual(s.expected, await fingerprint(r, p))) fail('Project HEAD or worktree changed since the saved input; inspect before advancing.');
  await sourceValid(s, r);
}
async function handoff(s, stage, r, directory) {
  const roles = stage.requiredRoles ?? [];
  const h = await readWorkflowHandoff({ handoffPath: s.pending.handoffPath, cwd: r.root,
    expected: { runId: s.runId, stageId: stage.id, issueUrl: s.issue.url, inputRevision: s.pending.input.head },
    requiredRoles: roles });
  const reportOnly = stage.protocol === 'report';
  if (!h.files.length && !reportOnly) fail('This work stage requires concrete project artifacts.');
  if (stage.protocol === 'proposal' && !h.testCommands?.length) fail('Independent expectations and a native test argv plan are required.');
  return { summary: h.summary, files: h.files, testCommands: h.testCommands ?? [], reportOnly: !h.files.length,
    path: relative(directory, s.pending.handoffPath) };
}
function nativePorts(s, directory, r, options, p) {
  const guard = stageGuard(s,p);
  return {
    ...p, runtime:s.runtime??p.runtime, ...(Object.hasOwn(s.runtime??{},'herdr')?{herdrExecutable:s.runtime.herdr}:{}),
    controller:s.controller ?? p.controller, backendGen:s.backendGen ?? 1,
    withStageGuard: (backend, action) => guard(backend, async () => {
      await validateInput(s, options, p);
      if (['ready', 'prompt_intent'].includes(backend.phase)) await current(s, r, p);
      return action();
    }),
    onStageObservation:async observation=>{
      const now=(p.now??Date.now)();
      if(s.__activityAt!==undefined&&now-s.__activityAt<15000)return {pause:!!s.stall?.alarmed};
      Object.defineProperty(s,'__activityAt',{value:now,writable:true,configurable:true,enumerable:false});
      await activity(s,directory,p,observation);return {pause:!!s.stall?.alarmed};
    },
    validateOwner:async ({kind,nativeSessionId,owner})=>{
      const latest=readSaved(directory),pending=latest.pending,b=pending?.backend;
      if(!pending||pending.kind!=='agent'||owner.runId!==latest.runId||owner.attemptId!==pending.attemptId||owner.backendGen!==(b?.backendGen??latest.backendGen)||kind!==(pending.agent??latest.agent))return {state:'retired'};
      if(nativeSessionId!==null&&b?.nativeSession?.value!==nativeSessionId)return {state:'uncertain'};
      return {state:'current'};
    },
    bindClaim:async ({owner,kind,nativeSessionId})=>{
      const b=s.pending?.backend;
      if(!b||b.backendGen!==owner.backendGen||b.agent!==kind||b.nativeSession?.value!==nativeSessionId)return {ok:false};
      await record(s,directory,'native.claim.bound');return {ok:true};
    },
    checkpoint: async backend => {
      const pending = s.pending;
      if (!pending || backend.runId !== s.runId || backend.stageId !== pending.stage
        || backend.attemptId !== pending.attemptId || backend.cwd !== r.root || backend.agent !== (pending.agent??s.agent))
        fail('Native checkpoint is not bound to the original assigned stage attempt.');
      const transition=pending.resumeIntent&&backend.backendGen===pending.resumeIntent.newGeneration&&pending.backend?.backendGen===pending.resumeIntent.oldGeneration;
      if(transition){s.backendGen=backend.backendGen;pending.backend={...pending.backend,backendGen:backend.backendGen,processProof:null};}
      for (const field of ['session', 'server', 'workspaceId', 'tabId', 'paneId', 'terminalId', 'agentName', 'nativeSession','backendGen','launchSelection','processProof']) {
        if (pending.backend?.[field] != null && !isDeepStrictEqual(pending.backend[field], backend[field]))
          fail('An established native backend identity changed.');
      }
      if(!transition&&isDeepStrictEqual(pending.backend,backend))return;
      pending.backend = structuredClone(backend);
      await record(s, directory, 'agent.backend');
    }
  };
}
function candidateIdentity(s, stage, outcome) {
  const b = outcome?.backend, pending = s.pending;
  if (!b || b.runId !== s.runId || b.stageId !== stage.id || b.attemptId !== pending.attemptId
    || b.cwd !== s.root || b.agent !== (pending.agent??s.agent) || b.promptDigest !== (pending.backendPromptDigest??pending.promptDigest))
    fail('The returned native candidate does not match this original stage attempt.');
  const e = outcome.evidence;
  if (outcome.state === 'settled' && (!Number.isSafeInteger(e?.readySeq) || !Number.isSafeInteger(e.workingSeq)
    || !Number.isSafeInteger(e.settledSeq) || e.workingSeq <= e.readySeq || e.settledSeq <= e.workingSeq
    || !isDeepStrictEqual(e, b.evidence))) fail('Same-agent working to settled evidence is incomplete.');
}
function agentInstructions(s, stage, directory, attemptId, handoffPath, inputRevision) {
  const input = { runId: s.runId, stageId: stage.id, attemptId, protocol: stage.protocol, requiredRoles: stage.requiredRoles,
    issue: s.issue, inputRevision: inputRevision.head,
    inputFingerprint: inputRevision.hash, handoffPath, priorArtifacts: s.completed.flatMap(step => step.handoff?.files ?? []),
    priorReports: s.completed.filter(step => step.handoff).map(step => ({ stageId: step.id, summary: step.handoff.summary, handoffPath: join(directory, step.handoff.path), revision: step.revision })),
    accepted: s.accepted ?? null };
  return `Execute ONLY the current ${stage.id} stage of ${s.name}, then stop. Never perform a future stage, push, create/merge a PR or change native login, permissions or global configuration. Read the ENTIRE supplied Prompting guide FIRST and summarize its relevant method before any Story. Existing project instructions/permissions apply. Work in the assigned issue topic branch and commit requested work when appropriate; do not switch to a different branch; never force checkout, reset, stash or overwrite unrelated work.\nPDD_STAGE_INPUT_JSON\n${JSON.stringify(input)}\nPDD_STAGE_INPUT_END\nUse the .pdd/workflows/${s.name}/${stage.file} Markdown supplied in the saved context for this stage; do not replace it by reloading a mutable recipe file. Agent protocol ${stage.protocol}; required roles ${JSON.stringify(stage.requiredRoles)}. Write your handoff at handoffPath as JSON with exactly version:1,runId,stageId,issueUrl,inputRevision,summary,files:[{path,sha256,role}], optional testCommands:[[executable,...args]]. Use the exact supplied identities. Project files must exist, be ordinary contained files and match sha256. Roles: prompt,story,cases,implementation,tests,evidence,notes. A report protocol may use a substantive summary without project files; proposal/work/verify need real files. A proposal requires its declared roles and independent native project testCommands. A verify protocol must preserve the accepted expectations and use the accepted argv plan; the runner executes those tests itself. Do not claim PASS from native exit or prose. Complete the real files required for this stage, write the closed handoff, and report the stage result. PDD observes this owned background conversation and independently validates the exact handoff, current files and required tests. Report the stage result and stop; no manual native exit is required. A model turn, idle state or handoff write alone does not advance the workflow. Do not launch the next stage or terminate PDD/the parent process. Current and prior artifacts remain inspectable. Canonical issue URL: ${s.issue.url}.`;
}
async function runAgent(s, stage, r, directory, options, p) {
  if (typeof p.runHerdrStage !== 'function' || typeof p.inspectHerdrStage !== 'function' || typeof p.closeHerdrStage !== 'function')
    fail('Background native run, inspection and cleanup ports are required.');
  await validateInput(s, options, p);
  if(!await validatedSelection(s,p))return result(s,'waiting','Needs you: the saved model/effort is unsupported; no stage was started.');
  if(!await machinePolicy(s,p))return result(s,'waiting','Needs you: machine account policy is unavailable.');
  const context = s.context,agent=s.actualTool??s.agent,launchSelection=s.backendSelection??s.launchSelection;
  await current(s, r, p);
  const handoffPath = join(directory, 'artifacts', `${stage.id}-${randomUUID()}.json`);
  const attemptId = randomUUID();
  const instructions = agentInstructions(s, stage, directory, attemptId, handoffPath, s.expected);
  s.pending = { kind: 'agent', stage: stage.id, attemptId,agent, input: s.expected, handoffPath, backend: null, instructions,
    promptDigest: digest(`${context}\n\n# Current workflow stage\n${instructions}`), transport: null };
  const guard = stageGuard(s,p), portOptions = nativePorts(s, directory, r, options, p);
  await guard({ runId: s.runId, cwd: s.root }, async () => { s.pending.attachmentEpoch = attachmentEpoch(s); });
  await record(s, directory, 'agent.intent');
  const previous = s.completed.filter(entry => entry.backend?.phase === 'closed').at(-1)?.backend;
  let outcome;
  try {
    outcome = await p.runHerdrStage({ runId: s.runId, stageId: stage.id, attemptId, agent, cwd: r.root,
      context, instructions, launchSelection, backendGen:s.backendGen ?? 1, backend: previous, checkpoint: portOptions.checkpoint }, portOptions);
    candidateIdentity(s, stage, outcome);
  } catch { return result(s, 'recovery_required', 'Background launch or delivery is uncertain; no automatic relaunch. Inspect the saved attempt.'); }
  s.pending.backend = structuredClone(outcome.backend); s.pending.transport = outcome;
  await record(s, directory, 'agent.transport');
  if(outcome.state!=='settled'){await activity(s,directory,p,outcome);if(outcome.quota)return quotaFlow(s,directory,p,outcome.quota);}
  if (outcome.state !== 'settled') return result(s, ['blocked','active'].includes(outcome.state) ? 'waiting' : 'recovery_required', outcome.reason || 'The original background stage needs inspection; no resend.');
  return acceptAgent(s, stage, r, directory, options, p, outcome);
}
async function missingHandoff(s,stage,r,directory,options,p,observed,outputInput) {
  const pending=s.pending,seq=observed.evidence.settledSeq,portOptions=nativePorts(s,directory,r,options,p);
  await sourceValid(s,r);
  await git(p,r.root,'merge-base','--is-ancestor',pending.input.head,'HEAD');
  if(!pending.handoffWait||pending.handoffWait.settledSeq!==seq) {
    const diagnostic=await (p.readSettledHerdrStageError??readSettledHerdrStageError)({backend:observed.backend},portOptions);
    const code=['busy_429','capacity','quota'].includes(diagnostic?.code)?diagnostic.code:'unknown';
    pending.handoffWait={settledSeq:seq,code,retryAt:(p.now??Date.now)()+60000,input:outputInput};
    await record(s,directory,'agent.handoff.wait');
    return handoffWaitResult(s);
  }
  const wait=pending.handoffWait;
  if(wait.retryAt!==null&&(p.now??Date.now)()<wait.retryAt&&!(wait.code==='unknown'&&options.decision==='approve'))return handoffWaitResult(s);
  if(wait.retryAt===null&&options.decision!=='approve')return handoffWaitResult(s);
  if(!isDeepStrictEqual(wait.input,outputInput))return result(s,'recovery_required','Stage work changed while waiting; inspect the original work before retrying.');
  if(wait.sent)return result(s,'waiting','Stage continuation delivery is uncertain; inspect the original stage. No duplicate was sent.');
  wait.sent=true;await record(s,directory,'agent.handoff.retry_intent');
  let next;
  try{next=await (p.retrySettledHerdrStage??retrySettledHerdrStage)({backend:observed.backend,settledSeq:seq},portOptions);candidateIdentity(s,stage,next);}
  catch{return result(s,'waiting','Stage continuation delivery is uncertain; inspect the original stage. No duplicate was sent.');}
  // Checkpoint owns identity transitions, including an uncertain delivery fence.
  await portOptions.checkpoint(next.backend);
  pending.transport=next;await record(s,directory,'agent.handoff.retry_observed');
  return result(s,'waiting',next.state==='active'?'Continuing the original stage; waiting for its handoff.':'Stage continuation is unconfirmed; inspect the original stage. No duplicate was sent.');
}
function handoffWaitResult(s) {
  const w=s.pending.handoffWait,label=s.pending.agent==='codex'?'Codex':'Claude';
  return result(s,'waiting',w.code==='unknown'?`The stage ended without a handoff. Work is preserved; PDD retries the stage at ${new Date(w.retryAt).toISOString()}. Resume with approve to continue sooner.`:`${label} is busy (${w.code==='busy_429'?'429':w.code}); PDD retries the stage at ${new Date(w.retryAt).toISOString()}.`);
}
async function acceptAgent(s, stage, r, directory, options, p, outcome) {
  const portOptions = nativePorts(s, directory, r, options, p);
  return portOptions.withStageGuard(outcome.backend, async () => {
    if (s.pending.attachmentEpoch !== attachmentEpoch(s)) {
      s.pending.attachmentEpoch = attachmentEpoch(s); s.pending.transport = null;
      await record(s, directory, 'agent.candidate.invalidated_by_attach');
      return result(s, 'waiting', 'Attachment invalidated the earlier candidate. Resume with approve to inspect and validate the same original attempt afresh.');
    }
    const observed = await p.inspectHerdrStage({ backend: outcome.backend, cwd: r.root }, portOptions);
    candidateIdentity(s, stage, observed);
    if (observed.state !== 'settled' || !isDeepStrictEqual(observed.evidence, outcome.evidence))
      return result(s, 'recovery_required', 'Native activity or identity changed before validation; the earlier candidate was not accepted.');
    await validateInput(s, options, p);
    await assignedRepository(s.assignment, p);
    const outputInput = await fingerprint(r, p);
    try { lstatSync(s.pending.handoffPath); }
    catch(error) {
      if(error.code==='ENOENT')return missingHandoff(s,stage,r,directory,options,p,observed,outputInput);
      throw error;
    }
  let h;
  try { h = await handoff(s, stage, r, directory); await sourceValid(s, r);
    await git(p, r.root, 'merge-base', '--is-ancestor', s.pending.input.head, 'HEAD'); }
  catch (error) { return result(s, 'failed', error.message); }
  if (stage.protocol === 'verify') {
    const plan = s.accepted?.testCommands;
    if (!plan?.length || h.testCommands.length && !isDeepStrictEqual(plan, h.testCommands)) return result(s, 'failed', 'Verification must execute the actual accepted native test plan.');
    s.pending.testCommands = plan; s.pending.executionInput = await fingerprint(r, p);
    await record(s, directory, 'test.intent');
    const checked = await runWorkflowTestCommands({ cwd: r.root, testCommands: plan }, p.commandPorts);
    h.checks = checked.results;
    s.pending.checks = checked.results;
    for (const check of checked.results) {
      p.stdout.write(String(check.stdout ?? '')); p.stderr.write(String(check.stderr ?? ''));
    }
    await record(s, directory, checked.passed ? 'test.completed' : 'test.failed');
    if (!checked.passed) return result(s, 'failed', 'A real native project check failed or could not run.');
    if (!isDeepStrictEqual(s.pending.executionInput, await fingerprint(r, p)))
      fail('Native checks changed their execution input; the changed result is not verified.');
  }
  const { checks, ...originalHandoff } = h;
  if (!isDeepStrictEqual(originalHandoff, await handoff(s, stage, r, directory))) fail('The exact workflow handoff changed during validation or native checks.');
  await git(p, r.root, 'merge-base', '--is-ancestor', s.pending.input.head, 'HEAD');
  await sourceValid(s, r);
  await assertWorkflowArtifacts({ cwd: r.root, files: h.files });
  await assignedRepository(s.assignment, p);
  s.expected = await fingerprint(r, p);
  if (stage.protocol === 'proposal') s.proposal = { approval: stage.approval, files: h.files.filter(f => stage.requiredRoles.includes(f.role)), testCommands: h.testCommands };
  if (!isDeepStrictEqual(outputInput, await fingerprint(r, p))) fail('Stage output changed during validation; the changed result is not accepted.');
  const finalObservation = await p.inspectHerdrStage({ backend: observed.backend, cwd: r.root }, portOptions);
  candidateIdentity(s, stage, finalObservation);
  if (finalObservation.state !== 'settled' || !isDeepStrictEqual(finalObservation.evidence, observed.evidence))
    fail('Native state changed during validation; no acceptance or cleanup.');
  const evidenceRecord = { runId: s.runId, stageId: stage.id, attemptId: s.pending.attemptId,
    backend: finalObservation.backend, handoff: h, handoffSha256: digest(readFileSync(s.pending.handoffPath)),
    output: s.expected, accepted: s.accepted ?? null, checks: h.checks ?? [] };
  const acceptance = { runId: s.runId, stageId: stage.id, attemptId: s.pending.attemptId,
    promptDigest: s.pending.backendPromptDigest??s.pending.promptDigest, terminalId: finalObservation.backend.terminalId, backendGen:finalObservation.backend.backendGen ?? s.backendGen ?? 1,
    evidenceDigest: digest(JSON.stringify(evidenceRecord)) };
  const verification = stage.protocol === 'verify' ? { output: s.expected, testCommands: s.accepted.testCommands,
    evidenceDigest: acceptance.evidenceDigest } : null;
  s.pending = { ...s.pending, kind: 'cleanup', backend: finalObservation.backend, handoff: h, acceptance, evidenceRecord, verification };
  await record(s, directory, 'agent.accepted');
  return cleanupAgent(s, stage, r, directory, options, p, true);
  });
}
async function cleanupAgent(s, stage, r, directory, options, p, advance) {
  if (!advance) return result(s, 'waiting', 'The stage is accepted; resume with approve for its original owned cleanup.');
  const portOptions = nativePorts(s, directory, r, options, p);
  return portOptions.withStageGuard(s.pending.backend, async () => {
    await current(s, r, p);
    await assertWorkflowArtifacts({ cwd: r.root, files: s.pending.handoff.files });
    if (digest(JSON.stringify(s.pending.evidenceRecord)) !== s.pending.acceptance.evidenceDigest
      || digest(readFileSync(s.pending.handoffPath)) !== s.pending.evidenceRecord.handoffSha256)
      fail('The accepted stage evidence or closed handoff changed before cleanup.');
    if (s.pending.backend.phase !== 'closed') {
      if (s.pending.backend.phase !== 'candidate') return result(s, 'recovery_required', 'Original cleanup may already have happened. Inspect it; no blind repeat.');
      const closed = await p.closeHerdrStage({ backend: s.pending.backend, acceptance: s.pending.acceptance }, portOptions);
      if (closed.state !== 'closed' || closed.backend?.phase !== 'closed') return result(s, 'recovery_required', closed.reason || 'Owned cleanup is uncertain; no stage was resent.');
      if (!isDeepStrictEqual(closed.backend, s.pending.backend)) fail('Owned closure was not checkpointed with its exact actual identity.');
    }
    s.completed.push({ id: stage.id, kind: stage.kind, handoff: s.pending.handoff,
      revision: s.expected.head, backend: s.pending.backend, acceptance: s.pending.acceptance, verification: s.pending.verification });
    s.pending = null; s.index++; await record(s, directory, 'agent.completed');
    return null;
  });
}

async function completePr(s, stage, intent, pr, directory) {
  s.completed.push({ id: stage.id, kind: stage.kind, pr, intent });
  s.pending = null; s.index++; await record(s, directory, 'pr.completed');
}
async function makePr(s, stage, r, directory, p) {
  // Scanning is advisory; redacted findings never certify tests or repeat publication.

  await current(s, r, p);
  if (stage.publication === 'verified') {
    const checked = s.completed.findLast(entry => s.definitions.find(definition => definition.id === entry.id)?.protocol === 'verify');
    const verification = checked?.verification, plan = s.accepted?.testCommands;
    const checkpoint = s.artifactCommits?.findLast(entry => entry.stage === stage.id);
    const verifiedInput = isDeepStrictEqual(verification?.output, s.expected)
      || checkpoint && isDeepStrictEqual(verification?.output, checkpoint.previous)
        && isDeepStrictEqual(checkpoint.current, s.expected) && checkpoint.evidenceDigest === verification?.evidenceDigest;
    if (!verification || !verifiedInput
      || !isDeepStrictEqual(verification.testCommands, plan) || !plan?.length
      || checked.handoff?.checks?.length !== plan.length || checked.handoff.checks.some(check => check.exitCode !== 0)
      || verification.evidenceDigest !== checked.acceptance?.evidenceDigest)
      fail('Verified publication requires successful accepted checks for this exact current source revision and worktree.');
  }
  for (const merged of s.completed.filter(entry => entry.mergeCommit && (!stage.requiresMerge || entry.id === stage.requiresMerge)))
    await git(p, r.root, 'merge-base', '--is-ancestor', merged.mergeCommit, 'HEAD');
  const files = structuredClone(s.accepted?.files ?? []);
  await assertWorkflowArtifacts({cwd:r.root, files:s.completed.flatMap(step => step.handoff?.files ?? []).filter((file, index, all) =>
    all.findLastIndex(other => other.path === file.path) === index)});
  const previous = structuredClone(s.expected);
  s.artifactCommitIntent = {stage:stage.id, previous, files, headBranch:s.assignment.branch};
  await record(s, directory, 'publication.artifacts.intent');
  const checkpoint = await commitWorkflowArtifacts({cwd:r.root,runId:s.runId,stageId:stage.id,
    headBranch:s.assignment.branch,baseBranch:s.base,expectedHead:previous.head,files},p.commandPorts);
  await assertWorkflowArtifacts({cwd:r.root, files:s.completed.flatMap(step => step.handoff?.files ?? []).filter((file, index, all) =>
    all.findLastIndex(other => other.path === file.path) === index)});
  await assignedRepository(s.assignment,p);
  const updated = await fingerprint(r,p);
  if (updated.head !== checkpoint.headSha) fail('Artifact checkpoint source changed before recording.');
  if (checkpoint.headSha !== previous.head) {
    const checked = s.completed.findLast(entry => s.definitions.find(definition => definition.id === entry.id)?.protocol === 'verify');
    s.artifactCommits ??= [];
    s.artifactCommits.push({stage:stage.id,previous,current:updated,files,committedPaths:checkpoint.committedPaths,
      evidenceDigest:checked?.verification?.evidenceDigest ?? null});
  } else if (!isDeepStrictEqual(previous,updated)) fail('Artifact checkpoint changed the saved source input.');
  s.expected = updated; s.artifactCommitIntent = null;
  await record(s,directory,'publication.artifacts.committed');
  const work = s.completed.findLast(entry => s.definitions.find(definition => definition.id === entry.id)?.protocol === 'work');
  const proposal = s.completed.findLast(entry => s.definitions.find(definition => definition.id === entry.id)?.protocol === 'proposal');
  const checked = stage.publication === 'verified'
    ? s.completed.findLast(entry => s.definitions.find(definition => definition.id === entry.id)?.protocol === 'verify') : null;
  const description = {issue:s.issue, summary:(work ?? proposal)?.handoff?.summary,
    checks:(checked?.handoff?.checks ?? []).map(({argv,exitCode}) => ({argv,exitCode}))};
  const intent = await prepareWorkflowPr({ cwd: r.root, runId: s.runId, stageId: stage.id,
    repository: s.repo, baseBranch: s.base, bodyFile: join(directory, `pr-${stage.id}.md`), description }, p.commandPorts);
  if(typeof p.scanWorkflowPublication==='function'){
    let scan;try{scan=await p.scanWorkflowPublication({cwd:r.root,headSha:intent.headSha,stageId:stage.id,runId:s.runId});}catch{scan={verified:false};}
    if(scan?.findings?.length||scan?.verified===false){const warning=scan?.findings?.length?'Needs you: advisory secret scan found possible sensitive content. Review this publication; matched values are redacted.':'Advisory secret scan unavailable; publication input is unverified by that scan.';
      const body=readFileSync(intent.bodyFile,'utf8');const fd=openSync(intent.bodyFile,constants.O_WRONLY|constants.O_TRUNC|constants.O_NOFOLLOW);try{writeSync(fd,body+'\n'+warning+'\n');fsyncSync(fd);}finally{closeSync(fd);}
      s.publicationAdvisory={stage:stage.id,needsYou:!!scan?.findings?.length,verified:scan?.verified!==false};await record(s,directory,'publication.advisory');}}
  await current(s, r, p);
  s.pending = { kind: 'pr', stage: stage.id, intent }; await record(s, directory, 'pr.intent');
  let outcome;
  try { outcome = await publishWorkflowPr({ cwd: r.root, intent }, p.commandPorts); }
  catch { return result(s, 'recovery_required', 'PR effect is uncertain; no blind resend.'); }
  if (['open', 'merged'].includes(outcome.state) && outcome.pr) {
    await current(s, r, p);
    await completePr(s, stage, intent, outcome.pr, directory); return null;
  }
  return result(s, outcome.state === 'failed' ? 'failed' : 'recovery_required', outcome.message);
}
async function reconcile(s, r, directory, options, p, canAdvance) {
  const stage = s.definitions[s.index];
  if (s.pending.kind === 'cleanup') return cleanupAgent(s, stage, r, directory, options, p, canAdvance);
  if (s.pending.kind === 'agent') {
    if (!s.pending.backend || typeof p.inspectHerdrStage !== 'function') return result(s, 'recovery_required', 'Original native identity is incomplete; no replacement was started.');
    const portOptions = nativePorts(s, directory, r, options, p);
    let seen;
    if (canAdvance && ['start_intent', 'ready'].includes(s.pending.backend.phase)) {
      if (typeof p.runHerdrStage !== 'function') fail('The original first-dispatch port is unavailable.');
      const instructions = s.pending.instructions ?? agentInstructions(s, stage, directory,
        s.pending.attemptId, s.pending.handoffPath, s.pending.input);
      if (typeof instructions !== 'string' || digest(`${s.context}\n\n# Current workflow stage\n${instructions}`) !== s.pending.promptDigest)
        fail('The original stage request bytes cannot be proved; no first dispatch was attempted.');
      await current(s, r, p);
      try {
        seen = await p.runHerdrStage({ runId: s.runId, stageId: stage.id, attemptId: s.pending.attemptId,
          agent:s.pending.agent??s.agent, cwd: r.root, context: s.context, instructions, launchSelection:s.pending.backend.launchSelection??s.launchSelection??null, backendGen:s.backendGen ?? 1, backend: s.pending.backend,
          checkpoint: portOptions.checkpoint }, portOptions);
        candidateIdentity(s, stage, seen);
      } catch { return result(s, 'recovery_required', 'Original first dispatch is unconfirmed; preserve this same attempt for inspection.'); }
      s.pending.backend = structuredClone(seen.backend); s.pending.transport = seen;
      await record(s, directory, 'agent.transport');
    } else {
      const inspect=async()=>{
        const value=await p.inspectHerdrStage({backend:s.pending.backend,cwd:r.root},portOptions);
        candidateIdentity(s,stage,value);
        if(canAdvance&&s.pending.handoffWait&&['active','settled','blocked'].includes(value.state))await portOptions.checkpoint(value.backend);
        return value;
      };
      seen=canAdvance&&s.pending.handoffWait?await portOptions.withStageGuard(s.pending.backend,inspect):await inspect();
      s.pending.transport=structuredClone(seen);
    }
    if(seen.state!=='settled'){await activity(s,directory,p,seen);if(s.quota||seen.quota)return quotaFlow(s,directory,p,seen.quota??{type:'recover',turnKey:s.quota.turnKey});
      if(canAdvance){const recovered=await recoverStage(s,r,directory,options,p,seen);if(recovered)return recovered;}}
    if (seen.state !== 'settled') return result(s, ['blocked','active'].includes(seen.state) ? 'waiting' : 'recovery_required', s.stall?.alarmed?'Needs you: stage idle without rollout growth for 30 minutes; original work retained.':seen.reason || 'Original native stage remains unresolved.');
    if (!canAdvance) return result(s, 'waiting', 'Original stage has a candidate handoff. Resume with approve to validate that same attempt; inspection alone starts nothing.');
    return acceptAgent(s, stage, r, directory, options, p, seen);
  }
  try {
    let outcome = await reconcileWorkflowPr({ cwd: r.root, intent: s.pending.intent }, p.commandPorts);
    if (outcome.state === 'recovery_required' && canAdvance) {
      await current(s, r, p);
      await record(s, directory, 'pr.unpublished_retry_intent');
      outcome = await publishWorkflowPr({ cwd: r.root, intent: s.pending.intent, unpublishedOnly: true }, p.commandPorts);
    }
    if (!['open', 'merged'].includes(outcome.state) || !outcome.pr)
      return result(s, 'recovery_required', outcome.message || 'The exact original PR was not proved; no effect was repeated.');
    await current(s, r, p);
    await completePr(s, stage, s.pending.intent, outcome.pr, directory);
    return result(s, 'waiting', 'Original PR reconciled. Resume without a decision to observe merge, or with approve to advance.');
  } catch { return result(s, 'recovery_required', 'Original PR recovery is unconfirmed; preserve this same intent for inspection.'); }
}
async function advance(s, r, directory, options, p, decision, initial) {
  authority(s, r);
  const priorProposal = !s.pending ? s.proposal : null;
  const next = s.definitions[s.index];
  if (!s.pending && options.decision === 'approve' && next?.requiresMerge
    && s.completed.some(entry => entry.id === next.requiresMerge && entry.mergeCommit)) {
    const fresh = await fingerprint(r, p);
    if (!isDeepStrictEqual(fresh, s.expected)) {
      if (await git(p, r.root, 'status', '--porcelain=v1', '--untracked-files=all')) fail('The assigned code worktree must be clean and preserve accepted artifacts.');
      await sourceValid(s, r);
      const merged = s.completed.find(entry => entry.id === next.requiresMerge);
      await git(p, r.root, 'merge-base', '--is-ancestor', merged.mergeCommit, 'HEAD');
      const previous = s.expected; s.expected = fresh;
      s.inputTransitions ??= []; s.inputTransitions.push({ previous, current: fresh, reason: 'merged_proposal_base' });
      await record(s, directory, 'human.merged_base.accepted');
    }
  }
  if (s.pending?.kind === 'agent') { await sourceValid(s, r); await git(p, r.root, 'merge-base', '--is-ancestor', s.pending.input.head, 'HEAD'); }
  else await current(s, r, p);
  if (s.pending) {
    const stop = await reconcile(s, r, directory, options, p, decision === 'approve');
    if (stop) return stop;
  }
  let canAdvance = initial || decision === 'approve' || decision === 'skip';
  let choice = decision;
  while (s.index < s.definitions.length) {
    await current(s, r, p);
    const stage = s.definitions[s.index];
    if (choice === 'skip' && !stage.optional) fail('Only an optional current stage may be skipped.');
    if (stage.optional) {
      let selected = s.optional?.[stage.id];
      if (!selected) {
        if (!choice) return result(s, 'waiting', 'Optional step: resume with --decision approve to run it or --decision skip to omit it.');
        s.optional ??= {}; selected = { decision: choice, input: s.expected };
        s.optional[stage.id] = selected; await record(s, directory, 'optional.decision');
      }
      if (!['approve', 'skip'].includes(selected.decision) || !isDeepStrictEqual(selected.input, s.expected))
        fail('The saved optional decision does not match the current input.');
      if (selected.decision === 'approve' && choice === 'skip') fail('A durable optional approval cannot be replaced; inspect the saved choice before effects.');
      choice = undefined;
      if (selected.decision === 'skip') {
        s.completed.push({ id: stage.id, kind: stage.kind, skipped: true, input: selected.input }); s.index++;
        await record(s, directory, 'optional.skipped'); continue;
      }
    }
    if (stage.kind === 'human') {
      if (choice !== 'approve') return result(s, 'waiting', 'Review the exact current proposal artifacts, independent expectations and test plan. Resume with --decision approve to accept this input.');
      if (!s.proposal?.files.length || !s.proposal.testCommands.length) fail('A complete independent proposal and test plan is required before approval.');
      await assertWorkflowArtifacts({ cwd: r.root, files: s.proposal.files });
      s.accepted = { ...s.proposal, input: s.expected };
      s.completed.push({ id: stage.id, kind: stage.kind, input: s.expected }); s.index++;
      await record(s, directory, 'human.approved'); choice = undefined; continue;
    }
    if (stage.kind === 'merge') {
      const prior = s.completed.find(step => step.id === stage.prStage);
      if (prior?.skipped) { s.completed.push({ id: stage.id, kind: stage.kind, skipped: true }); s.index++; await record(s, directory, 'merge.skipped'); continue; }
      if (!prior?.pr) fail('No original PR is saved for this merge step.');
      const outcome = await reconcileWorkflowPr({ cwd: r.root, intent: prior.intent }, p.commandPorts);
      if (outcome.pr && (outcome.pr.number !== prior.pr.number || outcome.pr.url !== prior.pr.url))
        return result(s, 'recovery_required', 'The observed PR is not the saved original PR number and URL; no merge accepted.');
      if (outcome.state === 'open') return result(s, 'waiting', `Waiting for actual merge of ${prior.pr.url}. No merge action performed.`);
      if (outcome.state !== 'merged' || !outcome.pr) return result(s,
        outcome.state === 'closed' || outcome.state === 'failed' ? 'failed' : 'recovery_required', outcome.message);
      const mergeCommit = outcome.pr.mergeCommit;
      if (!/^[a-f0-9]{40,64}$/.test(mergeCommit ?? '')) fail('Actual merged revision was not supplied by GitHub.');
      s.completed.push({ id: stage.id, kind: stage.kind, pr: outcome.pr, mergeCommit }); s.index++;
      await record(s, directory, 'merge.observed');
      if (!canAdvance) return result(s, s.index === s.definitions.length ? 'completed' : 'waiting', 'Actual merge observed; no new stage was launched. Resume with approve to advance.');
      continue;
    }
    if (!canAdvance) return result(s, 'waiting', 'Saved input is current. Resume with --decision approve to advance; inspection alone launches nothing.');
    if (s.proposal?.approval === 'next-advance' && !s.accepted) {
      if (s.proposal !== priorProposal || decision !== 'approve')
        return result(s, 'waiting', 'Review the independent proposal and test plan; resume with approve to advance.');
      if (!s.proposal.files.length || !s.proposal.testCommands.length) fail('A complete independent proposal and test plan is required.');
      s.accepted = { ...s.proposal, input: s.expected }; await record(s, directory, 'proposal.accepted');
    }
    if (stage.requiresMerge) {
      const merged = s.completed.find(entry => entry.id === stage.requiresMerge);
      if (!merged?.skipped) {
        if (!merged?.mergeCommit) fail('The required original PR merge is not recorded.');
        try { await git(p, r.root, 'merge-base', '--is-ancestor', merged.mergeCommit, 'HEAD'); }
        catch { return result(s, 'waiting', 'Work needs the exact merged proposal revision in its assigned branch. No checkout or base rewrite was performed.'); }
      }
    }
    const stopped = stage.kind === 'agent' ? await runAgent(s, stage, r, directory, options, p)
      : await makePr(s, stage, r, directory, p);
    if (stopped) return stopped;
    choice = undefined;
  }
  return result(s, 'completed', 'All listed steps completed with their recorded artifacts, checks and merge observations.');
}
function canonicalOverview(packageRoot) {
  const root = realpathSync(packageRoot), path = join(root, 'docs', 'workflows.md');
  requireDirectory(join(root, 'docs'));
  journalFile(path);
  return readFileSync(path, 'utf8');
}
function snapshotDigest(input) {
  return digest(JSON.stringify({ ...(input.startRequestBinding?{startRequestBinding:input.startRequestBinding}:{}),runId: input.runId, sourceRoot: input.sourceRoot,
    definition: input.definition, baseContext: input.baseContext, overview: input.overview }));
}
function inputDirectory(commonDir, runId) { return join(commonDir, 'pdd', 'workflow-inputs', runId); }
function saveInput(input, commonDir) {
  ensureDirectory(join(commonDir, 'pdd'));
  const parent = join(commonDir, 'pdd', 'workflow-inputs'); ensureDirectory(parent);
  const directory = inputDirectory(commonDir, input.runId);
  if (existsSync(directory)) fail('Run input identity already exists; inspect it without overwriting.');
  ensureDirectory(directory); syncDirectory(parent);
  durable(join(directory, 'input.jsonl'), { ...input, digest: snapshotDigest(input) });
}
function readInput(commonDir, runId) {
  const directory = inputDirectory(commonDir, runId); requireDirectory(directory);
  const path = join(directory, 'input.jsonl'); journalFile(path);
  const bytes = readFileSync(path, 'utf8');
  if (!bytes.endsWith('\n') || bytes.trimEnd().split('\n').length !== 1) fail('Saved run input is incomplete.');
  const input = json(bytes);
  if (input.runId !== runId || input.digest !== snapshotDigest(input)) fail('Saved workflow/context snapshot changed.');
  return input;
}
async function validateInput(s, options, p) {
  const input = readInput(s.assignment.commonDir, s.runId);
  if (input.digest !== s.inputDigest || !isDeepStrictEqual(input.definition, s.definition)) fail('Saved workflow snapshot does not match its run.');
  if(s.p1){const checked=await (p.checkWorkflowRuntime ?? (await import('./workflow-runtime.mjs')).checkWorkflowRuntime)({runDir:join(s.gitDir,'pdd','workflows',s.runId)},{...p,readWorkflowJournal});if(!checked?.ok)throw Object.assign(Error(checked?.message??checked?.code??'Frozen runtime input changed.'),checked?.code==='herdr_not_found'?{code:checked.code}:{});}
  const context = stageContext(input, s.root);
  if (s.context !== context || s.contextDigest !== digest(context)) fail('Saved full stage context changed.');
}
function stageContext(input, cwd) {
  const base = input.baseContext.replace(`Current project: ${input.sourceRoot}`, `Original source project: ${input.sourceRoot}`);
  return [base, `Current assigned project: ${cwd}`, input.overview,
    `Selected workflow snapshot: ${input.definition.name} / ${input.definition.digest}`,
    ...input.definition.files.map(file => `--- .pdd/workflows/${input.definition.name}/${file.path} ---\n${file.content}`)].join('\n\n');
}
async function assignmentFor(options, p, resume, runId, binding) {
  const module = (!p.allocateIssueWorktree || !p.lookupIssueWorktree) ? await import('./workflow-worktree.mjs') : null;
  const response = resume
    ? await (p.lookupIssueWorktree ?? module.lookupIssueWorktree)({ cwd: options.cwd, runId }, p.commandPorts)
    : await (p.allocateIssueWorktree ?? module.allocateIssueWorktree)({ cwd: options.cwd,
      repository: binding.repository, issueNumber: binding.issue.number, runId,
      workflowName: options.name, baseRef: `refs/remotes/origin/${binding.defaultBranch}` }, p.commandPorts);
  return response?.assignment ? response : { ...response, assignment: null };
}
async function conflictingAssignment(source, binding, options, p, provided) {
  if (provided) return provided;
  // Allocation may report the exclusive issue conflict without a ready assignment.
  // The documented claim discovers only a run ID; helper lookup proves custody.
  let parent = source.commonDir;
  for (const part of ['pdd', 'worktree-assignments', 'issues']) {
    parent = join(parent, part); requireDirectory(parent);
  }
  const path = join(parent, `${binding.issue.number}.json`), before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 2 || realpathSync(path) !== path)
    fail('The original issue claim is not an ordinary owned metadata record.');
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let claim;
  try {
    const opened = fstatSync(fd);
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.nlink !== 2 || opened.size > 65536)
      fail('The original issue claim changed before discovery.');
    const raw = readFileSync(fd, 'utf8'), after = lstatSync(path), finished = fstatSync(fd);
    if (!raw.endsWith('\n') || [after, finished].some(stat => stat.dev !== opened.dev || stat.ino !== opened.ino
      || stat.nlink !== 2 || stat.size !== opened.size || stat.mtimeMs !== opened.mtimeMs || stat.ctimeMs !== opened.ctimeMs))
      fail('The original issue claim changed during discovery.');
    claim = json(raw);
  } finally { closeSync(fd); }
  if (!UUID.test(claim.runId ?? '') || claim.commonDir !== source.commonDir
    || claim.repository !== binding.repository || claim.issueNumber !== binding.issue.number)
    fail('The original issue claim does not match this repository and issue.');
  const found = await assignmentFor(options, p, true, claim.runId);
  if (found.state !== 'ready' || !found.assignment || found.assignment.runId !== claim.runId
    || found.assignment.commonDir !== source.commonDir || found.assignment.repository !== binding.repository
    || found.assignment.issueNumber !== binding.issue.number)
    fail('The original claimed worktree is not ready; inspect that saved run without allocating again.');
  return found.assignment;
}
async function assignedRepository(assignment, p) {
  if (!assignment || assignment.version !== 1 || !UUID.test(assignment.runId)
    || !text(assignment.repository) || !text(assignment.worktreePath)) fail('A verified issue worktree assignment is required.');
  const r = await repository(assignment.worktreePath, p);
  if (r.root !== assignment.worktreePath || r.gitDir !== assignment.gitDir || r.commonDir !== assignment.commonDir
    || await git(p, r.root, 'symbolic-ref', '--quiet', '--short', 'HEAD') !== assignment.branch)
    fail('Actual issue worktree identity changed.');
  await git(p, r.root, 'merge-base', '--is-ancestor', assignment.baseSha, 'HEAD');
  return r;
}
function preparedReceipt(s,directory) {
  return {state:'prepared',runId:s.runId,runDir:directory,root:s.root,runtime:s.runtime,workflow:s.name,issueNumber:s.issue.number,message:`prepared: run ${s.runId}. Frozen inputs and assignment saved; no agent started.`};
}
async function validatedSelection(s,p) {
  const agent=s.actualTool??s.agent,selection=s.backendSelection??s.launchSelection;
  if(!selection || selection.agent!==agent)return false;
  try {
    const resolveModel=p.resolveWorkflowModel??(await import('./workflow-models.mjs')).resolveWorkflowLaunchModel;
    const selected=await resolveModel({machineId:selection.machineId,agent,frozenSelection:selection,selection:selection.model===null?undefined:{model:selection.model,...(selection.effort==null?{}:{effort:selection.effort})}},p);
    return selected?.state==='selected' && selected.selection.agent===agent && selected.selection.model===selection.model && selected.selection.effort===selection.effort;
  }catch{return false;}
}
async function machinePolicy(s,p) {
  if(!p.readMachineToolPolicy)return true;
  const tool=s.actualTool??s.agent;
  const policy=await p.readMachineToolPolicy({machineId:s.machineId,tool});
  if(!policy||policy.machineId!==s.machineId||policy.tool!==tool||!Number.isSafeInteger(policy.revision)||policy.revision<1||!['auto','fixed'].includes(policy.mode))return false;
  // An observation cannot restore historical per-run account preferences.
  s.machineToolPolicy=structuredClone(policy);s.accountTransition=policy.transition??null;
  return true;
}
async function activity(s,directory,p,seen) {
  const b=s.pending?.backend;if(!b)return;
  if(seen?.questionLost===true){s.controlState='question_lost';await record(s,directory,'question_lost');return;}
  if(!p.observeWorkflowActivity)return;
  const sample=await p.observeWorkflowActivity({backend:structuredClone(b)}),now=(p.now??Date.now)();
  const prior=s.stall,identity=`${b.attemptId}/${b.backendGen}`;
  if(!sample?.observable||sample.sleeping||sample.dialog||!sample.idle||!Number.isSafeInteger(sample.rolloutBytes)||s.quota||s.waitingPerson||seen?.reason==='stage_temporarily_guarded') {
    s.stall=null;if(prior)await record(s,directory,'stall.cleared');return;
  }
  if(!prior||prior.identity!==identity||sample.rolloutBytes!==prior.rolloutBytes||now<prior.lastAt){s.stall={identity,rolloutBytes:sample.rolloutBytes,idleSince:now,lastAt:now,savedAt:now,alarmed:false};await record(s,directory,'stall.sample');return;}
  // Wall-clock gaps include sleep/controller downtime and never count as idle samples.
  if(now-prior.lastAt>90000){s.stall={...prior,idleSince:now,lastAt:now,savedAt:now,alarmed:false};await record(s,directory,'stall.sample');return;}
  s.stall.lastAt=now;
  if(now-prior.idleSince>=30*60000&&!prior.alarmed){s.stall.alarmed=true;await record(s,directory,'stall.alarm');}
  else if(now-(prior.savedAt??0)>=60000){s.stall.savedAt=now;await record(s,directory,'stall.sample');}
}
async function quotaHandoffInput(s,p) {
  const files=s.accepted?.files??[];await assertWorkflowArtifacts({cwd:s.root,files});
  const contractFiles=files.map(file=>{const content=readFileSync(join(s.root,file.path),'utf8');if(digest(content)!==file.sha256.toLowerCase())fail('Accepted contract bytes changed.');return {...file,content};});
  const status=await command(p,s.root,'git',['status','--porcelain=v1','--untracked-files=all'],true);
  const diffStat=await command(p,s.root,'git',['diff','--stat',s.pending.input.head,'--'],true);
  const names=new Set([
    ...(await command(p,s.root,'git',['diff','--name-only','-z',s.pending.input.head,'--'],true)).split('\0').filter(Boolean),
    ...(await command(p,s.root,'git',['ls-files','--others','--exclude-standard','-z'],true)).split('\0').filter(Boolean)]);
  const changes=[...names].sort().map(path=>{const full=resolve(s.root,path);if(!contained(s.root,full))fail('A changed path escaped the assigned worktree.');
    if(!existsSync(full))return {path,deleted:true};const stat=lstatSync(full);return {path,symlink:stat.isSymbolicLink(),sha256:digest(stat.isSymbolicLink()?readlinkSync(full):readFileSync(full))};});
  return {cwd:s.root,tab:s.pending.backend.tabId,stage:s.definitions[s.index],
    frozen:{instructions:s.pending.instructions,guide:s.context,guideDigest:s.contextDigest,workflowDigest:s.definition.digest,decisions:s.decisions??[],contractFiles,
      requiredResult:{path:s.pending.handoffPath,schema:{version:1,required:['version','runId','stageId','issueUrl','inputRevision','summary','files'],optional:['testCommands'],file:{path:'contained relative path',sha256:'actual SHA256',role:['prompt','story','cases','implementation','tests','evidence','notes']},identities:{runId:s.runId,stageId:s.pending.stage,issueUrl:s.issue.url,inputRevision:s.pending.input.head}}}},
    effects:{completed:s.completed,uncertain:s.pending.effects??[],changes,status,diffStat,historyPaths:[join(s.gitDir,'pdd','workflows',s.runId,'journal.jsonl'),s.pending.handoffPath]}};
}

async function quotaFlow(s,directory,p,event) {
  const b=s.pending?.backend;
  if(!b||!event?.turnKey)return result(s,'waiting','Needs you: quota context is unproved; all work retained.');
  if(!p.advanceQuota||!p.quotaPorts||!await machinePolicy(s,p))return result(s,'waiting','Needs you: native account limit; account recovery is unavailable. All work retained.');
  const policy=s.machineToolPolicy;if(!policy)return result(s,'waiting','Needs you: machine account policy is unavailable.');
  const input={...event,runId:s.runId,machineId:s.machineId,attempt:s.pending.attemptId,tool:b.agent,backendGen:b.backendGen,account:s.actualAccount,
    provider:b.provider??b.agent,mode:policy.mode==='auto'?'auto':`account:${policy.accountId}`,whenOut:policy.whenOut??'ask',
    handoffInput:{...(event.handoffInput??{}),...await quotaHandoffInput(s,p),context:s.context,instructions:s.pending.instructions,stageInput:s.pending.input,
      accepted:s.accepted??null,handoffPath:s.pending.handoffPath,priorEvidence:s.completed,completedEffects:s.completed,uncertainEffects:s.pending.effects??[],changes:await fingerprint({root:s.root},p)}};
  const append=async next=>{
    if(next.runId!==s.runId||next.attempt!==s.pending.attemptId||next.turnKey!==input.turnKey||next.tool!==b.agent||next.machineId!==s.machineId)fail('Quota identity changed.');
    if(next.state==='waiting_person'&&next.rev!==s.seq+1)fail('Quota wait revision changed.');
    s.quota=structuredClone(next);
    s.controlState=next.state==='WAIT'?'WAIT':next.state==='waiting_person'?'waiting_person':'quota_wait';
    if(next.state==='waiting_person') {s.rev=next.rev;s.waitingPerson={rev:next.rev,stage:s.pending.stage,inputRevision:s.pending.input.head,
      artifactHashes:(s.accepted?.files??[]).map(({path,sha256})=>({path,sha256})),origin:'quota',questionId:next.questionId,
      decisions:next.kind==='fixed_full'?['wait']:['continue','wait'],what:next.kind==='fixed_full'?'Use Auto / Pick another account / Wait until the renewal':'Continue in the other tool or wait'};}
    else if(s.waitingPerson?.origin==='quota'){s.waitingPerson=null;s.rev=null;}
    await record(s,directory,next.state);
  };
  const accountPorts={...p.quotaPorts,now:p.now??Date.now,append,waitRevision:async()=>s.seq+1};
  // The account owner decides policy; the controller retains binding and durable successor identity.
  for(const name of ['swapAtBoundary','sendHandoffOnce'])if(p.quotaPorts[name])accountPorts[name]=async value=>{
    if(!await machinePolicy(s,p)||s.machineToolPolicy.revision!==policy.revision)return {state:'refused',code:'stale_policy'};
    if(await p.quotaPorts.inspectEffects?.(s.quota)!==true)return {state:'refused',code:'effects_unproved'};
    if(name==='sendHandoffOnce'){
      if(s.quota?.state!=='handoff_intent'||!isDeepStrictEqual(value.key,[s.pending.attemptId,input.turnKey,value.targetTool]))return {state:'refused',code:'send_binding_unproved'};
      const resolveModel=p.resolveWorkflowModel??(await import('./workflow-models.mjs')).resolveWorkflowLaunchModel;
      const selected=await resolveModel({machineId:s.machineId,agent:value.targetTool},p);
      if(selected?.state!=='selected'||selected.selection.agent!==value.targetTool)return {state:'refused',code:'target_model_unsupported'};
      s.pending.handoffSelection=structuredClone(selected.selection);await record(s,directory,'handoff.model.intent');value={...value,launchSelection:s.pending.handoffSelection};
    }
    const next=await p.quotaPorts[name](value);
    if(['resumed','sent','already_sent'].includes(next?.state)) {
      const successor=next.backend;
      if(!successor||successor.runId!==s.runId||successor.stageId!==b.stageId||successor.attemptId!==b.attemptId||successor.backendGen!==b.backendGen+1||successor.cwd!==s.root)fail('Quota successor identity is unproved.');
      if(successor.agent!==b.agent && (!isDeepStrictEqual(successor.launchSelection,s.pending.handoffSelection)||successor.nativeSession?.kind!=='id'||successor.nativeSession.value===b.nativeSession?.value))fail('Cross-tool selection or fresh chat is unproved.');
      if(successor.agent===b.agent&&(!isDeepStrictEqual(successor.nativeSession,b.nativeSession)||!isDeepStrictEqual(successor.launchSelection,b.launchSelection)))fail('Same-tool native identity or model changed.');
      if(b.provider&&successor.provider!==b.provider)fail('Saved provider identity changed.');
      s.pending.backendPromptDigest=successor.promptDigest;
      s.pending.backend=structuredClone(successor);s.pending.agent=successor.agent;s.backendGen=successor.backendGen;s.actualTool=successor.agent;s.backendSelection=successor.launchSelection;s.actualAccount=successor.actualAccount??null;
      await record(s,directory,'backend.successor');
    }
    return next;
  };
  if(p.quotaPorts.sendKeys)accountPorts.sendKeys=async value=>{
    if(s.quota?.state!=='continuation_sent'||!isDeepStrictEqual(value.key,[s.pending.attemptId,input.turnKey])||value.state?.backendGen!==s.pending.backend.backendGen)return {state:'refused',code:'send_binding_unproved'};
    return p.quotaPorts.sendKeys(value);
  };
  const response=await p.advanceQuota(input,s.quota,accountPorts);
  if(s.quotaAdmission){s.quotaAdmission=null;await record(s,directory,'quota.answer.consumed');}
  if(response?.state?.state==='working'){s.quota=null;s.controlState='waiting_agent';await record(s,directory,'quota.working');}
  return result(s,'waiting',response?.action?.kind==='WAIT'&&s.quota?.until==null?'renewal time unknown':`Needs you: ${s.waitingPerson?.what??'quota recovery retained; inspect the original stage'}.`);
}
async function recoverStage(s,r,directory,options,p,seen) {
  const pending=s.pending,b=pending.backend;
  if(pending.recoveryContinuation) {
    const found=await p.inspectWorkflowRecoveryContinuation?.({backend:b,key:pending.recoveryContinuation.key});
    if(found!=='found')return result(s,'waiting','Needs you: recovery continuation delivery is uncertain; no resend.');
    return null;
  }
  if(!p.proveWorkflowRecovery||!p.reconcileWorkflowEffects||!p.resumeHerdrStage)return null;
  const proof=await p.proveWorkflowRecovery({backend:structuredClone(b),promptDigest:pending.promptDigest});
  if(proof?.live===true)return null;
  if(proof?.questionLost){s.controlState='question_lost';await record(s,directory,'question_lost');return result(s,'waiting','Needs you: the old native question was lost; no saved key was sent.');}
  if(!proof?.stopped?.complete||proof.promptInHistory!==true||!text(proof.turnKey))return result(s,'waiting','Needs you: native history or stopped identity is unproved; no replacement request.');
  if(pending.resumeIntent)return result(s,'waiting','Needs you: original native resume intent is unconfirmed; no repeat.');
  if(!await validatedSelection(s,p)||await p.reconcileWorkflowEffects({state:structuredClone(s),proof})!==true)return result(s,'waiting','Needs you: recovery inputs or external effects remain unproved.');
  pending.resumeIntent={runId:s.runId,stageId:b.stageId,attemptId:b.attemptId,oldGeneration:b.backendGen,newGeneration:b.backendGen+1,nativeSession:b.nativeSession,
    launchSelection:b.launchSelection,provider:b.provider??b.agent,actualAccount:b.actualAccount??s.actualAccount,policyRevision:s.machineToolPolicy?.revision??null,stoppedProof:proof.stopped};
  await record(s,directory,'native.resume_intent');
  const resumed=await p.resumeHerdrStage({backend:b,cwd:r.root,resumeIntent:pending.resumeIntent,checkpoint:nativePorts(s,directory,r,options,p).checkpoint},nativePorts(s,directory,r,options,p));
  if(resumed?.state!=='active'||resumed.backend?.phase!=='history_resumed')return result(s,'waiting','Needs you: original history resume is unconfirmed; no retry.');
  if(!p.sendWorkflowRecoveryContinuation)return result(s,'waiting','Native history restored; Needs you: continuation capability unavailable.');
  pending.recoveryContinuation={key:[pending.attemptId,proof.turnKey,resumed.backend.backendGen],phase:'sent'};await record(s,directory,'recovery.continuation_sent');
  await p.sendWorkflowRecoveryContinuation({backend:pending.backend,key:pending.recoveryContinuation.key,context:s.context,instructions:pending.instructions,proof});
  const found=await p.inspectWorkflowRecoveryContinuation?.({backend:pending.backend,key:pending.recoveryContinuation.key});
  return result(s,'waiting',found==='found'?'Original native history restored; observe the same attempt.':'Needs you: recovery continuation delivery is uncertain; no resend.');
}

async function driveHandoffRecovery(s,r,directory,options,p,first) {
  let outcome=first;
  while(options.drive&&outcome?.state==='waiting'&&s.pending?.kind==='agent'&&s.pending.handoffWait&&!s.quota&&!s.stall?.alarmed){
    const wait=s.pending.handoffWait,transport=s.pending.transport;
    if(transport?.state==='blocked')break;
    const scheduled=!wait.sent&&wait.retryAt!==null;
    const observing=wait.sent&&(transport?.state==='active'||transport?.state==='recovery_required'&&s.pending.backend?.phase==='prompt_intent'&&s.pending.backend.handoffRetry);
    if(!scheduled&&!observing)break;
    try{await (p.writeRunStatus??writeRunStatus)(directory,runStatusFromState(s,{phase:'exit',now:(p.now??Date.now)(),outcome,controller:s.controller}),p);}catch{}
    const delay=scheduled?Math.min(1000,Math.max(1,wait.retryAt-(p.now??Date.now)())):1000;
    await (p.sleep??(ms=>new Promise(resolve=>setTimeout(resolve,ms))))(delay);
    outcome=await advance(s,r,directory,options,p,'approve',false);
  }
  return outcome;
}
async function execute(options, ports, resume) {
  const p = dependencies(ports);
  p.pdd ??= (() => { try { const metadata = JSON.parse(readFileSync(join(options?.packageRoot ?? '', 'package.json'), 'utf8')); return { node: p.nodePath ?? process.execPath, bin: join(options?.packageRoot ?? '', 'bin', 'pdd.mjs'), version: metadata.version ?? null }; } catch { return { node: p.nodePath ?? process.execPath, bin: join(options?.packageRoot ?? '', 'bin', 'pdd.mjs'), version: null }; } })();
  let s, unlock, assignment, input, r, directory, heartbeat, heartbeatWrite;

  try {
    if (!resume && ['account','accountId','mode','accountMode','accountPreference','stageMode','accountPolicy','accountSelection'].some(key=>Object.hasOwn(options??{},key))) fail('Account choice belongs to machine/tool Settings.');
    if (!text(options?.packageRoot) || typeof p.loadGuidance !== 'function') fail('A package root and canonical guidance port are required.');
    if(resume && (!UUID.test(options.runId ?? '') || options.decision!==undefined&&!['approve','skip','continue','wait'].includes(options.decision)
      || options.decisionId!==undefined&&(!UUID.test(options.decisionId)||!options.decision)
      || options.expectedRev!==undefined&&(!Number.isSafeInteger(options.expectedRev)||options.expectedRev<1||!options.decisionId)
      || options.expect!==undefined&&(!options.decisionId||!STAGE.test(options.expect.stage??'')||!Number.isSafeInteger(options.expect.seq)||options.expect.seq<1)))fail('Supply a valid saved run and bound decision.');
    if (!resume && !['codex', 'claude'].includes(options.agent ?? 'codex')) fail('Choose codex or claude.');
    if(!resume&&options.prepareOnly&&(!p.runtime||!['node','bin','versionRoot'].every(k=>isAbsolute(p.runtime[k]??''))))fail('A verified immutable runtime is required before assignment.');
    if (resume) {
      const found = await assignmentFor(options, p, true, options.runId);
      if (found.state !== 'ready' || !found.assignment) return result({ runId: options.runId }, 'recovery_required', found.message || 'Original worktree assignment is not proved.');
      assignment = found.assignment; r = await assignedRepository(assignment, p);
      directory = join(r.gitDir, 'pdd', 'workflows', options.runId);
      // Lookup is read-only. Missing journals are never filled with a new stage attempt.
      unlock = await controllerLock(assignment, options.runId, p);
      s = readSaved(directory);
      const admissionSeq=s.seq;
      Object.defineProperty(s, '__recordPorts', { value: p, enumerable: false, configurable: true });
      if (!isDeepStrictEqual(s.assignment, assignment)) fail('Saved assignment identity changed.');
      r.repo=s.repo;r.base=s.base;
      await validateInput(s, options, p);
      p.runtime=s.runtime??p.runtime;
      if(Object.hasOwn(s.runtime??{},'herdr'))p.herdrExecutable=s.runtime.herdr;
      if(s.controlState!==undefined && !['running','waiting_agent','waiting_person','quota_wait','WAIT','question_lost','completed','failed','recovery_required'].includes(s.controlState))
        return result(s,'recovery_required','Unknown control state; no effect is authorized.');
      // Managed public resume is a short, effect-free reconciliation. Only drive
      // owns journal admission, stages, cleanup and publication.
      if(s.p1&&!options.drive&&!options.decision){
        if(s.controlState==='completed')return result(s,'completed','The saved run is completed.');
        if(['failed','recovery_required','question_lost'].includes(s.controlState))return result(s,'recovery_required','The saved run requires explicit recovery; no controller or stage was started.');
        if(s.waitingPerson)return result(s,'waiting','Waiting for the current person decision; no controller or stage was started.');
        return preparedReceipt(s,directory);
      }
      if(options.drive) {
        if(!s.p1&&!s.adopted)return result(s,'recovery_required','Adopt this legacy run before driving it.');
        if(!s.runtime)return result(s,'recovery_required','Recorded runtime is unavailable.');
        const checked=await (p.checkWorkflowRuntime ?? (await import('./workflow-runtime.mjs')).checkWorkflowRuntime)({runDir:directory},p);
        if(!checked?.ok)return {...result(s,'recovery_required',checked?.message??checked?.code??'Recorded runtime is unavailable.'),...(checked?.code==='herdr_not_found'?{code:checked.code}:{})};
        s.controller=await controllerProof(s,options,p);
        await record(s,directory,'controller.started',{launchId:options.launchId??null,controller:s.controller});
        heartbeat=setInterval(()=>{if(heartbeatWrite)return;heartbeatWrite=Promise.resolve((p.writeRunStatus??writeRunStatus)(directory,runStatusFromState(s,{phase:'record',now:Date.now(),controller:s.controller,heartbeatAt:Date.now()}),p)).catch(()=>{}).finally(()=>{heartbeatWrite=null;});},15000);
        heartbeat.unref?.();
      }
      if(options.decisionId !== undefined || options.expectedRev !== undefined || options.expect !== undefined) {
        const expect={rev:options.expectedRev??null,stage:options.expect?.stage??null,seq:options.expect?.seq??null};
        const prior=s.decisions?.find(item=>item.decisionId===options.decisionId);
        if(prior) {
          const old=prior.expect??{rev:prior.expectedRev??null,stage:prior.stage??null,seq:prior.seq??null};
          return isDeepStrictEqual(old,expect)&&prior.decision===options.decision&&(prior.questionId??null)===(options.questionId??null)?result(s,s.index>=s.definitions.length?'completed':'waiting','This same decision was already recorded.'):
            result(s,'failed','A decision id cannot change its payload.','bad_args');
        }
        if(!UUID.test(options.decisionId??'') || options.expectedRev!==undefined&&s.waitingPerson?.rev!==options.expectedRev
          || options.expect&&(options.expect.stage!==s.definitions[s.index]?.id||options.expect.seq!==admissionSeq)
          || s.p1&&s.waitingPerson&&options.expectedRev===undefined&&options.expect?.seq!==s.waitingPerson.rev)
          return result(s,'waiting','The saved request changed; review it before sending this decision.','stale_decision');
        const quotaAnswer=['continue','wait'].includes(options.decision);
        if(quotaAnswer && (s.controlState!=='waiting_person'||s.waitingPerson?.origin!=='quota'||s.waitingPerson.questionId!==options.questionId)
          || s.waitingPerson && !s.waitingPerson.decisions.includes(options.decision))return result(s,'failed','This answer does not match the current request.','bad_args');
        if(s.waitingPerson && (s.waitingPerson.stage!==s.definitions[s.index]?.id||s.waitingPerson.inputRevision!==s.expected.head))
          return result(s,'waiting','The request input changed.','stale_decision');
        await current(s,r,p);
        if(s.waitingPerson)await assertWorkflowArtifacts({cwd:r.root,files:(s.accepted?.files??s.proposal?.files??[])});
        if(s.p1&&!options.drive)return preparedReceipt(s,directory);
        s.decisions??=[];s.decisions.push({decisionId:options.decisionId,decision:options.decision,expect,questionId:options.questionId??null});
        Object.defineProperty(s,'__decisionId',{value:options.decisionId,enumerable:false,configurable:true,writable:true});
        await record(s,directory,'decision.received',{decisionId:options.decisionId});
        if(quotaAnswer){s.quotaAdmission={decision:options.decision,questionId:options.questionId,rev:options.expectedRev};await record(s,directory,'quota.answer.admitted');return result(s,'waiting','The quota answer is admitted; the quota flow owns continuation and account transitions.');}
        s.waitingPerson=null;s.rev=null;s.controlState='running';
      } else if(s.p1 && options.decision && s.waitingPerson)return result(s,'waiting','A current human wait requires its bound decision id and revision.','stale_decision');
      if(s.p1&&!options.drive&&!s.waitingPerson)return preparedReceipt(s,directory);
      if(s.p1&&s.waitingPerson&&!options.decision){return result(s,'waiting','Waiting for the person; inspection grants no decision.');}
      if(s.quota)return quotaFlow(s,directory,p,{type:s.quotaAdmission?'decide':s.quota.state==='WAIT'?'observe':'recover',turnKey:s.quota.turnKey,...(s.quotaAdmission??{})});
      const first = await advance(s, r, directory, options, p, options.decision ?? (options.drive && !s.waitingPerson?'approve':undefined), false);
      const outcome=await driveHandoffRecovery(s,r,directory,options,p,first);
      await saveOutcome(s,r,directory,outcome,p);
      try { await (p.writeRunStatus ?? writeRunStatus)(directory, runStatusFromState(s, { phase:'exit', now:Date.now(), outcome }), p); } catch { /* derived output never steers the run */ }
      return outcome;
    }
    {
      const resolveModel=p.resolveWorkflowModel ?? (await import('./workflow-models.mjs')).resolveWorkflowLaunchModel;
      const selection=await resolveModel({machineId:options.machineId ?? null,agent:options.agent ?? 'codex',frozenSelection:options.launchSelection,selection:options.launchSelection?.model ? {model:options.launchSelection.model,...(options.launchSelection.effort==null?{}:{effort:options.launchSelection.effort})}:undefined},p);
      if(selection?.state!=='selected')fail('Machine model/effort defaults are unavailable or unsupported.');
      if(options.launchSelection && (!['model','effort','agent','machineId','cliVersion','catalogRevision'].every(k=>isDeepStrictEqual(options.launchSelection[k],selection.selection[k]))))fail('The supplied model selection differs from validated machine capabilities.');
      options={...options,launchSelection:options.launchSelection ?? selection.selection};
    }
    const source = await repository(options.cwd, p);
    const definition = loadWorkflowDefinition({ name: options.name, cwd: source.root, packageRoot: options.packageRoot });
    const binding = await resolveWorkflowIssue({ cwd: source.root, issue: options.issue }, p.commandPorts);
    if(p.startRequestBinding){
      const remote=p.startRequestBinding.repository,canonical=remote.url.replace(/^git@github.com:/,'https://github.com/').replace(/^ssh:\/\/git@github.com\//,'https://github.com/').replace(/\.git$/,'');
      if(canonical.toLowerCase()!==`https://github.com/${binding.repository}`.toLowerCase())fail('The target checkout differs from the pinned repository.');
      await git(p,source.root,'cat-file','-e',`${remote.ref}^{commit}`);
    }
    const runId = options.runId ?? randomUUID();
    if(!UUID.test(runId))fail('Supply a lowercase UUIDv4 run id.');
    const baseContext = await p.loadGuidance({ packageRoot: options.packageRoot, cwd: source.root, workflows: false });
    if (!text(baseContext)) fail('Full guide-first context is unavailable.');
    input = { ...(p.startRequestBinding?{startRequestBinding:structuredClone(p.startRequestBinding)}:{}),runId, sourceRoot: source.root, definition, baseContext, overview: canonicalOverview(options.packageRoot) };
    // Preserve complete guide and recipe bytes BEFORE the allocator can create a checkout.
    saveInput(input, source.commonDir);
    s = { runId, name: options.name, definitions: definition.stages, index: 0 };
    const allocated = await assignmentFor({ ...options, cwd: source.root }, p, false, runId, binding);
    if (allocated.state === 'conflict' && allocated.assignment?.runId !== runId) {
      const original = await conflictingAssignment(source, binding, options, p, allocated.assignment);
      if (!original || original.commonDir !== source.commonDir || original.repository !== binding.repository
        || original.issueNumber !== binding.issue.number) return result(s, 'recovery_required', allocated.message || 'Issue assignment conflict.');
      s = { runId: original.runId };
      unlock = await controllerLock(original, original.runId, p);
      const prior = readSaved(join(original.gitDir, 'pdd', 'workflows', original.runId));
      if (!isDeepStrictEqual(prior.assignment, original)) fail('Saved original assignment changed.');
      return result(prior, prior.pending ? 'recovery_required' : 'waiting', 'This issue already has its original assigned run. Resume that run; no duplicate was launched.');
    }
    if (allocated.state !== 'ready' || !allocated.assignment) return result(s, 'recovery_required', allocated.message || 'Worktree allocation is uncertain; no native attempt started.');
    assignment = allocated.assignment;
    if (assignment.runId !== runId || assignment.repository !== binding.repository || assignment.issueNumber !== binding.issue.number
      || assignment.workflowName !== options.name || assignment.sourceRoot !== source.root || assignment.commonDir !== source.commonDir)
      fail('Worktree allocation does not match the requested issue/run.');
    r = await assignedRepository(assignment, p); r.repo = binding.repository; r.base = binding.defaultBranch;
    directory = join(r.gitDir, 'pdd', 'workflows', runId);
    if (existsSync(directory)) fail('Run journal already exists; do not overwrite it.');
    ensureDirectory(join(r.gitDir,'pdd')); ensureDirectory(join(r.gitDir,'pdd','workflows'));
    ensureDirectory(directory); ensureDirectory(join(directory, 'artifacts')); syncDirectory(directory);
    const releaseLife=await lifecycle(assignment,runId,p);
    try {unlock=await lock(directory,p);} finally {await releaseLife();}
    const context = stageContext(input, r.root);
    s = { version: 2, seq: 0, runId, name: options.name, agent: options.agent ?? 'codex', root: r.root, gitDir: r.gitDir,
      repo: r.repo, base: r.base, issue: binding.issue, assignment, definition, definitions: definition.stages,
      inputDigest: snapshotDigest(input), context, contextDigest: digest(context), index: 0, completed: [],
      expected: await fingerprint(r, p), pending: null, project:options.project ?? null, launchSelection:options.launchSelection ?? null,
      machineId:options.machineId ?? options.launchSelection?.machineId ?? null,startId:options.startId ?? runId,backendGen:1,controlState:'running',runtime:p.runtime ?? null,p1:!!options.prepareOnly,machineToolPolicy:null,actualAccount:null,accountTransition:null,quota:null,stall:null,waitingPerson:null,rev:null,decisions:[] };
    Object.defineProperty(s, '__recordPorts', { value: p, enumerable: false, configurable: true });
    if(options.prepareOnly) {
      if(!s.runtime)fail('A verified immutable run runtime is required before preparation.');
      const freeze=p.freezeWorkflowInputs ?? (await import('./workflow-runtime.mjs')).freezeWorkflowInputs;
      const frozen=await freeze({runDir:directory,guidance:context,definition,runtime:s.runtime,seed:{repository:s.repo,issue:s.issue,baseRef:assignment.baseRef,baseSha:assignment.baseSha,sourceRoot:assignment.sourceRoot,root:s.root,project:s.project,launchSelection:s.launchSelection}},p);
      s.runtime=frozen.runtime;
      const registry=join(p.home ?? homedir(),'.pdd','runs','registry');
      ensureDirectory(registry);
      const locator=join(registry,runId+'.json');if(existsSync(locator))fail('A recovery locator already exists; inspect the original.');
      durable(locator,{v:1,runId,commonDir:assignment.commonDir,root:s.root,runDir:directory});
    }
    await record(s, directory, 'run.started');
    await validateInput(s, options, p);
    if(options.prepareOnly)return preparedReceipt(s,directory);
    const outcome = await advance(s, r, directory, options, p, undefined, true);
    await saveOutcome(s,r,directory,outcome,p);
    try { await (p.writeRunStatus ?? writeRunStatus)(directory, runStatusFromState(s, { phase:'exit', now:Date.now(), outcome }), p); } catch { /* derived output never steers the run */ }
    return outcome;
  } catch (error) {
    const outcome = {...result(s, error.code === 'WORKFLOW_STAGE_BUSY' ? 'waiting' : 'failed', error.message || 'Workflow failed; inspect saved state before another effect.'),...(error.code==='herdr_not_found'?{code:error.code}:{})};
    if (s && directory) try { await (p.writeRunStatus ?? writeRunStatus)(directory, runStatusFromState(s, { phase:'exit', now:Date.now(), outcome }), p); } catch { /* derived output never steers the run */ }
    return outcome;
  }
  finally {if(heartbeat)clearInterval(heartbeat);await heartbeatWrite;await unlock?.();}
}
async function admittedExecute(options,ports={},resume=false){
  const run=()=>execute(options,ports,resume);
  try{return ports.withWorkflowAdmission?await ports.withWorkflowAdmission({runId:options?.runId??null,kind:options?.drive?'controller':'stage'},run):await run();}
  catch{return result({runId:options?.runId},'waiting','Start admission is closed or unproved; no stage started.');}
}
export async function runWorkflow(options, ports) { return admittedExecute(options, ports, false); }
export async function resumeWorkflow(options, ports) { return admittedExecute(options, ports, true); }

export async function attachWorkflow(options, ports) {
  const p = dependencies(ports);
  let s;
  try {
    if (!UUID.test(options?.runId ?? '')) fail('Supply the saved UUIDv4 run.');
    if (!text(options.packageRoot) || typeof p.loadGuidance !== 'function') fail('A package root and canonical guidance port are required.');
    const found = await assignmentFor(options, p, true, options.runId);
    if (found.state !== 'ready' || !found.assignment) return result({ runId: options.runId }, 'recovery_required', found.message || 'Original assignment is not proved.');
    const r = await assignedRepository(found.assignment, p);
    const directory=join(r.gitDir, 'pdd', 'workflows', options.runId);
    s = readSaved(directory);
    if (!isDeepStrictEqual(s.assignment, found.assignment)) fail('Saved assignment changed.');
    if (!s.pending?.backend || s.pending.backend.phase === 'closed') return result(s, 'waiting', 'No live stage is retained. Completed stage history is archived; no conversation was started.');
    if (s.pending.kind === 'cleanup') return result(s, 'waiting', 'The stage is already accepted for cleanup; it is archived for workflow purposes.');
    if (typeof p.attachHerdrStage !== 'function') fail('Active native attachment is unavailable.');
    const guard = stageGuard(s,p);
    const releaseLifecycle=await lifecycle(found.assignment,options.runId,p);
    let releaseController;
    try {
      // A live controller remains the sole journal writer. An idle run can lend
      // its journal exclusion to this attachment's identity/claim checkpoints.
      try{releaseController=await lock(directory,p);}catch(error){if(error.code!=='controller_busy')throw error;}
      return await guard(s.pending.backend, async () => {
      // Acceptance/cleanup may have won the guard after the initial lookup.
      s = readSaved(directory);
      if (!isDeepStrictEqual(s.assignment, found.assignment)) fail('Saved assignment changed.');
      await assignedRepository(s.assignment, p);
      if (!s.pending?.backend || s.pending.backend.phase === 'closed' || s.pending.kind === 'cleanup')
        return result(s, 'waiting', 'The stage is already accepted or archived. No live conversation was attached.');
      await validateInput(s, options, p);
      attachmentEpoch(s, true);
      const stagePorts=nativePorts(s,directory,r,options,p),validateOwner=stagePorts.validateOwner;
      const checkpoint=stagePorts.checkpoint,bindClaim=stagePorts.bindClaim;
      stagePorts.withStageGuard=guard;
      stagePorts.validateOwner=async spec=>{
        const latest=readSaved(directory);
        if(!isDeepStrictEqual(latest.assignment,found.assignment))return {state:'retired'};
        await assignedRepository(latest.assignment,p);
        if(latest.pending?.attemptId!==s.pending?.attemptId||latest.pending?.backend?.backendGen!==s.pending?.backend?.backendGen)return {state:'retired'};
        return validateOwner(spec);
      };
      const writableOwner=async spec=>{
        attachmentEpoch(s); // Also fences callbacks escaping their attachment guard.
        if(!releaseController)fail('The live controller owns native identity and claim checkpoints; retry after it records the discovery.');
        if((await stagePorts.validateOwner(spec)).state!=='current')fail('Attachment native owner changed.');
      };
      stagePorts.checkpoint=async backend=>{
        await writableOwner({kind:backend.agent,nativeSessionId:null,owner:{runId:backend.runId,attemptId:backend.attemptId,backendGen:backend.backendGen}});
        return checkpoint(backend);
      };
      stagePorts.bindClaim=async spec=>{await writableOwner(spec);return bindClaim(spec);};
      stagePorts.claimWorkflowSession=async(spec,claimPorts)=>{
        if(!releaseController)return {state:'uncertain'};
        const claim=p.claimWorkflowSession??(await import('./workflow-claims.mjs')).claimWorkflowSession;
        return claim(spec,claimPorts);
      };
      stagePorts.promoteWorkflowClaim=async(spec,claimPorts)=>{
        if(!releaseController&&(spec.claim?.state!=='owned'||spec.claim.kind!==spec.kind||spec.claim.nativeSessionId!==spec.nativeSessionId
          ||(await stagePorts.validateOwner({kind:spec.kind,nativeSessionId:spec.nativeSessionId,owner:spec.claim.owner})).state!=='current'))return {state:'uncertain'};
        const promote=p.promoteWorkflowClaim??(await import('./workflow-claims.mjs')).promoteWorkflowClaim;
        return promote(spec,claimPorts);
      };
      const code = await p.attachHerdrStage({ backend: s.pending.backend }, stagePorts);
      return result(s, code === 0 ? 'waiting' : 'recovery_required', code === 0
        ? 'Detached from the original active stage. Resume its saved run to inspect; attachment does not certify stage success.'
        : 'The exact original stage could not be attached. No replacement was started.');
    }); } finally {const unlock=releaseController;releaseController=null;try{await unlock?.();}finally{await releaseLifecycle();}}
  } catch (error) { return result(s, 'recovery_required', error.message); }
}

// Strict authoritative reader: validates complete history with only a current record buffered.
export async function readWorkflowJournal({runDir}, ports = {}) {
  const decisions = [];
  const state = readSaved(runDir, row => {
    if (row.event === 'decision.received') {
      const binding = row.state.decisions?.find(d => d.decisionId === row.decisionId);
      decisions.push({decisionId:row.decisionId, ...(binding ?? {}), bindingKnown:!!binding});
    }
    ports.onRecord?.(structuredClone(row));
  });
  return {state,seq:state.seq,decisions};
}

// Compose real authority without trusting a caller's journal or path validator.
export function createWorkflowControllerAuthorityPorts(ports = {}) {
  const p=dependencies(ports);
  const read=spec=>readWorkflowJournal(spec);
  async function verified(spec) {
    if(!UUID.test(spec?.runId??'')||!isAbsolute(spec?.runDir??'')||!isAbsolute(spec?.root??''))fail('Controller locator is invalid.');
    const journal=await read({runDir:spec.runDir}),s=journal.state,a=s.assignment;
    if(s.runId!==spec.runId||s.root!==spec.root||s.name!==spec.workflow||s.issue?.number!==spec.issueNumber
      ||!s.p1||s.removing||s.archived||!isDeepStrictEqual(s.runtime,spec.runtime)
      ||s.gitDir!==a?.gitDir||s.root!==a.worktreePath||s.repo!==a.repository||s.issue.number!==a.issueNumber
      ||spec.runDir!==join(a.gitDir,'pdd','workflows',s.runId))fail('Controller run binding changed.');
    const found=await assignmentFor({cwd:s.root},p,true,s.runId);
    if(found.state!=='ready'||!isDeepStrictEqual(found.assignment,a))fail('Original controller assignment is unavailable.');
    await assignedRepository(a,p);
    await validateInput(s,{packageRoot:s.runtime.packageRoot},p);
    if(!isDeepStrictEqual((await read({runDir:spec.runDir})).state,s))fail('Controller journal changed during validation.');
    return journal;
  }
  return {
    readWorkflowJournal:read,
    withLifecycleGuard:async(spec,action)=>{
      const first=await verified(spec),release=await lifecycle(first.state.assignment,spec.runId,p);
      try{await verified(spec);return await action();}finally{await release();}
    },
    validateRun:async(spec,state)=>{try{return isDeepStrictEqual((await verified(spec)).state,state);}catch{return false;}},
    inspectControllerLock:async spec=>{
      try{
        await verified(spec);
        const inspect=p.inspectWorkflowLock??(await import('./workflow-claims.mjs')).inspectWorkflowLock;
        const observed=await inspect({path:join(spec.runDir,'controller.lock')},p);
        return ['free','held'].includes(observed)?observed:'unknown';
      }catch{return 'unknown';}
    }
  };
}

export async function prepareWorkflow(options, ports = {}) {
  const binding=ports.startRequestBinding;
  if(options?.runId) {
    if(!UUID.test(options.runId)||!binding||Object.keys(binding).some(k=>!['targetMachineId','startId','kind','agent','repository','workflow','project','selectionOverrides'].includes(k))
      ||binding.selectionOverrides&&Object.entries(binding.selectionOverrides).some(([k,v])=>!['model','effort'].includes(k)||options.launchSelection?.[k]!==v)
      ||binding.startId!==options.runId||binding.kind!=='workflow'
      ||binding.targetMachineId!==(options.machineId??options.launchSelection?.machineId)||binding.agent!==(options.agent??'codex')
      ||binding.workflow?.name!==options.name||String(binding.workflow?.issue)!==String(options.issue)
      ||!isDeepStrictEqual(binding.project??null,options.project??null)||!text(binding.repository?.url)||!/^[0-9a-f]{40}$/.test(binding.repository?.ref??''))
      return result({runId:options.runId},'failed','A preallocated id requires its complete original durable target request binding.');
    const p=dependencies(ports);let release;
    try {
      const found=await assignmentFor(options,p,true,options.runId);
      if(found.state==='ready') {
        release=await controllerLock(found.assignment,options.runId,p);
        const directory=join(found.assignment.gitDir,'pdd','workflows',options.runId),s=readSaved(directory),input=readInput(found.assignment.commonDir,options.runId);
        if(!isDeepStrictEqual(input.startRequestBinding,binding)||!isDeepStrictEqual(s.assignment,found.assignment))fail('Original target request binding changed.');
        await validateInput(s,options,p);return preparedReceipt(s,directory);
      }
    }catch(e){return result({runId:options.runId},'recovery_required',e.message);}finally{await release?.();}
  }
  return admittedExecute({...options,prepareOnly:true},ports,false);
}

async function saveOutcome(s,r,directory,outcome,p) {
  if(!s.p1){if(outcome.state==='completed'){s.controlState='completed';await record(s,directory,'run.completed');}return;}
  if(s.quota||s.controlState==='question_lost'||s.stall?.alarmed)return;
  const stage=s.definitions[s.index];
  if(outcome.state==='waiting' && !s.pending && stage && (stage.kind==='human'||stage.optional&&!s.optional?.[stage.id]||s.proposal?.approval==='next-advance'&&!s.accepted)) {
    const decisions=stage.optional?['approve','skip']:['approve'];
    const request={stage:stage.id,inputRevision:s.expected.head,artifactHashes:(s.accepted?.files??s.proposal?.files??[]).map(({path,sha256})=>({path,sha256})),decisions,what:outcome.message};
    if(!s.waitingPerson||!isDeepStrictEqual({...s.waitingPerson,rev:undefined},{...request,rev:undefined})) {
      const rev=s.seq+1;s.waitingPerson={...request,rev};s.rev=rev;s.controlState='waiting_person';await record(s,directory,'waiting_person');
    }
  } else {s.controlState=outcome.state==='completed'?'completed':s.pending?.kind==='agent'?'waiting_agent':outcome.state==='failed'?'failed':outcome.state==='recovery_required'?'recovery_required':'running';await record(s,directory,'controller.stopped');}
}
async function controllerProof(s,options,p) {
  const c=p.controller ?? {herdrSession:'default',workspaceId:process.env.HERDR_WORKSPACE_ID,tabId:process.env.HERDR_TAB_ID,paneId:process.env.HERDR_PANE_ID};
  if(c.herdrSession!=='default'||![c.workspaceId,c.tabId,c.paneId].every(text))fail('The exact default-session controller pane is required.');
  const reply=json(await command(p,s.root,'herdr',['--session','default','pane','process-info','--pane',c.paneId],true));
  const expectedArgv=[s.runtime.node,s.runtime.bin,'workflow','drive',s.runId,...(options.launchId?['--launch-id',options.launchId]:[]),
    ...(options.decision?['--decision',options.decision,'--id',options.decisionId,'--rev',String(options.expectedRev??s.waitingPerson?.rev??options.expect?.seq)]:[]),
    ...(options.expect?['--expect-stage',options.expect.stage,'--expect-seq',String(options.expect.seq)]:[])];
  const info=reply.result?.process_info,proc=info?.foreground_processes?.find(item=>item.pid===process.pid&&isDeepStrictEqual(item.argv,expectedArgv));
  if(info?.pane_id!==c.paneId||!proc||options.launchId&&!proc.argv.includes(options.launchId))fail('Controller pane process proof is unavailable.');
  const startIdentity=p.processStartIdentity
    ?await p.processStartIdentity({pid:process.pid,paneId:c.paneId})
    :await (await import('./workflow-herdr-client.mjs')).readProcessStartIdentity({pid:process.pid},p);
  if(!text(startIdentity))fail('Controller process start identity is unavailable.');
  return {...c,started:true,pid:process.pid,startIdentity,generation:(s.controller?.generation??0)+1,launchId:options.launchId??null};
}
export async function driveWorkflow(options,ports={}) {
  return admittedExecute({...options,drive:true},ports,true);
}

export async function adoptWorkflow({runId,cwd,packageRoot,expectedRev},ports={}) {
  const p=dependencies(ports);let s,release;
  try {
    if(!UUID.test(runId??''))fail('Supply the saved lowercase UUIDv4 run.');
    const found=await assignmentFor({cwd,runId},p,true,runId);if(found.state!=='ready')return result({runId},'recovery_required','The original physical assignment is unavailable.');
    const a=found.assignment,directory=join(a.gitDir,'pdd','workflows',runId);release=await controllerLock(a,runId,p);s=readSaved(directory);
    if(!isDeepStrictEqual(s.assignment,a))fail('The original assignment changed.');
    if(s.adopted)return result(s,'waiting','This run is already adopted; no controller or stage was started.');
    if(expectedRev!==undefined&&s.waitingPerson?.rev!==expectedRev)return result(s,'recovery_required','The current human request changed.');
    const r=await assignedRepository(a,p);r.repo=s.repo;r.base=s.base;
    await validateInput(s,{packageRoot},p);await sourceValid(s,r);
    if(s.pending) {
      if(s.pending.kind!=='agent'||!s.pending.backend||typeof p.inspectHerdrStage!=='function')return result(s,'recovery_required','An original uncertain effect needs reconciliation before adoption.');
      const seen=await p.inspectHerdrStage({backend:s.pending.backend,cwd:s.root},nativePorts(s,directory,r,{packageRoot},p));
      if(!['active','settled','blocked'].includes(seen?.state))return result(s,'recovery_required','The original native identity is unproved; no replacement was started.');
    }
    const runtime=s.runtime??p.runtime;if(!runtime)return result(s,'recovery_required','Supply the verified original compatible runtime before adoption.');
    const path=join(directory,'adoption');ensureDirectory(path);const archive=join(path,randomUUID());ensureDirectory(archive);
    const original=readFileSync(join(directory,'journal.jsonl'));const fd=openSync(join(archive,'journal.jsonl'),'wx',0o600);try{writeSync(fd,original);fsyncSync(fd);}finally{closeSync(fd);}syncDirectory(archive);syncDirectory(path);
    if(!readFileSync(join(archive,'journal.jsonl')).equals(original))fail('Pre-adoption journal archive failed readback.');
    const freeze=p.freezeWorkflowInputs??(await import('./workflow-runtime.mjs')).freezeWorkflowInputs;
    await freeze({runDir:directory,guidance:s.context,definition:s.definition,runtime,seed:{repository:s.repo,issue:s.issue,baseRef:a.baseRef,baseSha:a.baseSha,sourceRoot:a.sourceRoot,root:s.root,project:s.project??null,launchSelection:s.launchSelection??null}},p);
    const registry=join(p.home??homedir(),'.pdd','runs','registry');ensureDirectory(registry);
    const locator=join(registry,runId+'.json');if(!existsSync(locator))durable(locator,{v:1,runId,commonDir:a.commonDir,root:s.root,runDir:directory});
    s.runtime=runtime;s.p1=true;s.controlState=s.waitingPerson?'waiting_person':s.pending?'waiting_agent':'running';s.adopted={at:Date.now(),archive,originalJournalSha256:digest(original)};
    Object.defineProperty(s,'__recordPorts',{value:p,enumerable:false,configurable:true});await record(s,directory,'run.adopted');
    await saveOutcome(s,r,directory,result(s,'waiting','Adopted without starting any controller or native process.'),p);
    return result(s,'waiting','The original run is adopted; no approval, prompt or controller start was performed.');
  }catch(e){return result(s??{runId},'recovery_required',e.message);}finally{await release?.();}
}
