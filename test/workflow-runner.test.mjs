import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync, symlinkSync, linkSync, unlinkSync, cpSync, readdirSync, openSync, closeSync, writeSync, readSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { constants as bufferConstants } from 'node:buffer';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile as callbackExec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { runWorkflow, resumeWorkflow, attachWorkflow, prepareWorkflow, driveWorkflow, adoptWorkflow, readWorkflowJournal, WORKFLOW_STAGES } from '../src/workflow-runner.mjs';
import { loadGuidance as actualGuidance } from '../src/guidance.mjs';
import { runHerdrStage, inspectHerdrStage, closeHerdrStage, attachHerdrStage } from '../src/workflow-stage-herdr.mjs';
import {readHerdrTrace} from '../src/herdr-trace.mjs';
import {encodeWorkflowJournalRecord,replayWorkflowJournalRecord} from '../src/workflow-journal.mjs';

import {withWorkflowLock,inspectWorkflowLock} from './cli/workflow-test-lock.mjs';
const exec = promisify(callbackExec);
const packageRoot = resolve(import.meta.dirname, '..');
const sha = value => createHash('sha256').update(value).digest('hex');
const issueUrl = 'https://github.com/example/project/issues/17';
const output = { write() {} };
// Tests inspect logical state through the public storage codec. Intentional
// corruption fixtures serialize those logical rows as legacy snapshots.
function journalRows(raw) {
  let state;
  return raw.trimEnd().split('\n').filter(line=>line.trim()).map(line=>{
    const {delta,baseSeq,...row}=JSON.parse(line);
    state=replayWorkflowJournalRecord(state,JSON.parse(line));
    return {...row,state};
  });
}

async function fixture(t, options = {}) {
  const activePackageRoot = options.packageRoot ?? packageRoot;
  let cwd = mkdtempSync(join(tmpdir(), 'pdd-runner-'));
  const sourceCwd = cwd;
  const indexHome = mkdtempSync(join(tmpdir(), 'pdd-runner-home-'));
  t.after(() => rmSync(sourceCwd, { recursive: true, force: true }));
  t.after(() => rmSync(indexHome, { recursive: true, force: true }));
  // The resolver checks a real absolute file; transport replies stay synthetic.
  // Any missed transport interception exits126 instead of reaching live Herdr.
  const herdrExecutable = join(indexHome, 'herdr');
  writeFileSync(herdrExecutable, '#!/bin/sh\nexit 126\n', {mode:0o700});
  const git = async (...args) => (await exec('git', args, { cwd })).stdout.trim();
  await git('init', '-b', 'main'); await git('config', 'user.email', 'test@example.invalid');
  await git('config', 'user.name', 'Runner Test'); await git('remote', 'add', 'origin', 'https://github.com/example/project.git');
  writeFileSync(join(cwd, 'value.mjs'), 'export const value = 1;\n');
  writeFileSync(join(cwd, 'check.mjs'), "import assert from 'node:assert/strict'; import {value} from './value.mjs'; assert.equal(value, 2);\n");
  await git('add', '.'); await git('commit', '-m', 'initial');
  const initial = await git('rev-parse', 'HEAD');
  await git('update-ref', 'refs/remotes/origin/main', initial);
  const calls = [], native = [], contexts = [];
  const f = { cwd, sourceCwd, herdrExecutable, gitDir: join(cwd, '.git'), git, calls, native, contexts, initial, pr: null, merged: false, options, closes: 0 };
  const plan = [[process.execPath, 'check.mjs']];
  async function execFile(file, args, opts) {
    calls.push({ file, args: [...args] });
    if(file==='git'&&args[0]==='fetch'){const head=(await exec('git',['rev-parse',`refs/remotes/origin/${args[2]}`],opts)).stdout.trim();const path=(await exec('git',['rev-parse','--git-path','FETCH_HEAD'],opts)).stdout.trim();writeFileSync(resolve(opts.cwd,path),head+'\n');return {stdout:''};}
    if (file === 'git' && args[0] === 'push') {
      assert.equal(f.saved(native.at(-1).input.runId).pending.kind, 'pr', 'PR intent must be durable BEFORE push');
      if (options.preAuthPushFailure && !f.authFixed) throw Object.assign(Error('Username prompt timed out'), { code: 'ETIMEDOUT' });
      if (options.preAuthPushFailure) {
        const events = journalRows(readFileSync(join(f.gitDir, 'pdd/workflows', native.at(-1).input.runId, 'journal.jsonl'),'utf8'));
        assert.equal(events.at(-1).event, 'pr.unpublished_retry_intent', 'explicit retry intent durable BEFORE recovered push');
      }
      return { stdout: '', stderr: '' };
    }
    if (file === 'git' && args[0] === 'ls-remote' && args.includes('--exit-code')) {
      if (f.remoteUnreadable) throw Object.assign(Error('authentication unreadable'), { code: 128, stdout: '', stderr: 'authentication failed' });
      return { code: f.remoteHead ? 0 : 2, stdout: f.remoteHead ? `${f.remoteHead}\t${args.at(-1)}\n` : '', stderr: '' };
    }
    if (file === 'git' && args[0] === 'ls-remote') return { stdout: f.pr ? `${f.pr.headRefOid}\trefs/heads/${f.pr.headRefName}\n` : '', stderr: '' };
    if (file !== 'gh') return exec(file, args, opts);
    if (args[0] === 'repo' && args[1] === 'view') return { stdout: JSON.stringify({ nameWithOwner: 'example/project', defaultBranchRef: { name: 'main' }, url: 'https://github.com/example/project' }) };
    if (args[0] === 'api' && args[1] === 'repos/example/project/issues/17') return { stdout: JSON.stringify({ number: 17, html_url: issueUrl, title: 'Use value two', body: 'The observable result must be two.', state: 'OPEN', isPullRequest: false }) };
    if (args[0] === 'pr' && args[1] === 'create') {
      const value = flag => args[args.indexOf(flag) + 1];
      f.pr = { number: 23, url: 'https://github.com/example/project/pull/23', state: 'OPEN',
        headRefName: value('--head'), baseRefName: value('--base'), headRefOid: await git('rev-parse', 'HEAD'),
        body: readFileSync(value('--body-file'), 'utf8'), title: value('--title'),
        headRepository: { name: 'project' }, headRepositoryOwner: { login: 'example' }, baseRepository: { nameWithOwner: 'example/project' },
        isCrossRepository: false, mergeCommit: null, mergedAt: null };
      if (options.lostPrReply) throw Error('lost create reply');
      return { stdout: f.pr.url + '\n' };
    }
    if (args[0] === 'pr' && ['list', 'view'].includes(args[1])) {
      if (f.prUnreadable) throw Error('PR lookup unreadable');
      if (f.pr && f.merged) Object.assign(f.pr, { state: 'MERGED', mergedAt: '2026-10-24T00:00:00Z', mergeCommit: { oid: f.pr.headRefOid } });
      return { stdout: JSON.stringify(args[1] === 'list' ? f.pr ? [f.pr] : [] : f.pr) };
    }
    throw Error(`Unexpected fake GitHub command: ${args.join(' ')}`);
  }
  const ports = { herdrExecutable,execFile,withWorkflowLock,inspectWorkflowLock,resolveWorkflowModel:async({agent,machineId})=>({state:'selected',selection:{machineId:machineId??null,agent,model:'observed-test-model',effort:null,cliVersion:'test',catalogRevision:'test',source:'defaults'}}), stdout: output, stderr: output,
    async loadGuidance(value) { contexts.push(value); return actualGuidance(value); },
    async launchNativeSession(value) {
      const input = JSON.parse(value.request.split('PDD_STAGE_INPUT_JSON\n')[1].split('\nPDD_STAGE_INPUT_END')[0]);
      native.push({ ...value, input });
      if (options.pauseNative) await options.pauseNative;
      if (options.nativeCode !== undefined) return options.nativeCode;
      if (options.failStage === input.stageId) return 8;
      if (options.missingHandoff) return 0;
      if (['scope', 'prompt-story', 'change', 'build'].includes(input.stageId)) {
        if ((await git('branch', '--show-current')) === 'main') await git('switch', '-c', 'pdd-test-topic');
      }
      const files = [];
      const add = (path, contents, role) => {
        if (contents !== null) writeFileSync(join(cwd, path), contents);
        files.push({ path, sha256: sha(readFileSync(join(cwd, path))), role });
      };
      if (input.protocol === 'proposal') add('cases.json', '[{"expected":2}]\n', 'cases');
      if (input.protocol === 'proposal' && input.requiredRoles.includes('prompt')) {
        add('module.prompt.md', 'Return the observable value two.\n', 'prompt');
        add('STORY.md', 'The person sees two.\n', 'story');
      }
      if (input.protocol === 'work') {
        add('value.mjs', `export const value = ${options.wrongBehavior ? 3 : 2};\n`, 'implementation');
        if (options.changeAccepted) writeFileSync(join(cwd, 'cases.json'), '[{"expected":3}]\n');
      }
      if (input.protocol === 'verify') {
        let contents = null;
        if (options.mutatingTest) contents = "import {writeFileSync} from 'node:fs'; writeFileSync('value.mjs', 'export const value = 3;\\n');\n";
        if (options.mutatingHandoff) contents = `import {readFileSync,writeFileSync} from 'node:fs'; const path=${JSON.stringify(input.handoffPath)}; const h=JSON.parse(readFileSync(path)); h.summary='changed during checks'; writeFileSync(path,JSON.stringify(h));\n`;
        add('check.mjs', contents, 'tests');
      }
      if (files.length && !(options.leaveScopeUncommitted && input.protocol !== 'work')) {
        await git('add', ...(options.leaveScopeUncommitted ? ['--', ...files.map(file => file.path)] : ['.']));
        if (await git('status', '--porcelain')) await git('commit', '-m', input.stageId);
      }
      if (options.unrelatedPublicationFile && input.protocol === 'verify')
        writeFileSync(join(cwd, 'unrelated draft.txt'), 'preserve this unrelated work\n');
      const h = { version: 1, runId: input.runId, stageId: input.stageId, issueUrl,
        inputRevision: options.staleHandoff ? initial.replace(/^./, initial[0] === 'a' ? 'b' : 'a') : input.inputRevision,
        summary: `Completed current ${input.stageId}; observable expectations remain independent.`, files };
      if (['proposal', 'verify'].includes(input.protocol)) h.testCommands = plan;
      if (input.stageId === 'verify' && options.changedPlan) h.testCommands = [[process.execPath, '-e', 'process.exit(0)']];
      if (input.stageId === 'change' && options.emptyWork) h.files = [];
      writeFileSync(input.handoffPath, JSON.stringify(h)); return 0;
    } };
  // Keep derived run records inside this disposable fixture; production defaults remain the user's home.
  ports.home = indexHome;
  f.ports = ports;
  const assignments = new Map();
  if (!options.defaultWorktree) {
  ports.allocateIssueWorktree = async ({ runId, repository, issueNumber, workflowName, baseRef }) => {
    const inputPath = join(sourceCwd, '.git', 'pdd', 'workflow-inputs', runId, 'input.jsonl');
    const savedInput = JSON.parse(readFileSync(inputPath, 'utf8'));
    assert.ok(savedInput.baseContext.includes('# Prompting guide'), 'full guide bytes durable BEFORE allocation');
    assert.ok(savedInput.definition.files.some(file => file.path === 'workflow.json'));
    if (options.onAllocate) options.onAllocate(savedInput);
    if (assignments.size) return { state: 'conflict', assignment: [...assignments.values()][0], message: 'Issue already assigned; original retained.' };
    const commonDir = join(sourceCwd, '.git'), id = randomUUID();
    const worktreePath = join(commonDir, 'pdd', 'worktrees', id), branch = `pdd/${workflowName}-${issueNumber}-${id.slice(0,8)}`;
    const baseSha = (await exec('git', ['rev-parse', baseRef], { cwd: sourceCwd })).stdout.trim();
    mkdirSync(join(commonDir, 'pdd', 'worktrees'), { recursive: true });
    await exec('git', ['worktree', 'add', '-b', branch, worktreePath, baseSha], { cwd: sourceCwd });
    cwd = worktreePath; f.cwd = cwd;
    f.gitDir = await git('rev-parse', '--absolute-git-dir');
    const assignment = { version: 1, runId, repository, issueNumber, workflowName, commonDir, sourceRoot: sourceCwd,
      worktreePath, gitDir: f.gitDir, branch, baseRef, baseSha };
    assignments.set(runId, assignment);
    return { state: 'ready', assignment, message: 'Actual disposable worktree ready.' };
  };
  ports.lookupIssueWorktree = async ({ runId }) => ({ state: assignments.has(runId) ? 'ready' : 'recovery_required',
    assignment: assignments.get(runId) ?? null, message: 'Read-only original assignment.' });
  }
  const foreground = ports.launchNativeSession;
  ports.runHerdrStage = async (value, transportPorts) => {
    const backend = { version: 1, runId: value.runId, stageId: value.stageId, attemptId: value.attemptId,
      agent: value.agent, cwd: value.cwd, phase: 'ready', promptDigest: sha(`${value.context}\n\n# Current workflow stage\n${value.instructions}`),
      terminalId: `terminal-${value.attemptId}`, nativeSession: null, evidence: { readySeq: 1 } };
    await value.checkpoint(backend);
    const code = await foreground({ ...value, request: value.instructions });
    backend.transportFailed = code !== 0;
    backend.phase = 'candidate'; backend.evidence = { readySeq: 1, workingSeq: 2, settledSeq: 3 };
    await value.checkpoint(backend);
    return { state: code === 0 ? 'settled' : 'recovery_required', backend, evidence: backend.evidence, reason: `native code ${code}` };
  };
  ports.inspectHerdrStage = async ({ backend }) => ({ state: backend.transportFailed ? 'recovery_required' : 'settled', backend, evidence: backend.evidence });
  ports.closeHerdrStage = async ({ backend, acceptance }, transportPorts) => {
    f.closes++;
    assert.deepEqual(f.saved(backend.runId).pending.acceptance, acceptance, 'acceptance durable BEFORE cleanup');
    const closed = { ...backend, phase: 'closed', acceptanceDigest: sha(JSON.stringify(acceptance)) };
    await transportPorts.checkpoint(closed);
    return { state: 'closed', backend: closed, evidence: closed.evidence };
  };
  ports.attachHerdrStage = async () => 0;
  f.packageRoot = activePackageRoot;
  const executionPorts = () => !options.defaultWorktree ? ports : { ...ports,
    runHerdrStage: async (value, ...rest) => {
      cwd = value.cwd; f.cwd = cwd;
      f.gitDir = (await exec('git', ['rev-parse', '--absolute-git-dir'], { cwd })).stdout.trim();
      assert.notEqual(cwd, sourceCwd);
      assert.ok(existsSync(join(sourceCwd, '.git', 'pdd', 'worktree-assignments', 'runs', value.runId + '.json')));
      return ports.runHerdrStage(value, ...rest);
    } };
  f.run = (name = 'small-change', agent = 'claude') => runWorkflow({ name, issue: '17', agent, cwd, packageRoot: activePackageRoot }, executionPorts());
  f.resume = (runId, decision, binding = {}) => resumeWorkflow({ runId, decision, ...binding, cwd: options.defaultWorktree ? sourceCwd : cwd, packageRoot: activePackageRoot }, executionPorts());
  f.saved = runId => journalRows(readFileSync(join(f.gitDir, 'pdd', 'workflows', runId, 'journal.jsonl'),'utf8')).at(-1).state;
  return f;
}
function projectWorkflow(f, marker = 'OWNED_RECIPE_A__') {
  const directory = join(f.sourceCwd, '.pdd', 'workflows', 'snapshot-check'); mkdirSync(directory, { recursive: true });
  const definition = { version: 1, name: 'snapshot-check', overview: 'WORKFLOW.md', stages: [
    { id: 'agree', kind: 'agent', protocol: 'proposal', approval: 'next-advance', requiredRoles: ['prompt', 'story', 'cases'], file: 'plan.md' },
    { id: 'implement', kind: 'agent', protocol: 'work', requiredRoles: ['implementation'], file: 'work.md' },
    { id: 'prove', kind: 'agent', protocol: 'verify', file: 'check.md' },
    { id: 'publish', kind: 'pr', publication: 'verified', file: 'pr.md' },
    { id: 'merged', kind: 'merge', prStage: 'publish', file: 'merge.md' }
  ] };
  writeFileSync(join(directory, 'workflow.json'), JSON.stringify(definition));
  for (const file of ['WORKFLOW.md', 'plan.md', 'work.md', 'check.md', 'pr.md', 'merge.md']) writeFileSync(join(directory, file), `# ${marker}\nUse only this workflow's current stage.\n`);
  return directory;
}

function decisionBinding(f, runId) {
  const saved = f.saved(runId);
  return { decisionId: randomUUID(), expect: { stage: saved.definitions[saved.index].id, seq: saved.seq },
    ...(saved.waitingPerson ? { expectedRev: saved.waitingPerson.rev } : {}) };
}

test('listed workflow totals distinguish native stages from human, optional and PR steps', () => {
  assert.deepEqual(Object.values(WORKFLOW_STAGES).map(stages => stages.length), [12, 11, 6]);
  assert.deepEqual(Object.values(WORKFLOW_STAGES).map(stages => stages.filter(s => s.kind === 'agent').length), [7, 6, 4]);
  assert.deepEqual(Object.values(WORKFLOW_STAGES).slice(0, 2).map(stages => stages.filter(s => s.kind === 'agent' && !s.optional).length), [5, 5]);
});

test('small change pins scope, inspection launches nothing, native checks execute, PR waits and actual merge completes', async t => {
  const f = await fixture(t); const started = await f.run();
  assert.equal(started.state, 'waiting'); assert.equal(started.exitCode, 2); assert.equal(started.stage, 'check');
  assert.match(started.runId, /^[\da-f-]{36}$/); assert.equal(f.native.length, 1);
  const inspect = await f.resume(started.runId); assert.equal(inspect.state, 'waiting'); assert.equal(f.native.length, 1);
  const progressed = await f.resume(started.runId, 'approve');
  assert.equal(progressed.state, 'waiting', progressed.message); assert.equal(progressed.stage, 'wait-merge');
  assert.deepEqual(f.native.map(v => v.input.stageId), ['scope', 'check', 'change', 'verify']);
  assert.ok(f.native.every(v => v.agent === 'claude' && v.cwd === f.cwd && v.context.startsWith('# PDD Alpha conversation guidance')));
  assert.equal(f.contexts.length, 1); assert.ok(f.contexts.every(v => v.workflows === false));
  const saved = f.saved(started.runId); assert.equal(saved.completed.find(s => s.id === 'verify').handoff.checks[0].exitCode, 0);
  assert.equal(f.calls.filter(c => c.file === 'gh' && c.args[1] === 'create').length, 1);
  f.merged = true; const done = await f.resume(started.runId);
  assert.equal(done.state, 'completed', done.message); assert.equal(done.exitCode, 0); assert.equal(f.native.length, 4);
});

test('changed source invalidates a saved human advance and launches no replacement session', async t => {
  const f = await fixture(t); const first = await f.run(); writeFileSync(join(f.cwd, 'value.mjs'), 'export const value = 9;\n');
  const next = await f.resume(first.runId, 'approve'); assert.equal(next.state, 'failed'); assert.match(next.message, /HEAD or worktree changed/); assert.equal(f.native.length, 1);
});

test('whitespace changes in a space-bearing filename remain in the input fingerprint', async t => {
  const f = await fixture(t); writeFileSync(join(f.cwd, ' trailing '), 'a\n'); const first = await f.run();
  writeFileSync(join(f.cwd, ' trailing '), 'a\n\n'); const next = await f.resume(first.runId, 'approve');
  assert.equal(next.state, 'failed'); assert.equal(f.native.length, 1);
});

for (const [label, options] of [['stale', { staleHandoff: true }]]) {
  test(`native zero with ${label} handoff does not complete its stage or automatically relaunch`, async t => {
    const f = await fixture(t, options); const first = await f.run(); assert.equal(first.state, 'failed');
    assert.equal(f.saved(first.runId).index, 0); const again = await f.resume(first.runId, 'approve');
    assert.ok(['failed', 'recovery_required'].includes(again.state)); assert.equal(f.native.length, 1);
  });
}

test('native nonzero preserves uncertain intent and never relaunches on explicit resume', async t => {
  const f = await fixture(t, { nativeCode: 8 }); const first = await f.run();
  assert.equal(first.state, 'recovery_required'); assert.equal(first.exitCode, 1);
  assert.equal((await f.resume(first.runId, 'approve')).state, 'recovery_required'); assert.equal(f.native.length, 1);
});

test('independent real native test rejects a wrong implementation despite agent zero and valid files', async t => {
  const f = await fixture(t, { wrongBehavior: true }); const first = await f.run(); const failed = await f.resume(first.runId, 'approve');
  assert.equal(failed.state, 'failed', failed.message); assert.match(failed.message, /real native project check failed/);
  const checks = f.saved(first.runId).pending.checks; assert.equal(checks.length, 1); assert.notEqual(checks[0].exitCode, 0);
  assert.match(checks[0].stderr, /3 !== 2/);
  t.diagnostic(`Observed wrong-behavior control: ${JSON.stringify(checks[0].argv)} exited ${checks[0].exitCode}; real assertion: ${checks[0].stderr}`);
  assert.equal(f.calls.filter(c => c.file === 'gh' && c.args[1] === 'create').length, 0);
});

test('implementation cannot rewrite the accepted independent expectations', async t => {
  const f = await fixture(t, { changeAccepted: true }); const first = await f.run(); const failed = await f.resume(first.runId, 'approve');
  assert.equal(failed.state, 'failed'); assert.equal(f.saved(first.runId).index, 2); assert.equal(f.native.length, 3);
});

test('lost PR reply reconciles the identical original and never repeats push/create', async t => {
  const f = await fixture(t, { lostPrReply: true }); const first = await f.run(); const uncertain = await f.resume(first.runId, 'approve');
  assert.equal(uncertain.state, 'recovery_required', uncertain.message);
  const count = () => f.calls.filter(c => c.file === 'git' && c.args[0] === 'push' || c.file === 'gh' && c.args[1] === 'create').length;
  const before = count(); assert.equal(before, 2); const recovered = await f.resume(first.runId);
  assert.equal(recovered.state, 'waiting', recovered.message); assert.equal(count(), before); assert.equal(f.native.length, 4);
  assert.equal(f.saved(first.runId).completed.find(s => s.id === 'open-pr').pr.number, 23);
});

test('pre-auth push failure recovers only on explicit approve using the original unpublished PR intent', async t => {
  const f = await fixture(t, { preAuthPushFailure: true });
  const first = await f.run(); const failed = await f.resume(first.runId, 'approve');
  assert.equal(failed.state, 'recovery_required', failed.message);
  const saved = f.saved(first.runId), original = structuredClone(saved.pending.intent);
  const context = saved.context, expected = saved.expected, completed = saved.completed;
  const effects = () => f.calls.filter(c => c.file === 'git' && c.args[0] === 'push' || c.file === 'gh' && c.args[1] === 'create');
  assert.equal(effects().length, 1); f.authFixed = true;
  assert.equal((await f.resume(first.runId)).state, 'recovery_required');
  assert.equal(effects().length, 1, 'inspection after auth repair cannot publish');
  const recovered = await f.resume(first.runId, 'approve');
  assert.equal(recovered.state, 'waiting', recovered.message);
  const after = f.saved(first.runId), pr = after.completed.find(row => row.id === 'open-pr');
  assert.deepEqual(pr.intent, original); assert.equal(pr.pr.headSha, original.headSha);
  assert.equal(after.runId, first.runId); assert.equal(after.context, context);
  assert.deepEqual(after.expected, expected); assert.deepEqual(after.completed.slice(0, -1), completed);
  assert.equal(f.native.length, 4, 'no stage or attempt replay');
  assert.deepEqual(effects().map(c => c.file), ['git', 'git', 'gh']);
  assert.ok(f.calls.some(c => c.file === 'git' && c.args[0] === 'ls-remote' && c.args.includes('--exit-code')), 'recovery must freshly prove remote absence');
  assert.equal((await f.resume(first.runId, 'approve')).state, 'waiting');
  assert.equal(effects().length, 3, 'original open PR never republishes');
});

test('unpublished PR recovery refuses present remote head and unreadable PR or remote queries', async t => {
  for (const refusal of ['remoteHead', 'remoteUnreadable', 'prUnreadable']) {
    await t.test(refusal, async t => {
      const f = await fixture(t, { preAuthPushFailure: true }); const first = await f.run();
      assert.equal((await f.resume(first.runId, 'approve')).state, 'recovery_required');
      const original = structuredClone(f.saved(first.runId).pending.intent); f.authFixed = true;
      f[refusal] = refusal === 'remoteHead' ? original.headSha : true;
      const recovered = await f.resume(first.runId, 'approve');
      assert.equal(recovered.state, 'recovery_required', recovered.message);
      assert.deepEqual(f.saved(first.runId).pending.intent, original);
      assert.equal(f.calls.filter(c => c.file === 'git' && c.args[0] === 'push').length, 1);
      assert.equal(f.calls.filter(c => c.file === 'gh' && c.args[1] === 'create').length, 0);
      assert.equal(f.native.length, 4);
    });
  }
});

test('lost reply during unpublished PR recovery reconciles without another push or create', async t => {
  const f = await fixture(t, { preAuthPushFailure: true, lostPrReply: true }); const first = await f.run();
  assert.equal((await f.resume(first.runId, 'approve')).state, 'recovery_required'); f.authFixed = true;
  assert.equal((await f.resume(first.runId, 'approve')).state, 'recovery_required');
  assert.ok(f.pr, 'actual create happened before lost reply');
  const count = () => f.calls.filter(c => c.file === 'git' && c.args[0] === 'push' || c.file === 'gh' && c.args[1] === 'create').length;
  assert.equal(count(), 3);
  assert.equal((await f.resume(first.runId, 'approve')).state, 'waiting');
  assert.equal(count(), 3); assert.equal(f.native.length, 4);
});

test('an existing same issue/workflow run cannot be duplicated or switch its saved agent', async t => {
  const f = await fixture(t); const first = await f.run(); const second = await f.run('small-change', 'codex');
  assert.equal(second.runId, first.runId); assert.equal(second.state, 'waiting'); assert.equal(f.native.length, 1);
  assert.equal(f.saved(first.runId).agent, 'claude');
});

test('feature optional skips reach real human approval without inventing extra native stages', async t => {
  const f = await fixture(t); let state = await f.run('feature'); assert.equal(state.stage, 'visual');
  state = await f.resume(state.runId, 'skip'); assert.equal(state.stage, 'try', state.message);
  state = await f.resume(state.runId, 'skip'); assert.equal(state.stage, 'approve', state.message);
  assert.deepEqual(f.native.map(v => v.input.stageId), ['understand', 'prompt-story', 'check']);
  assert.equal((await f.resume(state.runId)).stage, 'approve');
  state = await f.resume(state.runId, 'approve'); assert.equal(state.stage, 'prompt-pr');
  state = await f.resume(state.runId, 'skip'); assert.equal(state.stage, 'code-merge', state.message);
  assert.deepEqual(f.native.map(v => v.input.stageId), ['understand', 'prompt-story', 'check', 'build', 'verify']);
});

test('current mandatory stage cannot be skipped', async t => {
  const f = await fixture(t); const first = await f.run(); const refused = await f.resume(first.runId, 'skip');
  assert.equal(refused.state, 'failed'); assert.match(refused.message, /Only an optional/); assert.equal(f.native.length, 1);
});

test('concurrent project command refuses before creating another native intent', async t => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { pauseNative: gate }); const running = f.run();
  while (!f.native.length) await new Promise(resolve => setTimeout(resolve, 5));
  const competing = await f.resume(f.native[0].input.runId, 'approve');
  assert.equal(competing.state, 'failed'); assert.match(competing.message, /Another workflow command/);
  release(); await running; assert.equal(f.native.length, 1); assert.equal(existsSync(join(f.gitDir, 'pdd/workflows/.lock')), false);
});

test('torn local journal refuses without a replacement operation', async t => {
  const f = await fixture(t); const first = await f.run(); const path = join(f.gitDir, 'pdd/workflows', first.runId, 'journal.jsonl');
  writeFileSync(path, readFileSync(path, 'utf8') + '{'); const failed = await f.resume(first.runId, 'approve');
  assert.equal(failed.state, 'failed'); assert.match(failed.message, /journal is incomplete/); assert.equal(f.native.length, 1);
});

test('a journal beyond the Node string limit resumes its latest optional stage without rewriting history', { timeout: 120000 }, async t => {
  const f = await fixture(t), recipe = join(f.sourceCwd, '.pdd/workflows/large-journal');
  mkdirSync(recipe, { recursive: true });
  writeFileSync(join(recipe, 'workflow.json'), JSON.stringify({ version: 1, name: 'large-journal', overview: 'WORKFLOW.md', stages: [
    { id: 'first', kind: 'agent', protocol: 'report', optional: true, file: 'first.md' },
    { id: 'second', kind: 'agent', protocol: 'report', optional: true, file: 'second.md' }
  ] }));
  for (const name of ['WORKFLOW.md', 'first.md', 'second.md']) writeFileSync(join(recipe, name), 'Report the current optional step.\n');
  const first = await f.run('large-journal'), saved = f.saved(first.runId);
  const journal = join(f.gitDir, 'pdd/workflows', first.runId, 'journal.jsonl');
  const context = saved.context, original = readFileSync(journal), expectedHash = createHash('sha256').update(original);
  let bytes = original.length, rows = saved.seq;
  const fd = openSync(journal, 'a');
  try {
    while (bytes <= bufferConstants.MAX_STRING_LENGTH + 64 * 1024 * 1024) {
      saved.seq = ++rows;
      const row = Buffer.from(JSON.stringify({ seq: rows, event: 'retained.snapshot', state: saved }) + '\n');
      writeSync(fd, row); expectedHash.update(row); bytes += row.length;
    }
  } finally { closeSync(fd); }
  assert.ok(bytes > bufferConstants.MAX_STRING_LENGTH);
  const recovered = await f.resume(first.runId, 'skip');
  assert.equal(recovered.state, 'waiting', recovered.message); assert.equal(recovered.runId, first.runId);
  assert.equal(recovered.stage, 'second'); assert.equal(f.native.length, 0, 'skipping never starts an agent');
  const input = openSync(journal, 'r'), actualHash = createHash('sha256'), chunk = Buffer.alloc(64 * 1024);
  let position = 0;
  try {
    while (position < bytes) {
      const count = readSync(input, chunk, 0, Math.min(chunk.length, bytes - position), position);
      assert.ok(count > 0); actualHash.update(chunk.subarray(0, count)); position += count;
    }
    const end = statSync(journal).size, tail = Buffer.alloc(Math.min(end, 512 * 1024));
    readSync(input, tail, 0, tail.length, end - tail.length);
    const complete=tail.toString('utf8').trimEnd().split('\n').slice(1);
    const snapshot=complete.findIndex(line=>Object.hasOwn(JSON.parse(line),'state'));
    assert.ok(snapshot>=0,'tail contains a retained legacy snapshot before the new deltas');
    const last=journalRows(complete.slice(snapshot).join('\n')).at(-1);
    assert.ok(last.seq > rows); assert.equal(last.state.context, context);
    assert.equal(last.state.index, 1); assert.equal(last.state.completed[0].id, 'first');
    assert.equal(last.state.completed[0].skipped, true);
  } finally { closeSync(input); }
  assert.equal(actualHash.digest('hex'), expectedHash.digest('hex'), 'all original journal bytes remain unchanged');
  t.diagnostic(`Read ${bytes} bytes / ${rows} retained snapshots through normal same-run skip; original byte prefix unchanged.`);
});

test('streamed journal validates earlier history and refuses malformed or partial records before effects', async t => {
  for (const variant of ['sequence', 'run', 'malformed', 'partial']) {
    await t.test(variant, async t => {
      const f = await fixture(t); const first = await f.run();
      const path = join(f.gitDir, 'pdd/workflows', first.runId, 'journal.jsonl');
      const rows = journalRows(readFileSync(path,'utf8'));
      if (variant === 'sequence') { rows[0].seq = 10; rows[0].state.seq = 10; }
      if (variant === 'run') rows[0].state.runId = randomUUID();
      let raw = rows.map(JSON.stringify).join('\n') + '\n';
      if (variant === 'malformed') raw = '{not json}\n' + raw;
      if (variant === 'partial') raw += '{"seq":';
      writeFileSync(path, raw);
      const before = f.native.length, response = await f.resume(first.runId, 'approve');
      assert.equal(response.state, 'failed', response.message); assert.equal(f.native.length, before);
      assert.equal(readFileSync(path, 'utf8'), raw, 'invalid history is never repaired or rewritten');
    });
  }
});

test('streamed journal handles split UTF8 records and trailing whitespace without losing saved identity', async t => {
  const f = await fixture(t); const first = await f.run();
  const path = join(f.gitDir, 'pdd/workflows', first.runId, 'journal.jsonl');
  const rows = journalRows(readFileSync(path,'utf8'));
  rows[0].event = 'checkpoint 🎯 中文 '.repeat(20000);
  writeFileSync(path, rows.map(JSON.stringify).join('\n') + '\n \t\n');
  const before = f.native.length, response = await f.resume(first.runId);
  assert.equal(response.runId, first.runId); assert.equal(response.state, 'waiting', response.message);
  assert.equal(f.native.length, before);
});

test('separate prompt PR waits for real merge and refuses code work without its exact merged ancestry', async t => {
  const f = await fixture(t); let state = await f.run('feature');
  state = await f.resume(state.runId, 'skip'); state = await f.resume(state.runId, 'skip');
  state = await f.resume(state.runId, 'approve'); state = await f.resume(state.runId, 'approve');
  assert.equal(state.stage, 'prompt-merge', state.message);
  const before = f.native.length;
  f.merged = true;
  // A remote merged revision can be valid but not yet available in the local code branch.
  const actualHead = f.pr.headRefOid;
  f.pr.mergeCommit = { oid: 'a'.repeat(40) };
  const underlying = f.ports.execFile;
  f.ports.execFile = async (file, args, options) => {
    const answer = await underlying(file, args, options);
    if (file === 'gh' && args[0] === 'pr' && args[1] === 'list') {
      const rows = JSON.parse(answer.stdout); rows.forEach(pr => { pr.mergeCommit = { oid: 'a'.repeat(40) }; });
      return { stdout: JSON.stringify(rows) };
    }
    return answer;
  };
  state = await f.resume(state.runId); assert.equal(state.stage, 'build'); assert.equal(state.state, 'waiting');
  state = await f.resume(state.runId, 'approve'); assert.equal(state.state, 'waiting');
  assert.match(state.message, /exact merged proposal revision/); assert.equal(f.native.length, before);
  assert.equal(f.saved(state.runId).completed.find(s => s.id === 'prompt-merge').pr.headSha, actualHead);
});

test('saved run identity cannot be substituted under a different journal directory', async t => {
  const f = await fixture(t); const first = await f.run();
  const path = join(f.gitDir, 'pdd/workflows', first.runId, 'journal.jsonl');
  const rows = journalRows(readFileSync(path,'utf8'));
  for (const row of rows) row.state.runId = '00000000-0000-4000-8000-000000000000';
  writeFileSync(path, rows.map(JSON.stringify).join('\n') + '\n');
  const refused = await f.resume(first.runId, 'approve'); assert.equal(refused.state, 'failed'); assert.equal(f.native.length, 1);
});


test('verify cannot replace the human accepted native argv with a success-only command', async t => {
  const f = await fixture(t, { changedPlan: true }); const first = await f.run();
  const refused = await f.resume(first.runId, 'approve'); assert.equal(refused.state, 'failed');
  assert.match(refused.message, /actual accepted native test plan/);
  assert.equal(f.calls.filter(c => c.file === process.execPath).length, 0);
});

test('work stages cannot use the report-only empty artifact exception', async t => {
  const f = await fixture(t, { emptyWork: true }); const first = await f.run();
  const refused = await f.resume(first.runId, 'approve'); assert.equal(refused.state, 'failed');
  assert.match(refused.message, /requires concrete project artifacts/); assert.equal(f.native.length, 3);
});


test('a zero-exit native check that mutates execution input cannot certify the changed implementation', async t => {
  const f = await fixture(t, { mutatingTest: true }); const first = await f.run();
  const refused = await f.resume(first.runId, 'approve'); assert.equal(refused.state, 'failed');
  assert.match(refused.message, /changed their execution input/);
  assert.equal(f.saved(first.runId).pending.checks[0].exitCode, 0);
});

test('a zero-exit check that rewrites the closed handoff is detected by independent reread', async t => {
  const f = await fixture(t, { mutatingHandoff: true }); const first = await f.run();
  const refused = await f.resume(first.runId, 'approve'); assert.equal(refused.state, 'failed');
  assert.match(refused.message, /exact workflow handoff changed/);
  assert.equal(f.saved(first.runId).pending.checks[0].exitCode, 0);
});


test('journal directory redirection refuses without creating or modifying a project target', async t => {
  const f = await fixture(t); const target = join(f.cwd, 'notes'); mkdirSync(target);
  writeFileSync(join(target, 'sentinel'), 'preserve me'); symlinkSync(target, join(f.gitDir, 'pdd'));
  const refused = await f.run(); assert.equal(refused.state, 'failed'); assert.equal(f.native.length, 0);
  assert.equal(readFileSync(join(target, 'sentinel'), 'utf8'), 'preserve me'); assert.equal(existsSync(join(target, 'workflows')), false);
});

test('a multiply linked saved journal refuses without writing through its project alias', async t => {
  const f = await fixture(t); const first = await f.run();
  const journal = join(f.gitDir, 'pdd/workflows', first.runId, 'journal.jsonl');
  const alias = join(f.cwd, 'journal-alias'); linkSync(journal, alias); const before = readFileSync(alias, 'utf8');
  const refused = await f.resume(first.runId, 'approve'); assert.equal(refused.state, 'failed'); assert.equal(f.native.length, 1);
  assert.match(refused.message, /single ordinary metadata file/);
  assert.equal(readFileSync(alias, 'utf8'), before); unlinkSync(alias);
});


test('an unknown resume ID creates no placeholder that could block the next genuine run', async t => {
  const f = await fixture(t); const unknown = '00000000-0000-4000-8000-000000000000';
  const refused = await f.resume(unknown); assert.equal(refused.state, 'recovery_required');
  assert.equal(existsSync(join(f.gitDir, 'pdd/workflows', unknown)), false);
  const actual = await f.run(); assert.equal(actual.state, 'waiting', actual.message); assert.equal(f.native.length, 1);
});

test('an uncertain build cannot consume the clean merged-base transition exception', async t => {
  const f = await fixture(t, { failStage: 'build' }); let state = await f.run('feature');
  state = await f.resume(state.runId, 'skip'); state = await f.resume(state.runId, 'skip');
  state = await f.resume(state.runId, 'approve'); state = await f.resume(state.runId, 'approve');
  f.merged = true; state = await f.resume(state.runId, 'approve');
  assert.equal(state.state, 'recovery_required'); assert.equal(state.stage, 'build');
  const prior = f.saved(state.runId).expected;
  writeFileSync(join(f.cwd, 'local.txt'), 'a new committed input'); await f.git('add', '.'); await f.git('commit', '-m', 'local change');
  const count = f.native.length; const refused = await f.resume(state.runId, 'approve'); assert.equal(refused.state, 'recovery_required');
  assert.deepEqual(f.saved(state.runId).expected, prior); assert.equal(f.native.length, count);
});


test('merge observation rejects a replacement PR with the same intent and a different saved number/URL', async t => {
  const f = await fixture(t); const started = await f.run(); const waiting = await f.resume(started.runId, 'approve');
  assert.equal(waiting.stage, 'wait-merge'); const before = f.saved(started.runId).index;
  f.pr.number = 24; f.pr.url = 'https://github.com/example/project/pull/24'; f.merged = true;
  const refused = await f.resume(started.runId); assert.equal(refused.state, 'recovery_required');
  assert.match(refused.message, /saved original PR/); assert.equal(f.saved(started.runId).index, before);
  assert.equal(f.saved(started.runId).completed.some(step => step.id === 'wait-merge'), false);
});

test('saved optional skip survives interruption before skipped completion and cannot publish on approve', async t => {
  const f = await fixture(t); let state = await f.run('feature');
  state = await f.resume(state.runId, 'skip'); state = await f.resume(state.runId, 'skip');
  state = await f.resume(state.runId, 'approve'); assert.equal(state.stage, 'prompt-pr');
  // Stop before the next native launch, then retain only the exact durable decision boundary.
  f.ports.runHerdrStage = async () => { throw Error('synthetic next-stage stop before native'); };
  await f.resume(state.runId, 'skip');
  const journal = join(f.gitDir, 'pdd/workflows', state.runId, 'journal.jsonl');
  const rows = journalRows(readFileSync(journal,'utf8'));
  const boundary = rows.findIndex(row => row.event === 'optional.decision' && row.state.optional?.['prompt-pr']?.decision === 'skip');
  assert.ok(boundary >= 0); writeFileSync(journal, rows.slice(0, boundary + 1).map(JSON.stringify).join('\n') + '\n');
  const before = f.native.length; await f.resume(state.runId, 'approve');
  assert.equal(f.calls.filter(call => call.file === 'git' && call.args[0] === 'push' || call.file === 'gh' && call.args[1] === 'create').length, 0);
  assert.equal(f.native.length, before);
  const saved = f.saved(state.runId);
  assert.equal(saved.completed.find(step => step.id === 'prompt-pr')?.skipped, true);
  assert.equal(saved.completed.find(step => step.id === 'prompt-merge')?.skipped, true);
  assert.equal(saved.definitions[saved.index].id, 'build');
});

test('editable renamed workflow snapshots full bytes BEFORE allocation and leaves original dirty checkout untouched', async t => {
  let captured;
  const f = await fixture(t, { onAllocate: input => { captured = input; } });
  projectWorkflow(f); writeFileSync(join(f.sourceCwd, 'user-notes'), 'preserve uncommitted notes');
  const before = (await exec('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: f.sourceCwd })).stdout;
  const state = await f.run('snapshot-check');
  assert.equal(state.state, 'waiting', state.message); assert.equal(state.stage, 'implement');
  const saved = f.saved(state.runId);
  assert.deepEqual(saved.proposal.files.map(file => file.role).sort(), ['cases', 'prompt', 'story']);
  for (const file of saved.proposal.files) assert.equal(file.sha256, sha(readFileSync(join(f.cwd, file.path))));
  assert.ok(captured.baseContext.includes('Preservation sets the boundary'));
  assert.ok(captured.definition.files.some(file => file.content.includes('OWNED_RECIPE_A__')));
  assert.notEqual(f.cwd, f.sourceCwd); assert.equal(f.native[0].cwd, f.cwd);
  assert.ok(f.native[0].context.includes(`Current assigned project: ${f.cwd}`));
  assert.ok(f.native[0].context.includes('OWNED_RECIPE_A__'));
  assert.equal(existsSync(join(f.sourceCwd, 'cases.json')), false);
  assert.equal((await exec('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: f.sourceCwd })).stdout, before);
  const inspected = await f.resume(state.runId);
  assert.equal(inspected.state, 'waiting', inspected.message); assert.equal(f.native.length, 1);
  assert.equal(f.calls.filter(call => call.file === 'git' && call.args[0] === 'push' || call.file === 'gh' && call.args[1] === 'create').length, 0);
  const progressed = await f.resume(state.runId, 'approve', decisionBinding(f, state.runId));
  assert.equal(progressed.stage, 'merged', progressed.message);
  assert.deepEqual(f.native.map(stage => stage.input.stageId), ['agree', 'implement', 'prove']);
  assert.equal(f.saved(state.runId).completed.find(stage => stage.id === 'prove').handoff.checks[0].exitCode, 0);
  assert.equal(f.native[1].backend.phase, 'closed', 'next stage donates only prior closed backend');
  assert.notEqual(f.native[1].attemptId, f.native[0].attemptId);
  assert.deepEqual(f.saved(state.runId).assignment, saved.assignment);
});
test('changed recipe source or missing whole override cannot replace saved instructions on resume', async t => {
  for (const mutation of ['edit', 'remove']) await t.test(mutation, async t => {
    const f = await fixture(t); const directory = projectWorkflow(f); const first = await f.run('snapshot-check');
    assert.equal(first.state, 'waiting', first.message); assert.equal(first.stage, 'implement');
    const saved = f.saved(first.runId), binding = decisionBinding(f, first.runId);
    const inputPath = join(f.sourceCwd, '.git/pdd/workflow-inputs', first.runId, 'input.jsonl');
    const frozenBytes = readFileSync(inputPath);
    if (mutation === 'edit') writeFileSync(join(directory, 'work.md'), '# OWNED_RECIPE_B__\nDifferent instructions.');
    else rmSync(directory, { recursive: true });
    const inspected = await f.resume(first.runId);
    assert.equal(inspected.state, 'waiting', inspected.message); assert.equal(f.native.length, 1);
    const stale = await f.resume(first.runId, 'approve', { ...binding, expect: { ...binding.expect, seq: binding.expect.seq - 1 } });
    assert.equal(stale.state, 'waiting', stale.message); assert.equal(stale.code, 'stale_decision');
    assert.equal(f.native.length, 1); assert.equal(f.closes, 1);
    assert.equal(f.calls.filter(call => call.file === 'git' && call.args[0] === 'push' || call.file === 'gh' && call.args[1] === 'create').length, 0);
    const progressed = await f.resume(first.runId, 'approve', binding);
    assert.equal(progressed.state, 'waiting', progressed.message); assert.equal(progressed.stage, 'merged');
    assert.deepEqual(f.native.map(stage => stage.input.stageId), ['agree', 'implement', 'prove']);
    assert.ok(f.native.every(stage => stage.context === saved.context && !stage.context.includes('OWNED_RECIPE_B__')));
    const after = f.saved(first.runId);
    assert.equal(after.context, saved.context); assert.deepEqual(after.definition, saved.definition);
    assert.deepEqual(after.assignment, saved.assignment); assert.deepEqual(readFileSync(inputPath), frozenBytes);
  });
});
test('original guide edits retain the full frozen guide and require a current bound decision to progress', async t => {
  const localPackage = mkdtempSync(join(tmpdir(), 'pdd-context-package-'));
  t.after(() => rmSync(localPackage, { recursive: true, force: true }));
  for (const directory of ['docs', 'skills', '.pdd']) cpSync(join(packageRoot, directory), join(localPackage, directory), { recursive: true });
  const f = await fixture(t, { packageRoot: localPackage }); const first = await f.run();
  assert.equal(first.state, 'waiting', first.message); assert.equal(first.stage, 'check');
  const saved = f.saved(first.runId), binding = decisionBinding(f, first.runId);
  const inputPath = join(f.sourceCwd, '.git/pdd/workflow-inputs', first.runId, 'input.jsonl');
  const frozenBytes = readFileSync(inputPath);
  const journalPath = join(f.gitDir, 'pdd/workflows', first.runId, 'journal.jsonl');
  const journalBytes = readFileSync(journalPath);
  const guide = join(localPackage, 'docs', 'prompting-guide.md');
  const originalGuide = readFileSync(guide, 'utf8'), marker = 'CHANGED_ORIGINAL_GUIDE_AFTER_ACCEPTANCE__';
  assert.ok(saved.context.includes(originalGuide));
  assert.ok(JSON.parse(frozenBytes).baseContext.includes(originalGuide));
  writeFileSync(guide, originalGuide + `\n${marker}\n`);
  const inspected = await f.resume(first.runId);
  assert.equal(inspected.state, 'waiting', inspected.message); assert.equal(inspected.stage, 'check');
  const stale = await f.resume(first.runId, 'approve', { ...binding, expect: { ...binding.expect, seq: binding.expect.seq - 1 } });
  assert.equal(stale.state, 'waiting', stale.message); assert.equal(stale.code, 'stale_decision');
  assert.equal(f.native.length, 1); assert.equal(f.closes, 1);
  assert.deepEqual(readFileSync(journalPath), journalBytes);
  assert.equal(f.calls.filter(call => call.file === 'git' && call.args[0] === 'push' || call.file === 'gh' && call.args[1] === 'create').length, 0);
  const progressed = await f.resume(first.runId, 'approve', binding);
  assert.equal(progressed.state, 'waiting', progressed.message); assert.equal(progressed.stage, 'wait-merge');
  assert.deepEqual(f.native.map(stage => stage.input.stageId), ['scope', 'check', 'change', 'verify']);
  assert.ok(f.native.every(stage => stage.context === saved.context && stage.context.includes(originalGuide) && !stage.context.includes(marker)));
  const after = f.saved(first.runId);
  assert.equal(after.context, saved.context); assert.equal(after.contextDigest, saved.contextDigest);
  assert.deepEqual(after.definition, saved.definition); assert.deepEqual(after.assignment, saved.assignment);
  assert.deepEqual(readFileSync(inputPath), frozenBytes); assert.equal(f.contexts.length, 1);
  assert.equal(after.completed.find(stage => stage.id === 'verify').handoff.checks[0].exitCode, 0);
});
test('same-name workflows in separate projects retain distinct accepted content and assigned contexts', async t => {
  const a = await fixture(t), c = await fixture(t); projectWorkflow(a); projectWorkflow(c, 'OWNED_RECIPE_C__');
  const sa = await a.run('snapshot-check'), sc = await c.run('snapshot-check');
  assert.equal(sa.state, 'waiting', sa.message); assert.equal(sc.state, 'waiting', sc.message);
  assert.ok(a.native[0].context.includes('OWNED_RECIPE_A__')); assert.ok(!a.native[0].context.includes('OWNED_RECIPE_C__'));
  assert.ok(c.native[0].context.includes('OWNED_RECIPE_C__')); assert.ok(!c.native[0].context.includes(a.sourceCwd));
  assert.notEqual(a.saved(sa.runId).definition.digest, c.saved(sc.runId).definition.digest);
  assert.notEqual(sa.runId, sc.runId);
  for (const [f, state] of [[a, sa], [c, sc]]) {
    const saved = f.saved(state.runId);
    assert.equal(saved.assignment.runId, state.runId); assert.equal(saved.assignment.sourceRoot, f.sourceCwd);
    assert.equal(saved.assignment.worktreePath, f.cwd); assert.equal(saved.assignment.gitDir, f.gitDir);
    assert.equal(saved.definition.root, join(f.sourceCwd, '.pdd/workflows/snapshot-check'));
    assert.ok(f.native[0].context.includes(`Current assigned project: ${f.cwd}`));
  }
});
for (const variant of ['torn', 'tampered', 'symlink', 'hardlink']) {
  test(`saved preallocation input ${variant} refuses without reconstructing current context`, async t => {
    const f = await fixture(t); const first = await f.run();
    const inputPath = join(f.sourceCwd, '.git/pdd/workflow-inputs', first.runId, 'input.jsonl');
    const original = readFileSync(inputPath, 'utf8');
    if (variant === 'torn') writeFileSync(inputPath, original.slice(0, -1));
    if (variant === 'tampered') { const input = JSON.parse(original); input.baseContext += ' unapproved'; writeFileSync(inputPath, JSON.stringify(input) + '\n'); }
    if (variant === 'symlink') {
      const target = join(f.sourceCwd, '.git', 'redirected-input'); writeFileSync(target, original);
      unlinkSync(inputPath); symlinkSync(target, inputPath);
    }
    if (variant === 'hardlink') linkSync(inputPath, join(f.sourceCwd, '.git', 'input-alias'));
    const refused = await f.resume(first.runId, 'approve');
    assert.equal(refused.state, 'failed'); assert.equal(f.native.length, 1);
  });
}
test('five distinct issues retain unresolved stages without a repository cap while same-issue and same-run exclusivity remain', async t => {
  const f = await fixture(t, { defaultWorktree: true });
  const originalExec = f.ports.execFile, starts = [], inspected = [];
  f.ports.execFile = async (file, args, options) => {
    const match = file === 'gh' && args[0] === 'api' && /^repos\/example\/project\/issues\/(\d+)$/.exec(args[1]);
    if (match) return { stdout: JSON.stringify({ number: Number(match[1]), html_url: `https://github.com/example/project/issues/${match[1]}`,
      title: 'Independent issue', body: 'Keep this issue stage independent.', state: 'OPEN', isPullRequest: false }) };
    return originalExec(file, args, options);
  };
  f.ports.runHerdrStage = async (input, ports) => {
    starts.push(input);
    const backend = { version: 1, runId: input.runId, stageId: input.stageId, attemptId: input.attemptId,
      agent: input.agent, cwd: input.cwd, phase: 'submitted', nativeSession: null,
      promptDigest: sha(`${input.context}\n\n# Current workflow stage\n${input.instructions}`), evidence: { readySeq: 1 } };
    await ports.checkpoint(backend);
    return { state: 'recovery_required', backend, evidence: backend.evidence, reason: 'Retained uncertain original stage; no resend.' };
  };
  f.ports.inspectHerdrStage = async ({ backend }) => {
    inspected.push(structuredClone(backend));
    return { state: 'recovery_required', backend, evidence: backend.evidence, reason: 'Retained original uncertainty.' };
  };
  const runs = [];
  for (let issue = 21; issue <= 25; issue++) {
    const outcome = await runWorkflow({ name: 'small-change', issue: String(issue), agent: 'codex', cwd: f.sourceCwd, packageRoot }, f.ports);
    assert.equal(outcome.state, 'recovery_required', outcome.message);
    assert.equal(outcome.stage, 'scope');
    runs.push(outcome);
  }
  assert.equal(starts.length, 5);
  assert.equal(new Set(starts.map(input => input.runId)).size, 5);
  assert.equal(new Set(starts.map(input => input.cwd)).size, 5);
  assert.equal(existsSync(join(f.sourceCwd, '.git/pdd/workflow-admission')), false, 'no repository admission state is created');
  const duplicate = await runWorkflow({ name: 'small-change', issue: '21', agent: 'codex', cwd: f.sourceCwd, packageRoot }, f.ports);
  assert.equal(duplicate.runId, runs[0].runId, duplicate.message);
  assert.equal(duplicate.state, 'recovery_required');
  for (const decision of [undefined, 'approve']) {
    const resumed = await resumeWorkflow({ runId: runs[0].runId, decision, cwd: f.sourceCwd, packageRoot }, f.ports);
    assert.equal(resumed.runId, runs[0].runId);
    assert.equal(resumed.state, 'recovery_required', resumed.message);
  }
  assert.equal(starts.length, 5, 'duplicate and uncertain original resume never create another stage');
  assert.equal(inspected.length, 2);
  assert.ok(inspected.every(backend => backend.attemptId === starts[0].attemptId));
});
test('historical admission claims remain byte-identical through normal stage acceptance and cleanup', async t => {
  const f = await fixture(t), root = join(f.sourceCwd, '.git/pdd/workflow-admission'); mkdirSync(root, { recursive: true });
  const claims = Array.from({ length: 4 }, (_, i) => ({ path: join(root, `slot-${i}.jsonl`),
    bytes: JSON.stringify({ runId: randomUUID(), attemptId: randomUUID(), cwd: `/retained/unknown-${i}` }) + '\n' }));
  for (const claim of claims) writeFileSync(claim.path, claim.bytes);
  const first = await f.run();
  assert.equal(first.state, 'waiting', first.message); assert.equal(first.stage, 'check');
  assert.equal(f.native.length, 1); assert.equal(f.closes, 1);
  assert.equal(f.saved(first.runId).accepted, undefined, 'a newly authored proposal still requires the next explicit advance');
  assert.equal(Object.hasOwn(f.saved(first.runId).pending ?? {}, 'admissionSlot'), false);
  for (const claim of claims) assert.equal(readFileSync(claim.path, 'utf8'), claim.bytes);
});
test('cleanup ambiguity retains accepted evidence and never retries close or prompt', async t => {
  const f = await fixture(t); let closeCalls = 0;
  f.ports.closeHerdrStage = async ({ backend }, ports) => {
    closeCalls++; await ports.checkpoint({ ...backend, phase: 'close_intent' });
    return { state: 'recovery_required', backend: { ...backend, phase: 'close_intent' }, reason: 'lost close reply' };
  };
  const first = await f.run(); assert.equal(first.state, 'recovery_required');
  const saved = f.saved(first.runId); assert.equal(saved.pending.kind, 'cleanup');
  assert.match(saved.pending.acceptance.evidenceDigest, /^[a-f0-9]{64}$/);
  const again = await f.resume(first.runId, 'approve'); assert.equal(again.state, 'recovery_required');
  assert.equal(closeCalls, 1); assert.equal(f.native.length, 1);
});
test('cross-process attachment excludes acceptance and invalidates the earlier candidate without blocking live controller polling', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { pauseNative: gate }); const running = f.run();
  while (!f.native.length) await new Promise(resolve => setTimeout(resolve, 5));
  const runId = f.native[0].input.runId, assignment = f.saved(runId).assignment;
  const script = `import {attachWorkflow} from ${JSON.stringify(new URL('../src/workflow-runner.mjs', import.meta.url).href)};
    import {loadGuidance} from ${JSON.stringify(new URL('../src/guidance.mjs', import.meta.url).href)};
    const {withWorkflowLock,inspectWorkflowLock}=await import(${JSON.stringify(new URL('./cli/workflow-test-lock.mjs', import.meta.url).href)});
    const result=await attachWorkflow({runId:${JSON.stringify(runId)},cwd:${JSON.stringify(f.sourceCwd)},packageRoot:${JSON.stringify(packageRoot)}}, {
      loadGuidance,withWorkflowLock,inspectWorkflowLock,lookupIssueWorktree:async()=>({state:'ready',assignment:${JSON.stringify(assignment)}}), allocateIssueWorktree:async()=>{throw Error('no allocation')},
      attachHerdrStage:async()=>{process.stdout.write('ATTACHED\\n');await new Promise(resolve=>process.stdin.once('data',resolve));return 0;}});
    process.stdout.write(JSON.stringify(result)+'\\n');`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { cwd: f.sourceCwd, stdio: ['pipe','pipe','pipe'] });
  let output = '', errors = ''; child.stdout.on('data', value => { output += value; }); child.stderr.on('data', value => { errors += value; });
  const closed = new Promise(resolve => child.once('close', code => resolve(code)));
  try {
    for (let i = 0; i < 200 && !output.includes('ATTACHED'); i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(output.includes('ATTACHED'), errors + output);
    release(); const paused = await running; assert.equal(paused.state, 'waiting', paused.message);
    assert.equal(f.closes, 0); assert.equal(f.saved(runId).pending.kind, 'agent');
  } finally { release(); child.stdin.end('detach\n'); }
  assert.equal(await closed, 0, errors);
  const invalidated = await f.resume(runId, 'approve');
  assert.equal(invalidated.state, 'waiting', invalidated.message); assert.match(invalidated.message, /Attachment invalidated/); assert.equal(f.closes, 0);
  const fresh = await f.resume(runId, 'approve'); assert.equal(fresh.state, 'waiting', fresh.message);
  assert.equal(f.native.length, 1); assert.equal(f.closes, 1);
});

test('fresh-process resume preserves frozen recipe and refuses a stale decision before any replacement stage delivery', async t => {
  const f = await fixture(t); const directory = projectWorkflow(f); const first = await f.run('snapshot-check');
  assert.equal(first.state, 'waiting', first.message);
  const assignment = f.saved(first.runId).assignment;
  const binding = decisionBinding(f, first.runId);
  binding.expect.seq--;
  const journalPath = join(f.gitDir, 'pdd/workflows', first.runId, 'journal.jsonl');
  const journalBytes = readFileSync(journalPath);
  writeFileSync(join(directory, 'work.md'), '# OWNED_RECIPE_B__\nChanged after accepted A.\n');
  const script = `import {resumeWorkflow} from ${JSON.stringify(new URL('../src/workflow-runner.mjs', import.meta.url).href)};
    import {loadGuidance} from ${JSON.stringify(new URL('../src/guidance.mjs', import.meta.url).href)};
    import {execFile as callback} from 'node:child_process';import {promisify} from 'node:util';const exec=promisify(callback);
    const {withWorkflowLock,inspectWorkflowLock}=await import(${JSON.stringify(new URL('./cli/workflow-test-lock.mjs', import.meta.url).href)});
    const effects=[];
    const result=await resumeWorkflow(${JSON.stringify({runId:first.runId,cwd:f.sourceCwd,packageRoot,decision:'approve',...binding})},{loadGuidance,withWorkflowLock,inspectWorkflowLock,
      lookupIssueWorktree:async()=>({state:'ready',assignment:${JSON.stringify(assignment)}}),allocateIssueWorktree:async()=>{effects.push('allocation');throw Error('no allocation')},
      runHerdrStage:async()=>{effects.push('stage');throw Error('UNEXPECTED_STAGE_DELIVERY');},
      execFile:async(file,args,options)=>{
        if(file==='git'&&args[0]==='push'||file==='gh'&&args[1]==='create'){effects.push('publication');throw Error('UNEXPECTED_PUBLICATION');}
        return file==='gh'?{stdout:JSON.stringify(args[0]==='repo'?{nameWithOwner:'example/project',defaultBranchRef:{name:'main'},url:'https://github.com/example/project'}:{number:17,html_url:${JSON.stringify(issueUrl)},title:'Use two',body:'Two',isPullRequest:false})}:exec(file,args,options);}});
    process.stdout.write(JSON.stringify({result,effects}));`;
  const child = await exec(process.execPath, ['--input-type=module', '-e', script], { cwd: f.sourceCwd });
  const {result: refused, effects} = JSON.parse(child.stdout);
  assert.equal(refused.state, 'waiting', refused.message); assert.equal(refused.code, 'stale_decision');
  assert.deepEqual(effects, []); assert.deepEqual(readFileSync(journalPath), journalBytes);
  assert.equal(f.native.length, 1); assert.equal(f.saved(first.runId).index, 1);
  assert.ok(f.saved(first.runId).context.includes('OWNED_RECIPE_A__'));
  assert.ok(!f.saved(first.runId).context.includes('OWNED_RECIPE_B__'));
});

test('main transports real handoffs through process-proved stage panes and preserves the controller tab',async t=>{
  const f=await fixture(t,{defaultWorktree:true}),foreground=f.ports.launchNativeSession,calls=[];let active=null,paneCount=0;
  f.ports.controller={herdrSession:'default',workspaceId:'w1',tabId:'w1:t1',paneId:'controller'};
  const transport=base=>({...base,validateLaunchSelection:async()=>true,nativeArgs:({selection,...input})=>[...(input.agent==='codex'?['--dangerously-bypass-approvals-and-sandbox']:['--dangerously-skip-permissions']),...(selection?['--model',selection.model]:[])],pollMs:1,observeMs:100,processStartIdentity:async()=> 'process-start',claimWorkflowSession:async()=>({state:'owned',release:async()=>{}}),promoteWorkflowClaim:async({claim})=>claim,
    execFile:async(file,argv,opts)=>{assert.equal(file,f.herdrExecutable);assert.equal(argv[1],'default');const a=argv.slice(2);calls.push(a);const encode=x=>({stdout:JSON.stringify(x)});
      const agent=()=>({workspace_id:'w1',tab_id:'w1:t1',pane_id:active.pane,terminal_id:active.terminal,name:active.name,agent:'claude',cwd:f.cwd,agent_status:active.prompted?'done':'idle',interactive_ready:true,launch_pending:false,state_change_seq:active.prompted?3:1,agent_session:{kind:'id',agent:'claude',value:active.native}});
      if(a[0]==='pane'&&a[1]==='split'){active={pane:'stage-'+ ++paneCount,terminal:'terminal-'+paneCount,native:randomUUID()};return encode({result:{pane:{workspace_id:'w1',tab_id:'w1:t1',pane_id:active.pane,terminal_id:active.terminal}}});}
      if(a[0]==='pane'&&a[1]==='process-info')return encode({result:{process_info:{pane_id:active.pane,foreground_processes:[{pid:123,name:'claude',cwd:f.cwd,argv:['claude']}]}}});
      if(a[0]==='agent'&&a[1]==='start'){active.name=a[2];return encode({result:{agent:agent()}});}
      if(a[0]==='agent'&&a[1]==='get')return encode({result:{agent:agent()}});
      if(a[0]==='agent'&&a[1]==='prompt'){await foreground({agent:'claude',cwd:f.cwd,context:a[3],request:a[3]});active.prompted=true;return encode({result:{agent:{...agent(),agent_status:'working',state_change_seq:2}}});}
      if(a[0]==='pane'&&a[1]==='close'){assert.equal(a[2],active.pane);active=null;return encode({id:'cli:pane:close',result:{type:'ok'}});}
      if(a[0]==='pane'&&a[1]==='list')return encode({result:{type:'pane_list',panes:[{pane_id:'controller'},{pane_id:'person'}]}});
      assert.fail(JSON.stringify(a));
    }});
  f.ports.runHerdrStage=(input,ports)=>runHerdrStage(input,transport(ports));f.ports.inspectHerdrStage=(input,ports)=>inspectHerdrStage(input,transport(ports));f.ports.closeHerdrStage=(input,ports)=>closeHerdrStage(input,transport(ports));
  const first=await f.run();assert.equal(first.state,'waiting',first.message);const next=await f.resume(first.runId,'approve');assert.equal(next.stage,'wait-merge',next.message);
  assert.equal(calls.filter(a=>a[0]==='agent'&&a[1]==='prompt').length,4);assert.equal(calls.filter(a=>a[0]==='pane'&&a[1]==='close').length,4);assert.ok(!calls.some(a=>['server','workspace','tab'].includes(a[0])));
});

test('resume owns the controller lock before reading the journal and cannot advance a stale optional snapshot', async t => {
  const f=await fixture(t), recipe=join(f.sourceCwd,'.pdd/workflows/journal-race');mkdirSync(recipe,{recursive:true});
  writeFileSync(join(recipe,'workflow.json'),JSON.stringify({version:1,name:'journal-race',overview:'WORKFLOW.md',stages:[
    {id:'first',kind:'agent',protocol:'report',optional:true,file:'first.md'},
    {id:'second',kind:'agent',protocol:'report',optional:true,file:'second.md'}]}));
  for(const name of ['WORKFLOW.md','first.md','second.md'])writeFileSync(join(recipe,name),'Report only the current step.\n');
  const first=await f.run('journal-race');assert.equal(first.stage,'first');assert.equal(f.native.length,0);
  const saved=f.saved(first.runId), journal=join(f.gitDir,'pdd/workflows',first.runId,'journal.jsonl');
  const releasePath=join(f.sourceCwd,'.git','release-journal-reader');
  const script=`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
    const open=fs.openSync;let intercepted=false;
    fs.openSync=function(path,...args){const value=open.call(this,path,...args);
      if(String(path)===${JSON.stringify(journal)}&&!intercepted){intercepted=true;process.stdout.write('JOURNAL_READ\\n');
        const wait=new Int32Array(new SharedArrayBuffer(4));const end=Date.now()+15000;
        while(!fs.existsSync(${JSON.stringify(releasePath)})){if(Date.now()>end)throw Error('Test reader release timed out');Atomics.wait(wait,0,0,5);}}
      return value;};syncBuiltinESMExports();
    const {resumeWorkflow}=await import(${JSON.stringify(new URL('../src/workflow-runner.mjs',import.meta.url).href)});
    const {loadGuidance}=await import(${JSON.stringify(new URL('../src/guidance.mjs',import.meta.url).href)});
    const {execFile:callback}=await import('node:child_process');const {promisify}=await import('node:util');const exec=promisify(callback);
    const {withWorkflowLock,inspectWorkflowLock}=await import(${JSON.stringify(new URL('./cli/workflow-test-lock.mjs', import.meta.url).href)});const result=await resumeWorkflow(${JSON.stringify({runId:first.runId,cwd:f.sourceCwd,packageRoot,decision:'approve'})},{loadGuidance,withWorkflowLock,inspectWorkflowLock,
      resolveWorkflowModel:async()=>({state:'selected',selection:${JSON.stringify(saved.launchSelection)}}),allocateIssueWorktree:async()=>{throw Error('No allocation');},lookupIssueWorktree:async()=>({state:'ready',assignment:${JSON.stringify(saved.assignment)}}),
      execFile:async(file,args,options)=>file==='gh'?{stdout:JSON.stringify(args[0]==='repo'?{nameWithOwner:'example/project',defaultBranchRef:{name:'main'},url:'https://github.com/example/project'}:{number:17,html_url:${JSON.stringify(issueUrl)},title:'Report',body:'Report only',isPullRequest:false})}:exec(file,args,options),
      runHerdrStage:async(input)=>{const data=JSON.parse(input.instructions.split('PDD_STAGE_INPUT_JSON\\n')[1].split('\\nPDD_STAGE_INPUT_END')[0]);
        fs.writeFileSync(data.handoffPath,JSON.stringify({version:1,runId:input.runId,stageId:input.stageId,issueUrl:${JSON.stringify(issueUrl)},inputRevision:data.inputRevision,summary:'Substantive report for this stage only.',files:[]}));
        const {createHash}=await import('node:crypto');const backend={version:1,runId:input.runId,stageId:input.stageId,attemptId:input.attemptId,agent:input.agent,cwd:input.cwd,phase:'candidate',terminalId:'test-terminal',promptDigest:createHash('sha256').update(input.context+'\\n\\n# Current workflow stage\\n'+input.instructions).digest('hex'),evidence:{readySeq:1,workingSeq:2,settledSeq:3}};
        await input.checkpoint(backend);return{state:'settled',backend,evidence:backend.evidence};},
      inspectHerdrStage:async({backend})=>({state:'settled',backend,evidence:backend.evidence}),
      closeHerdrStage:async({backend},ports)=>{const closed={...backend,phase:'closed'};await ports.checkpoint(closed);return{state:'closed',backend:closed};}});
    process.stdout.write(JSON.stringify(result)+'\\n');`;
  const child=spawn(process.execPath,['--input-type=module','-e',script],{cwd:f.sourceCwd,stdio:['ignore','pipe','pipe']});
  let output='',errors='';child.stdout.on('data',value=>{output+=value;});child.stderr.on('data',value=>{errors+=value;});
  const closed=new Promise(resolve=>child.once('close',resolve));let competing;
  try{
    for(let i=0;i<400&&!output.includes('JOURNAL_READ');i++)await new Promise(resolve=>setTimeout(resolve,10));
    assert.ok(output.includes('JOURNAL_READ'),output+errors);
    competing=await f.resume(first.runId,'skip');
  }finally{writeFileSync(releasePath,'release');}
  assert.equal(await closed,0,output+errors);
  const rows=journalRows(readFileSync(journal,'utf8'));
  t.diagnostic(`Competing controller: ${competing?.state}; duplicate sequences: ${new Set(rows.map(row=>row.seq)).size!==rows.length}`);
  assert.equal(competing.state,'failed',competing.message);assert.match(competing.message,/Another workflow command/);
  assert.equal(new Set(rows.map(row=>row.seq)).size,rows.length);
  assert.equal(rows.at(-1).state.index,1);assert.equal(rows.at(-1).state.completed[0].id,'first');
  assert.equal(rows.at(-1).state.completed[0].skipped,undefined);
});

test('verified publication refuses source changed by a later report despite earlier successful real checks', async t => {
  const f=await fixture(t), directory=projectWorkflow(f), path=join(directory,'workflow.json');
  const definition=JSON.parse(readFileSync(path,'utf8'));
  definition.stages.splice(3,0,{id:'later-report',kind:'agent',protocol:'report',requiredRoles:['implementation'],file:'later.md'});
  writeFileSync(path,JSON.stringify(definition));writeFileSync(join(directory,'later.md'),'Report current source changes.\n');
  const run=f.ports.runHerdrStage;
  f.ports.runHerdrStage=async(...args)=>{
    const result=await run(...args);
    if(args[0].stageId==='later-report'){
      writeFileSync(join(f.cwd,'value.mjs'),'export const value = 3;\n');await f.git('add','value.mjs');await f.git('commit','-m','late source change');
      const input=f.native.at(-1).input, handoff=JSON.parse(readFileSync(input.handoffPath,'utf8'));
      handoff.files=[{path:'value.mjs',sha256:sha(readFileSync(join(f.cwd,'value.mjs'))),role:'implementation'}];
      writeFileSync(input.handoffPath,JSON.stringify(handoff));
    }
    return result;
  };
  const first=await f.run('snapshot-check');
  assert.equal(first.state,'waiting',first.message);assert.equal(first.stage,'implement');
  const refused=await f.resume(first.runId,'approve',decisionBinding(f,first.runId));
  assert.equal(refused.state,'failed',refused.message);assert.match(refused.message,/checks for this exact current source/);
  const verified=f.saved(first.runId).completed.find(stage=>stage.id==='prove');assert.equal(verified.handoff.checks[0].exitCode,0);
  assert.notEqual(verified.verification.output.head,await f.git('rev-parse','HEAD'));
  assert.equal(f.calls.filter(call=>call.file==='git'&&call.args[0]==='push'||call.file==='gh'&&call.args[1]==='create').length,0);
});

test('default allocator and lookup preserve the original issue run across providers and complete real assigned checks', async t => {
  const f=await fixture(t,{defaultWorktree:true});
  assert.equal('allocateIssueWorktree' in f.ports,false);assert.equal('lookupIssueWorktree' in f.ports,false);
  const first=await f.run();assert.equal(first.state,'waiting',first.message);assert.equal(first.stage,'check');
  const original=f.saved(first.runId).assignment;
  const conflict=await f.run('small-change','codex');
  assert.equal(conflict.runId,first.runId,conflict.message);assert.equal(conflict.state,'waiting',conflict.message);
  assert.equal(f.native.length,1);assert.equal(f.saved(first.runId).agent,'claude');
  const progressed=await f.resume(first.runId,'approve');assert.equal(progressed.stage,'wait-merge',progressed.message);
  assert.deepEqual(f.saved(first.runId).assignment,original);
  assert.equal(f.saved(first.runId).completed.find(stage=>stage.id==='verify').handoff.checks[0].exitCode,0);
  assert.equal((await exec('git',['status','--porcelain'],{cwd:f.sourceCwd})).stdout,'');
});


test('default conflict with a live original controller reports its original identity without reading stale progress or launching twice', async t => {
  let release;const gate=new Promise(resolve=>{release=resolve;});const f=await fixture(t,{defaultWorktree:true,pauseNative:gate});
  const running=f.run();let competing;
  try{
    while(!f.native.length)await new Promise(resolve=>setTimeout(resolve,5));
    const runId=f.native[0].input.runId;
    competing=await f.run('small-change','codex');
    assert.equal(competing.runId,runId,competing.message);assert.equal(competing.state,'failed');
    assert.match(competing.message,/Another workflow command/);assert.equal(f.native.length,1);
    assert.equal(f.saved(runId).pending.kind,'agent');
  }finally{release();await running;}
  assert.equal(f.calls.filter(call=>call.file==='git'&&call.args[0]==='worktree'&&call.args[1]==='add').length,1);
});

test('default conflict refuses an aliased issue claim before accepting it as an assignment or replaying allocation', async t => {
  const f=await fixture(t,{defaultWorktree:true});const first=await f.run();
  const root=join(f.sourceCwd,'.git/pdd/worktree-assignments'),claim=join(root,'issues/17.json');
  const record=join(root,'runs',first.runId+'.json'),before=readFileSync(record,'utf8');
  unlinkSync(claim);symlinkSync(record,claim);
  const refused=await f.run('small-change','codex');assert.equal(refused.state,'failed');
  assert.match(refused.message,/issue claim is not an ordinary owned metadata record/);
  assert.equal(readFileSync(record,'utf8'),before);assert.equal(f.native.length,1);
  assert.equal(f.calls.filter(call=>call.file==='git'&&call.args[0]==='worktree'&&call.args[1]==='add').length,1);
});

async function unsentFirstDispatch(t, phase) {
  const f = await fixture(t), run = f.ports.runHerdrStage, calls = [], observations = [];
  let original;
  f.setupBlocked = true;
  f.ports.runHerdrStage = async (value, ports) => {
    const { checkpoint, ...request } = value; calls.push(structuredClone(request));
    if (!original) {
      original = { version: 1, runId: value.runId, stageId: value.stageId, attemptId: value.attemptId,
        agent: value.agent, cwd: value.cwd, phase, promptDigest: sha(`${value.context}\n\n# Current workflow stage\n${value.instructions}`),
        session: 'owned-session', server: { session: 'owned-session', socket: '/captured/owned.sock', protocol: 22, version: '0.9.1' },
        agentName: 'same-original-agent', workspaceId: 'same-workspace', tabId: 'same-tab', paneId: 'same-pane',
        terminalId: `terminal-${value.attemptId}`, nativeSession: null, evidence: phase === 'ready' ? { readySeq: 1 } : {} };
      await checkpoint(original);
      return { state: 'blocked', backend: original, evidence: original.evidence, reason: 'Finish native setup with pdd workflow attach RUN_ID' };
    }
    assert.deepEqual(request, { ...calls[0], backend: original }, 'continue only original exact request/agent identity');
    if (f.setupBlocked) return { state: 'blocked', backend: original, evidence: original.evidence, reason: 'Finish native setup with pdd workflow attach RUN_ID' };
    const outcome = await run({ ...value, checkpoint: backend => checkpoint({ ...original, ...backend }) }, ports);
    return { ...outcome, backend: { ...original, ...outcome.backend } };
  };
  const inspect = f.ports.inspectHerdrStage;
  f.ports.inspectHerdrStage = async (value, ports) => {
    observations.push(structuredClone(value));
    return value.backend.phase === 'candidate' ? inspect(value, ports)
      : { state: 'recovery_required', backend: value.backend, evidence: value.backend.evidence, reason: 'no_observed_prompt_activity' };
  };
  const first = await f.run(); assert.equal(first.state, 'waiting', first.message); assert.equal(f.native.length, 0);
  const journal = join(f.gitDir, 'pdd/workflows', first.runId, 'journal.jsonl');
  return { f, first, calls, observations, rewrite(change) {
    const rows = journalRows(readFileSync(journal,'utf8'));
    change(rows.at(-1).state); writeFileSync(journal, rows.map(JSON.stringify).join('\n') + '\n');
  } };
}

for (const phase of ['start_intent', 'ready']) for (const legacy of [true, false])
  test(`same-agent first dispatch resumes ${phase} using exact ${legacy ? 'legacy digest-bound' : 'saved'} request after normal setup`, async t => {
    const { f, first, calls, rewrite } = await unsentFirstDispatch(t, phase);
    if (legacy) rewrite(state => { delete state.pending.instructions; });
    const original = f.saved(first.runId), attempt = original.pending.attemptId;
    const inspected = await f.resume(first.runId); assert.equal(inspected.state, 'recovery_required'); assert.equal(calls.length, 1);
    const blocked = await f.resume(first.runId, 'approve');
    assert.equal(blocked.state, 'waiting'); assert.match(blocked.message, /workflow attach/); assert.equal(calls.length, 2); assert.equal(f.native.length, 0);
    f.setupBlocked = false;
    const continued = await f.resume(first.runId, 'approve');
    assert.equal(continued.state, 'waiting', continued.message); assert.equal(continued.stage, 'check');
    assert.equal(continued.runId, first.runId); assert.equal(calls.length, 3); assert.equal(f.native.length, 1);
    assert.equal(f.native[0].attemptId, attempt); assert.equal(f.native[0].context, calls[0].context);
    assert.equal(f.native[0].instructions, calls[0].instructions);
    assert.deepEqual(f.saved(first.runId).assignment, original.assignment);
    assert.equal(f.saved(first.runId).completed[0].backend.agentName, original.pending.backend.agentName);
  });

test('first-dispatch selector leaves every delivery or later phase inspection-only with no native call', async t => {
  const { f, first, calls, rewrite } = await unsentFirstDispatch(t, 'start_intent');
  f.ports.inspectHerdrStage = async ({ backend }) => ({ state: 'recovery_required', backend, evidence: backend.evidence, reason: 'original inspection only' });
  for (const phase of ['server_intent', 'workspace_intent', 'prompt_intent', 'submitted', 'candidate', 'close_intent', 'closed', 'unknown']) {
    rewrite(state => { state.pending.backend.phase = phase; });
    const seen = await f.resume(first.runId, 'approve'); assert.equal(seen.state, 'recovery_required', `${phase}: ${seen.message}`);
    assert.equal(calls.length, 1); assert.equal(f.native.length, 0);
  }
});

test('first-dispatch continuation refuses changed original request or worktree before native call', async t => {
  const { f, first, calls, rewrite } = await unsentFirstDispatch(t, 'start_intent');
  const instructions = f.saved(first.runId).pending.instructions;
  rewrite(state => { state.pending.instructions += '\nChanged prompt'; });
  const tampered = await f.resume(first.runId, 'approve');
  assert.equal(tampered.state, 'failed'); assert.match(tampered.message, /request bytes cannot be proved/); assert.equal(calls.length, 1);
  rewrite(state => { state.pending.instructions = instructions; });
  writeFileSync(join(f.cwd, 'value.mjs'), 'export const value = 9;\n');
  const changed = await f.resume(first.runId, 'approve');
  assert.equal(changed.state, 'failed'); assert.match(changed.message, /HEAD or worktree changed/); assert.equal(calls.length, 1);
});

// Expectations below are the P1 contract vectors; test adapters supply observations,
// never a model, live GitHub account, or an implementation-derived expected answer.
const p1Vectors=JSON.parse(readFileSync(join(packageRoot,'vectors/cli/workflow-runner-p1.json'),'utf8'));
const p1Case=id=>p1Vectors.cases.find(c=>c.id===id).expected;
async function p1Fixture(t,options={}) {
  const f=await fixture(t,options),frozen=new Map();
  const runtime={v:1,releaseId:'synthetic-release',versionRoot:packageRoot,packageRoot,node:process.execPath,herdr:f.herdrExecutable,bin:join(packageRoot,'bin','pdd.mjs'),pddVersion:'0.1.0',alphaDigest:'a'.repeat(64),clientDigest:null,nodeVersion:process.version,credentialHelper:null};
  f.ports.runtime=runtime;
  f.ports.freezeWorkflowInputs=async input=>{
    const directory=join(input.runDir,'frozen');mkdirSync(directory);const bytes=JSON.stringify(input);writeFileSync(join(directory,'inputs.json'),bytes);frozen.set(input.runDir,sha(bytes));return {runtime};
  };
  f.ports.checkWorkflowRuntime=async ({runDir})=>({ok:existsSync(join(runDir,'frozen','inputs.json'))&&sha(readFileSync(join(runDir,'frozen','inputs.json')))===frozen.get(runDir)});
  f.ports.controller={herdrSession:'default',workspaceId:'workspace',tabId:'run-tab',paneId:'controller'};
  f.ports.processStartIdentity=async()=> 'controller-process-start';
  const command=f.ports.execFile;
  f.ports.execFile=async(file,args,opts)=>file===f.herdrExecutable?{stdout:JSON.stringify({result:{process_info:{pane_id:'controller',foreground_processes:[{pid:process.pid,argv:[process.execPath,runtime.bin,'workflow','drive',f.activeId,...(f.activeDrive?.launchId?['--launch-id',f.activeDrive.launchId]:[]),...(f.activeDrive?.decision?['--decision',f.activeDrive.decision,'--id',f.activeDrive.decisionId,'--rev',String(f.activeDrive.expectedRev)]:[]),...(f.activeDrive?.expect?['--expect-stage',f.activeDrive.expect.stage,'--expect-seq',String(f.activeDrive.expect.seq)]:[])]}]}}})}:command(file,args,opts);
  f.prepare=async (extra={})=>{
    const value=await prepareWorkflow({name:'small-change',issue:'17',agent:'claude',cwd:f.sourceCwd,packageRoot,...extra},f.ports);f.activeId=value.runId;return value;
  };
  f.drive=(extra={})=>{f.activeDrive=extra;return driveWorkflow({runId:f.activeId,cwd:f.sourceCwd,packageRoot,...extra},f.ports);};
  f.rewrite=change=>{const path=join(f.gitDir,'pdd/workflows',f.activeId,'journal.jsonl'),rows=journalRows(readFileSync(path,'utf8'));change(rows.at(-1).state);writeFileSync(path,rows.map(JSON.stringify).join('\n')+'\n');};
  return f;
}

test('P1 prepare-no-agent and display-index-failure-recovery: freeze and registry precede effects',async t=>{
  const f=await p1Fixture(t);f.ports.appendRunIndex=async()=>{throw Error('display index offline');};
  const prepared=await f.prepare();assert.equal(prepared.state,p1Case('prepare-no-agent').state,prepared.message);assert.equal(f.native.length,p1Case('prepare-no-agent').stagePrompts);
  const locator=JSON.parse(readFileSync(join(f.ports.home,'.pdd/runs/registry',prepared.runId+'.json')));assert.equal(locator.runDir,prepared.runDir);assert.equal(locator.commonDir,join(f.sourceCwd,'.git'));
  assert.ok(existsSync(join(prepared.runDir,'frozen/inputs.json')));const j=await readWorkflowJournal({runDir:prepared.runDir});assert.equal(j.seq,j.state.seq);assert.equal(j.state.runtime.releaseId,'synthetic-release');assert.equal(j.state.pending,null);
  const driven=await f.drive();assert.equal(driven.exitCode,p1Case('human-exit').exitCode,driven.message);const saved=f.saved(prepared.runId);assert.equal(saved.controlState,p1Case('human-exit').controlState);assert.equal(saved.controller.started,true);
  assert.equal(await inspectWorkflowLock({path:join(prepared.runDir,'controller.lock')}),'free');
});

test('P1 frozen-resume, stale-rev and duplicate binding retain the original selection and request',async t=>{
  const f=await p1Fixture(t);const prepared=await f.prepare();await f.drive();const waiting=f.saved(prepared.runId),rev=waiting.rev,id=randomUUID(),before=f.native.length;
  const stale=await f.drive({decision:'approve',decisionId:id,expectedRev:rev-1});assert.equal(stale.code,p1Case('stale-rev').code);assert.equal(f.native.length,before);
  f.ports.loadGuidance=async()=>{throw Error('mutable guidance is unavailable');};
  f.ports.resolveWorkflowModel=async ({agent,machineId,selection})=>({state:'selected',selection:{...waiting.launchSelection,agent,machineId,...selection,source:'override'}});
  const progressed=await f.drive({decision:'approve',decisionId:id,expectedRev:rev});assert.equal(progressed.state,'waiting',progressed.message);assert.equal(progressed.stage,'wait-merge');assert.equal(f.native.at(-1).context,waiting.context);
  const sends=f.native.length,pushes=f.calls.filter(c=>c.file==='git'&&c.args[0]==='push').length;
  assert.equal((await f.drive({decision:'approve',decisionId:id,expectedRev:rev})).state,'waiting');assert.equal(f.native.length,sends);assert.equal(f.calls.filter(c=>c.file==='git'&&c.args[0]==='push').length,pushes);
  assert.equal((await f.drive({decision:'skip',decisionId:id,expectedRev:rev})).code,'bad_args');
});

test('P1 changed-accepted-file and changed frozen bytes start no native process',async t=>{
  const f=await p1Fixture(t),prepared=await f.prepare();await f.drive();const s=f.saved(prepared.runId),n=f.native.length;
  writeFileSync(join(f.cwd,'cases.json'),'[{"expected":9}]\n');assert.equal((await f.drive({decision:'approve',decisionId:randomUUID(),expectedRev:s.rev})).state,'failed');assert.equal(f.native.length,n);
  writeFileSync(join(prepared.runDir,'frozen/inputs.json'),'changed frozen inputs');assert.equal((await f.drive()).state,'failed');assert.equal(f.native.length,n);
});

test('P1 preallocated target id reconciles only the complete immutable original request',async t=>{
  const f=await p1Fixture(t),runId=randomUUID();f.ports.startRequestBinding={targetMachineId:'target',startId:runId,kind:'workflow',agent:'claude',repository:{url:'ssh://git@github.com/example/project.git',ref:f.initial},workflow:{name:'small-change',issue:'17'}};
  const options={runId,machineId:'target'},prepared=await f.prepare(options);assert.equal(prepared.state,'prepared',prepared.message);assert.equal(prepared.runId,runId);assert.equal(f.native.length,0);
  assert.deepEqual(await f.prepare(options),prepared);
  f.ports.startRequestBinding={...f.ports.startRequestBinding,repository:{...f.ports.startRequestBinding.repository,ref:'f'.repeat(40)}};
  assert.equal((await f.prepare(options)).state,'recovery_required');assert.equal(f.native.length,0);
});

test('P1 explicit adoption archives the exact prior journal without approval or launch; missing runtime stays unadopted',async t=>{
  const f=await p1Fixture(t),first=await f.run();f.activeId=first.runId;const path=join(f.gitDir,'pdd/workflows',first.runId,'journal.jsonl'),original=readFileSync(path),n=f.native.length;
  const adopted=await adoptWorkflow({runId:first.runId,cwd:f.sourceCwd,packageRoot},f.ports);assert.equal(adopted.state,'waiting',adopted.message);const s=f.saved(first.runId);assert.deepEqual(readFileSync(join(s.adopted.archive,'journal.jsonl')),original);assert.equal(f.native.length,n);assert.equal(s.accepted,undefined);assert.equal(s.controller,undefined);
  assert.equal((await adoptWorkflow({runId:first.runId,cwd:f.sourceCwd,packageRoot},f.ports)).state,'waiting');
  const other=await p1Fixture(t),legacy=await other.run();delete other.ports.runtime;other.activeId=legacy.runId;other.rewrite(s=>{delete s.runtime;});
  assert.equal((await adoptWorkflow({runId:legacy.runId,cwd:other.sourceCwd,packageRoot},other.ports)).state,p1Case('adopt-incomplete').state);assert.equal(other.saved(legacy.runId).adopted,undefined);
});

test('P1 unknown control state and activation drain refuse without journal or agent effects',async t=>{
  const f=await p1Fixture(t),prepared=await f.prepare(),path=join(prepared.runDir,'journal.jsonl');f.rewrite(s=>{s.controlState='future_state';s.future={keep:true};});const bytes=readFileSync(path);
  assert.equal((await f.drive()).state,'recovery_required');assert.deepEqual(readFileSync(path),bytes);assert.equal(f.native.length,0);
  f.ports.withWorkflowAdmission=async()=>{throw Error('draining');};assert.equal((await f.drive()).state,'waiting');assert.equal(f.native.length,0);
});

test('P1 unsupported frozen model blocks without substituting the new defaults',async t=>{
  const f=await p1Fixture(t);await f.prepare();f.ports.resolveWorkflowModel=async()=>({state:'refused'});const r=await f.drive();assert.equal(r.state,'waiting',r.message);assert.match(r.message,/unsupported/);assert.equal(f.native.length,0);
});

test('P1 advisory publication finding is redacted and does not bypass real checks or block authorized publication',async t=>{
  const f=await fixture(t);f.ports.scanWorkflowPublication=async()=>({verified:true,findings:[{secret:'never-print-this-synthetic-value'}]});const first=await f.run();assert.equal((await f.resume(first.runId,'approve')).stage,'wait-merge');assert.match(f.pr.body,/redacted/);assert.ok(!f.pr.body.includes('never-print'));assert.equal(f.saved(first.runId).publicationAdvisory.needsYou,true);assert.equal(f.saved(first.runId).completed.find(s=>s.id==='verify').handoff.checks[0].exitCode,0);
});

async function p1Active(t) {
  const f=await p1Fixture(t);f.requests=[];
  f.ports.runHerdrStage=async input=>{f.requests.push(input);const backend={version:2,runId:input.runId,stageId:input.stageId,attemptId:input.attemptId,agent:input.agent,cwd:input.cwd,session:'default',workspaceId:'workspace',tabId:'run-tab',paneId:'stage',terminalId:'terminal',backendGen:1,launchSelection:input.launchSelection,nativeSession:{kind:'id',value:randomUUID()},phase:'submitted',promptDigest:sha(`${input.context}\n\n# Current workflow stage\n${input.instructions}`),evidence:{readySeq:1,workingSeq:2}};await input.checkpoint(backend);return {state:'active',backend,evidence:backend.evidence};};
  f.ports.inspectHerdrStage=async ({backend})=>({state:'active',backend,evidence:backend.evidence});await f.prepare();return f;
}

test('P1 live original stage and idle stall alarm preserve generation and never resend or kill',async t=>{
  const f=await p1Active(t);let now=0;f.ports.now=()=>now;f.ports.observeWorkflowActivity=async()=>({observable:true,idle:true,rolloutBytes:42,sleeping:false,dialog:false});await f.drive();const first=f.saved(f.activeId),attempt=first.pending.attemptId;
  now=30*60000;f.rewrite(s=>{s.stall.lastAt=now-60000;});const alarm=await f.drive();assert.equal(alarm.state,'waiting');assert.match(alarm.message,/30 minutes/);assert.equal(f.saved(f.activeId).stall.alarmed,true);assert.equal(f.requests.length,1);assert.equal(f.closes,0);assert.equal(f.saved(f.activeId).pending.attemptId,attempt);assert.equal(f.saved(f.activeId).pending.backend.backendGen,1);
  const path=join(f.gitDir,'pdd/workflows',f.activeId,'journal.jsonl');assert.equal(readFileSync(path,'utf8').split('\n').filter(l=>l&&JSON.parse(l).event==='stall.alarm').length,1);now+=1000;await f.drive();assert.equal(readFileSync(path,'utf8').split('\n').filter(l=>l&&JSON.parse(l).event==='stall.alarm').length,1);
  f.ports.observeWorkflowActivity=async()=>({observable:true,idle:true,rolloutBytes:43});await f.drive();assert.equal(f.saved(f.activeId).stall.alarmed,false);
});

test('P1 sleep, dialogs and guarded intervals never contribute to stall time',async t=>{
  const f=await p1Active(t);let now=0,sample={observable:true,idle:true,rolloutBytes:1};f.ports.now=()=>now;f.ports.observeWorkflowActivity=async()=>sample;await f.drive();
  for(const changed of [{sleeping:true},{dialog:true},{observable:false}]){now+=60*60000;sample={observable:true,idle:true,rolloutBytes:1,...changed};await f.drive();assert.equal(f.saved(f.activeId).stall,null);assert.equal(f.closes,0);}
  assert.equal(f.requests.length,1);
});

test('P1 proved stopped native resumes saved history once and fences an uncertain continuation across retries',async t=>{
  const f=await p1Active(t);await f.drive();const original=f.saved(f.activeId).pending.backend;let resumes=0,sends=0;
  f.ports.proveWorkflowRecovery=async()=>({stopped:{complete:true,pid:123,startIdentity:'old'},promptInHistory:true,turnKey:'recovered-turn'});f.ports.reconcileWorkflowEffects=async()=>true;
  f.ports.resumeHerdrStage=async ({backend,resumeIntent,checkpoint})=>{resumes++;assert.equal(resumeIntent.newGeneration,2);const s=f.saved(f.activeId);assert.equal(s.pending.resumeIntent.nativeSession.value,original.nativeSession.value);const next={...backend,backendGen:2,phase:'history_resumed',evidence:{readySeq:4}};await checkpoint(next);return {state:'active',backend:next};};
  f.ports.sendWorkflowRecoveryContinuation=async ({key})=>{sends++;assert.deepEqual(f.saved(f.activeId).pending.recoveryContinuation.key,key);};f.ports.inspectWorkflowRecoveryContinuation=async()=> 'absent';
  assert.equal((await f.drive()).state,'waiting');assert.equal(f.saved(f.activeId).backendGen,2);assert.equal(f.saved(f.activeId).pending.backend.nativeSession.value,original.nativeSession.value);await f.drive();assert.equal(resumes,1);assert.equal(sends,1);assert.equal(f.requests.length,1);
});

test('P1 unproved native history and lost dialog preserve all work and send no saved key',async t=>{
  const f=await p1Active(t);await f.drive();let effects=0;f.ports.resumeHerdrStage=async()=>{effects++;};f.ports.reconcileWorkflowEffects=async()=>true;f.ports.proveWorkflowRecovery=async()=>({stopped:{complete:true},promptInHistory:false,turnKey:'t'});
  assert.equal((await f.drive()).state,'waiting');assert.equal(effects,0);f.ports.proveWorkflowRecovery=async()=>({questionLost:true});await f.drive();assert.equal(f.saved(f.activeId).controlState,p1Case('lost-dialog').controlState);assert.equal(effects,0);assert.equal(f.requests.length,1);
});

test('P1 quota answers admit only the current quota question and send nothing at admission',async t=>{
  const f=await p1Active(t),events=[];f.ports.readMachineToolPolicy=async()=>({machineId:null,tool:'claude',revision:4,mode:'auto',targetAccountId:'shared-target'});f.ports.quotaPorts={};
  f.ports.advanceQuota=async (event,state,ports)=>{events.push(event);const next={runId:event.runId,machineId:event.machineId,attempt:event.attempt,turnKey:event.turnKey,tool:event.tool,state:'waiting_person',questionId:'current-question',rev:await ports.waitRevision(),kind:'cross_tool'};await ports.append(next);return {state:next,action:{kind:'waiting_person'}};};
  f.ports.inspectHerdrStage=async ({backend})=>({state:'blocked',backend,evidence:backend.evidence,quota:{type:'limit',turnKey:'quota-turn'}});
  await f.drive();await f.drive();const saved=f.saved(f.activeId),count=events.length;assert.equal(saved.waitingPerson.origin,'quota');assert.equal(saved.rev,saved.waitingPerson.rev);
  const id=randomUUID();assert.equal((await f.drive({decision:'continue',questionId:'old-question',decisionId:id,expectedRev:saved.rev})).code,'bad_args');assert.equal(events.length,count);
  const admitted=await f.drive({decision:'continue',questionId:'current-question',decisionId:id,expectedRev:saved.rev});assert.equal(admitted.state,'waiting');assert.equal(events.length,count,'admission does not call account continuation');assert.equal(f.saved(f.activeId).quotaAdmission.decision,'continue');assert.equal(f.requests.length,1);
  assert.ok(events[0].handoffInput.context.includes('# Prompting guide'));assert.equal(events[0].mode,'auto');assert.equal(events[0].handoffInput.instructions,f.saved(f.activeId).pending.instructions);
});

test('P1 missing account ports preserve a quota-limited native stage without reset or replacement',async t=>{
  const f=await p1Active(t);await f.drive();f.ports.inspectHerdrStage=async ({backend})=>({state:'blocked',backend,evidence:backend.evidence,quota:{type:'limit',turnKey:'t'}});const r=await f.drive();assert.equal(r.state,'waiting');assert.match(r.message,/account recovery is unavailable/);assert.equal(f.requests.length,1);assert.equal(f.closes,0);
});

test('P1 derived status/index writer failures preserve the same resume decisions and publication evidence',async t=>{
  const f=await fixture(t);f.ports.writeRunStatus=async()=>{throw Error('display failed');};f.ports.appendRunIndex=async()=>{throw Error('index failed');};const first=await f.run();const next=await f.resume(first.runId,'approve');assert.equal(next.stage,'wait-merge',next.message);assert.deepEqual(f.native.map(x=>x.input.protocol),['proposal','report','work','verify']);assert.equal(f.saved(first.runId).completed.find(x=>x.id==='verify').handoff.checks[0].exitCode,0);
});

test('P1 public resume is prepare/reconcile-only until pane controller ownership, including a bound decision',async t=>{
  const f=await p1Fixture(t),prepared=await f.prepare(),path=join(prepared.runDir,'journal.jsonl'),bytes=readFileSync(path);
  const reconciled=await resumeWorkflow({runId:prepared.runId,cwd:f.sourceCwd,packageRoot},f.ports);assert.equal(reconciled.state,'prepared');assert.equal(reconciled.runId,prepared.runId);assert.deepEqual(readFileSync(path),bytes);assert.equal(f.native.length,0);
  await f.drive();const waiting=f.saved(f.activeId),before=readFileSync(path),n=f.native.length;
  assert.equal((await resumeWorkflow({runId:f.activeId,cwd:f.sourceCwd,packageRoot},f.ports)).state,'waiting');
  const id=randomUUID(),ready=await resumeWorkflow({runId:f.activeId,cwd:f.sourceCwd,packageRoot,decision:'approve',decisionId:id,expectedRev:waiting.rev},f.ports);assert.equal(ready.state,p1Case('managed-resume-controller-only').state,ready.message);assert.deepEqual(readFileSync(path),before);assert.equal(f.native.length,n);assert.equal(f.saved(f.activeId).decisions.length,0);
  assert.equal((await f.drive({decision:'approve',decisionId:id,expectedRev:waiting.rev})).stage,'wait-merge');assert.equal(f.saved(f.activeId).decisions.length,1);
});

test('P1 missing runtime refuses preparation before creating any issue assignment or input snapshot',async t=>{
  const f=await p1Fixture(t);delete f.ports.runtime;const result=await f.prepare();assert.equal(result.state,'failed');assert.match(result.message,/runtime/);assert.equal(existsSync(join(f.sourceCwd,'.git/pdd')),false);assert.equal(f.native.length,0);
});

// Optional exact public owner composition for the same offline attachment cases.
const attachmentClaims=process.env.PDD_TEST_CLAIMS_MODULE?await import(process.env.PDD_TEST_CLAIMS_MODULE):null;
async function publicAttachment(t,{known=true}={}) {
  const f=await fixture(t),h={f,known,mode:null,attachments:0,claims:0,promotions:0,starts:0,agentReads:0,handles:[],adapterPorts:null};
  const native={kind:'id',value:randomUUID(),agent:'codex'};h.native=native;
  if(attachmentClaims){f.ports.withWorkflowLock=attachmentClaims.withWorkflowLock;f.ports.inspectWorkflowLock=attachmentClaims.inspectWorkflowLock;f.ports.flockHelper=process.env.PDD_TEST_FLOCK_HELPER;}
  f.ports.runHerdrStage=async(input,p)=>{
    h.starts++;
    const backend={version:2,runId:input.runId,stageId:input.stageId,attemptId:input.attemptId,agent:input.agent,cwd:input.cwd,phase:'submitted',
      promptDigest:sha(input.context+'\n\n# Current workflow stage\n'+input.instructions),nativeSession:known?native:null,session:'default',workspaceId:'w',tabId:'tab',paneId:'stage',terminalId:'terminal',agentName:'stage-agent',backendGen:1,launchSelection:input.launchSelection,lastSeq:2,evidence:{readySeq:1,workingSeq:2},
      processProof:{pid:123,startIdentity:'stage-start',paneId:'stage',terminalId:'terminal',backendGen:1}};
    await p.checkpoint(backend);return {state:'active',backend,evidence:backend.evidence};
  };
  const originalExec=f.ports.execFile;
  f.ports.execFile=async(file,args,options)=>{
    if(file!==f.herdrExecutable)return originalExec(file,args,options);
    assert.equal(args[1],'default');assert.equal(options.cwd,f.cwd);const b=f.saved(h.runId).pending.backend;
    if(args[2]==='agent'&&args[3]==='get'){
      h.agentReads++;if(h.mode==='checkpoint-fails')linkSync(h.journal,h.journal+'.linked');
      return {stdout:JSON.stringify({result:{agent:{workspace_id:b.workspaceId,tab_id:b.tabId,pane_id:b.paneId,terminal_id:b.terminalId,name:b.agentName,agent:b.agent,cwd:b.cwd,state_change_seq:2,agent_status:'working',agent_session:native}}})};
    }
    assert.deepEqual(args.slice(2),['pane','process-info','--pane','stage']);
    return {stdout:JSON.stringify({result:{process_info:{pane_id:'stage',foreground_processes:[{pid:123,name:'codex',cwd:b.cwd,argv:['codex']}]}}})};
  };
  f.ports.processStartIdentity=async({pid,paneId})=>{assert.equal(pid,123);assert.equal(paneId,'stage');return h.mode==='wrong-process'?'replacement':'stage-start';};
  // These caller writers/authority must be replaced by the actual runner owner.
  f.ports.validateOwner=async()=>assert.fail('unbound caller authority');f.ports.bindClaim=async()=>assert.fail('unbound caller binding');f.ports.checkpoint=async()=>assert.fail('unbound caller checkpoint');
  f.ports.claimWorkflowSession=async(spec,p)=>{
    h.claims++;assert.equal((await p.validateOwner(spec)).state,'current');
    if(h.mode==='wrong-generation')spec={...spec,owner:{...spec.owner,backendGen:spec.owner.backendGen+1}};
    if(h.mode==='wrong-attempt')spec={...spec,owner:{...spec.owner,attemptId:randomUUID()}};
    if(h.mode?.startsWith('claim-'))return h.mode==='claim-unacknowledged'?{}:{state:h.mode.slice(6)};
    const handle=attachmentClaims?await attachmentClaims.claimWorkflowSession(spec,p):(await p.validateOwner(spec)).state==='current'?{state:'owned',kind:spec.kind,owner:spec.owner,nativeSessionId:null,release:async()=>{}}:{state:'retired'};
    h.handles.push(handle);return handle;
  };
  f.ports.promoteWorkflowClaim=async(spec,p)=>{
    h.promotions++;assert.equal(f.saved(h.runId).pending.backend.nativeSession.value,spec.nativeSessionId,'discovery durable before promotion');
    if(h.mode?.startsWith('promote-'))return {state:h.mode.slice(8)};
    if(attachmentClaims)return attachmentClaims.promoteWorkflowClaim(spec,p);
    if(spec.claim.nativeSessionId===spec.nativeSessionId)return spec.claim;
    assert.deepEqual(await p.bindClaim({owner:spec.claim.owner,kind:spec.kind,nativeSessionId:spec.nativeSessionId}),{ok:true});spec.claim.nativeSessionId=spec.nativeSessionId;return spec.claim;
  };
  f.ports.spawnAttach=async(session,name,cwd)=>{
    assert.equal(session,'default');assert.equal(name,'stage-agent');assert.equal(cwd,f.cwd);h.attachments++;
    assert.equal(f.saved(h.runId).pending.backend.nativeSession.value,native.value);
    assert.ok(readFileSync(h.journal,'utf8').split('\n').some(line=>line&&JSON.parse(line).event==='native.claim.bound'));
    await h.onAttach?.();return 0;
  };
  f.ports.attachHerdrStage=async(input,p)=>{h.adapterPorts=p;return attachHerdrStage(input,p);};
  const started=await f.run('small-change','codex');assert.equal(started.state,'waiting',started.message);h.runId=started.runId;
  h.directory=join(f.gitDir,'pdd/workflows',h.runId);h.journal=join(h.directory,'journal.jsonl');
  h.attach=()=>attachWorkflow({runId:h.runId,cwd:f.sourceCwd,packageRoot},f.ports);
  h.holdController=async action=>{
    let enter,release;const entered=new Promise(r=>{enter=r;}),done=new Promise(r=>{release=r;});
    const holding=f.ports.withWorkflowLock({path:join(h.directory,'controller.lock')},async()=>{enter();await done;},f.ports);
    await entered;try{return await action();}finally{release();await holding;}
  };
  t.after(async()=>{for(const handle of h.handles)await handle.release?.();});return h;
}
for(const known of [true,false])test(`public attachment actual stage forwards durable owner/transport ports (${known?'saved':'new'} native ID)`,async t=>{
  const h=await publicAttachment(t,{known}),before=h.f.saved(h.runId),result=await h.attach();
  assert.equal(result.state,'waiting',result.message);assert.equal(h.attachments,1);assert.equal(h.claims,1);assert.equal(h.promotions,1);assert.equal(h.starts,1);
  const after=h.f.saved(h.runId);assert.equal(after.pending.attemptId,before.pending.attemptId);assert.equal(after.pending.backend.backendGen,1);assert.equal(after.pending.backend.phase,'submitted');assert.equal(after.index,before.index);assert.deepEqual(after.completed,before.completed);
  const rows=journalRows(readFileSync(h.journal,'utf8'));assert.equal(new Set(rows.map(row=>row.seq)).size,rows.length);
});
for(const mode of ['claim-busy','claim-uncertain','claim-unacknowledged','promote-busy','promote-uncertain','wrong-generation','wrong-attempt','checkpoint-fails','wrong-process'])test(`public attachment actual stage refuses ${mode} without attachment or replacement`,async t=>{
  const h=await publicAttachment(t,{known:false});h.mode=mode;const result=await h.attach();
  assert.equal(result.state,'recovery_required',result.message);assert.equal(h.attachments,0);assert.equal(h.starts,1);
  if(mode==='checkpoint-fails'){assert.equal(h.claims,0);assert.equal(h.promotions,0);unlinkSync(h.journal+'.linked');}
  if(mode.startsWith('promote-'))assert.equal(h.f.saved(h.runId).pending.backend.nativeSession.value,h.native.value);
});
test('public attachment live controller reuses same owned claim read-only and polling stays guarded',async t=>{
  const h=await publicAttachment(t);assert.equal((await h.attach()).state,'waiting');
  const before=readFileSync(h.journal,'utf8'),claimCalls=h.claims,epoch=()=>readFileSync(join(h.f.saved(h.runId).assignment.commonDir,'pdd/workflow-stage-guards',h.runId,'attachments.jsonl'),'utf8').trim().split('\n').length;
  let enter,release;const entered=new Promise(r=>{enter=r;}),detached=new Promise(r=>{release=r;});h.onAttach=async()=>{enter();await detached;};
  await h.holdController(async()=>{
    const attaching=h.attach();await entered;
    try{
      const reads=h.agentReads,seen=await inspectHerdrStage({backend:h.f.saved(h.runId).pending.backend},h.adapterPorts);
      assert.equal(seen.state,'active');assert.equal(seen.reason,'stage_temporarily_guarded');assert.equal(h.agentReads,reads);
      assert.equal(readFileSync(h.journal,'utf8'),before);assert.equal(epoch(),2);
    }finally{release();}
    assert.equal((await attaching).state,'waiting');
  });
  assert.equal(h.attachments,2);assert.equal(h.claims,claimCalls);assert.equal(readFileSync(h.journal,'utf8'),before);
});
for(const known of [true,false])test(`public attachment live controller refuses ${known?'unbound saved claim':'new identity checkpoint'} without journal mutation`,async t=>{
  const h=await publicAttachment(t,{known}),before=readFileSync(h.journal,'utf8');
  await h.holdController(async()=>{assert.equal((await h.attach()).state,'recovery_required');assert.equal(readFileSync(h.journal,'utf8'),before);});
  assert.equal(h.attachments,0);assert.equal(h.claims,0);assert.equal(h.promotions,0);assert.equal(h.starts,1);
});
test('public attachment rival native claim refuses then same owner reconciles without a replacement',async t=>{
  const h=await publicAttachment(t,{known:false});let rival;
  if(attachmentClaims){
    rival=await attachmentClaims.claimWorkflowSession({kind:'codex',nativeSessionId:h.native.value,owner:{runId:randomUUID(),attemptId:randomUUID(),backendGen:1}},{...h.f.ports,validateOwner:async()=>({state:'current'})});
    assert.equal(rival.state,'owned');t.after(()=>rival.release());
  }else h.mode='promote-busy';
  assert.equal((await h.attach()).state,'recovery_required');assert.equal(h.attachments,0);assert.equal(h.f.saved(h.runId).pending.backend.nativeSession.value,h.native.value);
  await rival?.release();h.mode=null;assert.equal((await h.attach()).state,'waiting');assert.equal(h.claims,1);assert.equal(h.attachments,1);assert.equal(h.starts,1);
});
test('public attachment durable callbacks cannot write after their journal ownership ends',async t=>{
  const h=await publicAttachment(t);assert.equal((await h.attach()).state,'waiting');const before=readFileSync(h.journal,'utf8'),b=h.f.saved(h.runId).pending.backend,p=h.adapterPorts;
  await p.withStageGuard(b,async()=>{
    await assert.rejects(p.checkpoint(b),/controller owns native identity/);
    await assert.rejects(p.bindClaim({kind:b.agent,nativeSessionId:b.nativeSession.value,owner:{runId:b.runId,attemptId:b.attemptId,backendGen:b.backendGen}}),/controller owns native identity/);
  });
  assert.equal(readFileSync(h.journal,'utf8'),before);assert.equal(h.attachments,1);
});

for(const settings of [null,{model:'settings-model',effort:'high'}])test(`rule10 actual runner freezes ${settings?'Settings pair':'native defaults'} before assignment and admits after defaults change`,async t=>{
  const f=await p1Fixture(t);delete f.ports.resolveWorkflowModel;
  f.ports.nativeCatalog={read:async()=>{throw Error('unavailable');}};
  f.ports.toolDefaults={read:async()=>settings};
  const prepared=await f.prepare({machineId:'local'});assert.equal(prepared.state,'prepared',prepared.message);
  const saved=f.saved(prepared.runId).launchSelection;
  assert.equal(saved.model,settings?.model??null);assert.equal(saved.effort,settings?.effort??null);
  assert.equal(saved.source,settings?'settings-fallback':'native-defaults');assert.equal(f.native.length,0);
  f.ports.toolDefaults.read=async()=>({model:'changed-default',effort:'low'});
  const driven=await f.drive();assert.equal(driven.state,'waiting',driven.message);
  assert.ok(f.native.length>0);assert.deepEqual(f.saved(prepared.runId).launchSelection,saved);
});


test('P1 enabled trace observes actual controller process request without replacing journal proof',async t=>{
  const f=await p1Fixture(t);f.ports.env={PDD_TRACE:'herdr'};
  const prepared=await f.prepare();assert.equal(prepared.state,'prepared',prepared.message);
  assert.deepEqual(readHerdrTrace(f.ports),[]);
  const request=f.ports.execFile,observed=[];
  f.ports.execFile=async(file,args,options)=>{if(file===f.herdrExecutable)observed.push({args:[...args],options:{...options}});return request(file,args,options);};
  const result=await f.drive();assert.equal(result.state,'waiting',result.message);
  assert.deepEqual(observed,[{args:['--session','default','pane','process-info','--pane','controller'],options:{cwd:prepared.root,env:f.ports.env}}]);
  const saved=f.saved(prepared.runId);assert.equal(saved.controller.started,true);assert.equal(saved.controller.generation,1);assert.equal(saved.controller.startIdentity,'controller-process-start');
  const encoded=JSON.stringify(readHerdrTrace(f.ports));assert.ok(encoded.includes('pane.process_info'));assert.ok(!encoded.includes(prepared.root));assert.ok(!encoded.includes('controller-process-start'));
});

test('C3 one hour of unchanged backend checkpoints at 4Hz stays below 5 MB and recovers exact work',async t=>{
  const f=await fixture(t);let checkpoints=0,original,dir,stableSeq,now=Date.now();
  // Keep the real guide intact; synthetic padding makes the stress size independent of checkout paths.
  const loadGuidance=f.ports.loadGuidance;
  f.ports.loadGuidance=async input=>{const guidance=await loadGuidance(input);return guidance+'\n# Synthetic C3 size fixture\n'+'x'.repeat(Math.max(0,60_000-Buffer.byteLength(guidance)));};
  f.ports.now=()=>now;
  f.ports.observeWorkflowActivity=async()=>({observable:true,idle:true,rolloutBytes:100});
  f.ports.runHerdrStage=async(input,ports)=>{
    dir=join(f.gitDir,'pdd/workflows',input.runId);
    const backend={version:2,runId:input.runId,stageId:input.stageId,attemptId:input.attemptId,agent:input.agent,cwd:input.cwd,
      session:'default',workspaceId:'w1',tabId:'w1:t1',paneId:'w1:p3',terminalId:'term',agentName:'owned',backendGen:1,
      phase:'submitted',promptDigest:sha(`${input.context}\n\n# Current workflow stage\n${input.instructions}`),evidence:{readySeq:1,workingSeq:2},nativeSession:{kind:'id',agent:input.agent,value:'original-history'}};
    original=structuredClone(backend);await ports.checkpoint(backend);checkpoints++;
    const started=now,path=join(dir,'journal.jsonl');
    for(let tick=0;tick<4*60*60;tick++){
      now=started+tick*250;
      await ports.onStageObservation({backend,status:'working'});
      const before=statSync(path).size;
      await ports.checkpoint(structuredClone(backend));checkpoints++;
      assert.equal(statSync(path).size,before,'identical checkpoints do not append even while stall sampling remains durable');
    }
    now=started+60*60*1000;await ports.onStageObservation({backend,status:'working'});
    stableSeq=f.saved(input.runId).seq;
    await assert.rejects(ports.checkpoint({...backend,paneId:'other-pane'}),/identity changed/);
    assert.equal(f.saved(input.runId).seq,stableSeq,'identity guards still refuse before suppression or append');
    // A genuine evidence change must remain durable before the callback resolves.
    backend.lastSeq=3;backend.evidence.workingSeq=3;await ports.checkpoint(backend);checkpoints++;
    return {state:'active',backend,evidence:backend.evidence};
  };
  const first=await f.run();assert.ok(['waiting','recovery_required'].includes(first.state),first.message);assert.equal(checkpoints,14402);
  const bytes=readFileSync(join(dir,'journal.jsonl')),physical=bytes.toString('utf8').trimEnd().split('\n').map(JSON.parse);
  assert.ok(bytes.length<5_000_000,`${bytes.length} journal bytes`);
  assert.ok(physical.filter(row=>row.event==='agent.backend').length===2,'only changed backend observations are journaled');
  assert.equal(physical.filter(row=>row.event==='stall.alarm').length,1,'one thirty-minute alarm across the full idle hour');
  assert.ok(physical.filter(row=>row.event==='stall.sample').length>=59,'size includes durable periodic activity observations');
  assert.ok(physical.filter(row=>row.delta).length>0,'ordinary events store deltas');
  assert.ok(!physical.filter(row=>row.event==='agent.backend').some(row=>row.state),'backend records do not copy full state');
  const {state,seq}=await readWorkflowJournal({runDir:dir});assert.equal(seq,state.seq);assert.equal(state.pending.backend.nativeSession.value,original.nativeSession.value);
  assert.equal(state.pending.backend.evidence.workingSeq,3);assert.ok(Buffer.byteLength(state.context)>57_000,'full bundled context is represented');
  const displayed=await (await import('../src/workflow-run-records.mjs')).readJournalLast(dir);assert.deepEqual(displayed.value.state,state);
  const before=Buffer.from(bytes),effects=f.native.length;const inspected=await f.resume(first.runId);assert.equal(inspected.runId,first.runId);
  assert.deepEqual(readFileSync(join(dir,'journal.jsonl')),before);assert.equal(f.native.length,effects,'recovery observation cannot resend work');
  t.diagnostic(`3600000 virtual milliseconds, 14400 unchanged polls, ${bytes.length} journal bytes, ${physical.length} committed records, one stall alarm, ${Buffer.byteLength(state.context)} context bytes.`);
});

test('C3 mixed legacy and delta history materializes callbacks and resumes without another delivery',async t=>{
  const f=await fixture(t),first=await f.run(),dir=join(f.gitDir,'pdd/workflows',first.runId),path=join(dir,'journal.jsonl');
  const logical=journalRows(readFileSync(path,'utf8')),rows=[];let previous;
  for(const row of logical){
    const {v,runId,state,...metadata}=row;
    rows.push(previous?encodeWorkflowJournalRecord(previous,state,metadata):{...metadata,state});previous=state;
  }
  assert.ok(rows.some(row=>row.delta));assert.equal(Object.hasOwn(rows[0],'v'),false);
  writeFileSync(path,rows.map(JSON.stringify).join('\n')+'\n');
  const callbacks=[],saved=await readWorkflowJournal({runDir:dir},{onRecord:row=>callbacks.push(row)});
  assert.deepEqual(saved.state,logical.at(-1).state);
  assert.deepEqual(callbacks.map(row=>row.state),logical.map(row=>row.state),'every callback receives the complete state at its sequence');
  const before=readFileSync(path),effects=f.native.length;
  assert.equal((await f.resume(first.runId)).runId,first.runId);
  assert.deepEqual(readFileSync(path),before);assert.equal(f.native.length,effects);
});

test('C3 authoritative recovery rejects damaged history before a valid later periodic snapshot',async t=>{
  const f=await fixture(t),first=await f.run(),dir=join(f.gitDir,'pdd/workflows',first.runId),path=join(dir,'journal.jsonl');
  const original=readFileSync(path,'utf8'),start=(await readWorkflowJournal({runDir:dir})).state;
  let previous=start;const rows=[];
  for(let seq=start.seq+1;seq<=128;seq++){
    const state={...previous,seq,observation:{counter:seq}};
    rows.push(encodeWorkflowJournalRecord(previous,state,{event:'agent.backend'}));previous=state;
  }
  assert.ok(rows.at(-1).state);assert.ok(rows[0].delta);
  rows[0].baseSeq--;
  writeFileSync(path,original+rows.map(JSON.stringify).join('\n')+'\n');
  const displayed=await (await import('../src/workflow-run-records.mjs')).readJournalLast(dir);
  assert.equal(displayed.value.state.seq,128,'display tail is explicitly not full-history authority');
  await assert.rejects(readWorkflowJournal({runDir:dir}),/journal/);
  const before=readFileSync(path),effects=f.native.length,refused=await f.resume(first.runId,'approve');
  assert.ok(['failed','recovery_required'].includes(refused.state));assert.deepEqual(readFileSync(path),before);assert.equal(f.native.length,effects);
});

for(const field of ['assignment','definition','launchSelection','root','inputDigest'])test(`C3 delta changing frozen ${field} refuses before effects despite a later restoring snapshot`,async t=>{
  const f=await fixture(t),first=await f.run(),dir=join(f.gitDir,'pdd/workflows',first.runId),path=join(dir,'journal.jsonl');
  const original=readFileSync(path,'utf8'),saved=(await readWorkflowJournal({runDir:dir})).state;
  const row={v:1,runId:saved.runId,seq:saved.seq+1,baseSeq:saved.seq,event:'agent.backend',delta:[{path:[field],value:field==='root'?saved.root+'-other':field==='inputDigest'?'0'.repeat(64):{changed:true}}]};
  const restoring={v:1,runId:saved.runId,seq:saved.seq+2,event:'agent.backend',state:{...saved,seq:saved.seq+2}};
  writeFileSync(path,original+JSON.stringify(row)+'\n'+JSON.stringify(restoring)+'\n');
  await assert.rejects(readWorkflowJournal({runDir:dir}),/journal/);
  const before=readFileSync(path),effects=f.native.length,refused=await f.resume(first.runId,'approve');
  assert.ok(['failed','recovery_required'].includes(refused.state));assert.deepEqual(readFileSync(path),before);assert.equal(f.native.length,effects);
});

test('C8 composition commits accepted scope artifacts after agent code commit and opens the exact verified PR', async t => {
  const f = await fixture(t, { leaveScopeUncommitted: true });
  const first = await f.run();
  assert.equal(first.state, 'waiting', first.message);
  assert.equal(await f.git('rev-parse', 'HEAD'), f.initial);
  assert.match(await f.git('status', '--porcelain'), /cases.json/);
  const beforeInspection = await f.git('rev-parse', 'HEAD');
  await f.resume(first.runId);
  assert.equal(await f.git('rev-parse', 'HEAD'), beforeInspection, 'inspection never commits');
  const opened = await f.resume(first.runId, 'approve');
  assert.equal(opened.stage, 'wait-merge', opened.message);
  assert.equal(opened.state, 'waiting', opened.message);
  assert.equal(await f.git('status', '--porcelain'), '');
  const saved = f.saved(first.runId), checked = saved.completed.find(step => step.id === 'verify');
  const transition = saved.artifactCommits.at(-1);
  assert.deepEqual(transition.previous, checked.verification.output, 'original tested fingerprint is retained');
  assert.deepEqual(transition.current, saved.expected);
  assert.notEqual(transition.previous.head, transition.current.head);
  assert.deepEqual((await f.git('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD')).split('\n').sort(),
    ['STORY.md', 'cases.json', 'module.prompt.md']);
  assert.equal(await f.git('show', 'HEAD:value.mjs'), 'export const value = 2;');
  assert.equal(f.pr.headRefOid, saved.expected.head);
  for (const file of saved.accepted.files)
    assert.equal(sha((await exec('git', ['show', `HEAD:${file.path}`], {cwd:f.cwd})).stdout), file.sha256);
  assert.equal(f.calls.filter(c => c.file === 'git' && c.args[0] === 'push').length, 1);
  assert.equal(f.calls.filter(c => c.file === 'gh' && c.args[1] === 'create').length, 1);
  const history = readFileSync(join(f.gitDir, 'pdd/workflows', first.runId, 'journal.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert(history.findIndex(row => row.event === 'publication.artifacts.intent') < history.findIndex(row => row.event === 'publication.artifacts.committed'));
  assert(history.findIndex(row => row.event === 'publication.artifacts.committed') < history.findIndex(row => row.event === 'pr.intent'));
  const head = saved.expected.head;
  await f.resume(first.runId);
  assert.equal(await f.git('rev-parse', 'HEAD'), head, 'read-only PR recovery never repeats checkpoint');
});

test('C8 unrelated dirty files are listed without committing scope or publishing', async t => {
  const f = await fixture(t, { leaveScopeUncommitted: true, unrelatedPublicationFile: true });
  const first = await f.run(), stopped = await f.resume(first.runId, 'approve');
  assert.match(stopped.message, /unrelated draft.txt/);
  assert.match(stopped.message, /commit or move/i);
  assert.equal(f.pr, null);
  assert.equal(await f.git('log', '-1', '--format=%s'), 'change');
  assert.equal(readFileSync(join(f.cwd, 'unrelated draft.txt'), 'utf8'), 'preserve this unrelated work\n');
  assert.equal(await f.git('diff', '--cached', '--name-only'), '');
});

test('C8 lost local commit reply preserves saved-input drift refusal and never repeats the commit', async t => {
  const f = await fixture(t, { leaveScopeUncommitted: true });
  const first = await f.run(), original = f.ports.execFile;
  let commits = 0;
  f.ports.execFile = async (file, args, options) => {
    const answer = await original(file, args, options);
    if (file === 'git' && args.includes('commit')) {
      commits++; throw Error('synthetic lost local commit response');
    }
    return answer;
  };
  const stopped = await f.resume(first.runId, 'approve');
  assert.notEqual(stopped.state, 'completed');
  assert.equal(commits, 1);
  assert.equal(f.pr, null);
  const head = await f.git('rev-parse', 'HEAD');
  const inspected = await f.resume(first.runId);
  assert.match(inspected.message, /HEAD or worktree changed/);
  const retry = await f.resume(first.runId, 'approve');
  assert.match(retry.message, /HEAD or worktree changed/);
  assert.equal(await f.git('rev-parse', 'HEAD'), head);
  assert.equal(commits, 1); assert.equal(f.pr, null);
});

test('C3 public journal callbacks compose with codec replay as complete snapshot records', async t => {
  const f = await fixture(t), first = await f.run();
  assert.equal(first.state, 'waiting', first.message);
  const runDir = join(f.gitDir, 'pdd/workflows', first.runId), path = join(runDir, 'journal.jsonl');
  const before = readFileSync(path), physical = before.toString('utf8').trimEnd().split('\n').map(JSON.parse);
  assert.ok(physical.some(row => Object.hasOwn(row, 'delta')), 'exercise actual compact storage');
  const callbacks = [];
  let replayed;
  const journal = await readWorkflowJournal({runDir}, {onRecord: row => {
    replayed = replayWorkflowJournalRecord(replayed, row);
    assert.equal(Object.hasOwn(row, 'delta'), false);
    assert.equal(Object.hasOwn(row, 'baseSeq'), false);
    callbacks.push(row);
  }});
  assert.deepEqual(replayed, journal.state);
  assert.deepEqual(callbacks.map(({seq, event, decisionId, v, runId}) => ({seq, event, decisionId, v, runId})),
    physical.map(({seq, event, decisionId, v, runId}) => ({seq, event, decisionId, v, runId})), 'record metadata survives projection');
  assert.equal(journal.seq, physical.at(-1).seq);
  const deliveries = f.native.length;
  assert.equal((await f.resume(first.runId)).state, 'waiting');
  assert.deepEqual(readFileSync(path), before, 'inspection preserves the authoritative compact journal');
  assert.equal(f.native.length, deliveries, 'callback replay and inspection cannot redeliver work');
});

test('C3 journal observers cannot mutate authoritative replay or later observations', async t => {
  const f = await fixture(t), first = await f.run();
  assert.equal(first.state, 'waiting', first.message);
  const progressed = await f.resume(first.runId, 'approve', decisionBinding(f, first.runId));
  assert.equal(progressed.state, 'waiting', progressed.message);
  const runDir = join(f.gitDir, 'pdd/workflows', first.runId), path = join(runDir, 'journal.jsonl');
  const before = readFileSync(path), expectedRows = [], deliveries = f.native.length;
  assert.ok(before.toString('utf8').split('\n').filter(Boolean).map(JSON.parse)
    .some(row => Object.hasOwn(row, 'delta')), 'exercise compact history');
  const expected = await readWorkflowJournal({runDir}, {onRecord: row => expectedRows.push(row)});
  assert.ok(expected.decisions.length > 0, 'include real saved decision bindings');
  let count = 0;
  const observed = await readWorkflowJournal({runDir}, {onRecord: row => {
    assert.deepEqual(row, expectedRows[count++], 'earlier observers cannot change this snapshot');
    row.state.seq = 0;
    row.state.assignment.runId = 'observer-only';
    row.state.definition.name = 'observer-only';
    row.state.completed.length = 0;
    for (const decision of row.state.decisions ?? []) decision.decisionId = 'observer-only';
    row.event = 'observer-only';
  }});
  assert.equal(count, expectedRows.length);
  assert.deepEqual(observed, expected, 'returned state, sequence and decisions remain authoritative');
  assert.deepEqual(await readWorkflowJournal({runDir}), expected, 'future reads retain the same state');
  assert.deepEqual(readFileSync(path), before, 'observation never changes durable history');
  await f.resume(first.runId);
  assert.deepEqual(readFileSync(path), before, 'read-only recovery preserves history');
  assert.equal(f.native.length, deliveries, 'observation and recovery never redeliver work');
});


test('C12 composition publishes the issue and accepted change/check results after the internal artifact checkpoint', async t => {
  const f = await fixture(t, { leaveScopeUncommitted: true });
  const first = await f.run(), opened = await f.resume(first.runId, 'approve');
  assert.equal(opened.stage, 'wait-merge', opened.message);
  assert.match(await f.git('log', '-1', '--format=%s'), /^pdd: record accepted artifacts for /);
  assert.equal(f.pr.title, 'Use value two');
  assert.match(f.pr.body, /^Closes #17\n/m);
  assert.match(f.pr.body, /Completed current change; observable expectations remain independent\./);
  assert.doesNotMatch(f.pr.body, /pdd: record accepted artifacts|Completed current verify/);
  const saved = f.saved(first.runId), checked = saved.completed.find(step => step.id === 'verify');
  for (const check of checked.handoff.checks) {
    assert.equal(check.exitCode, 0);
    assert.ok(f.pr.body.includes('PASS (exit 0): ' + JSON.stringify(check.argv)));
  }
  const marker = '<!-- pdd-workflow:' + first.runId + ':open-pr -->';
  assert.equal(f.pr.body.split(marker).length - 1, 1);
  assert.equal(f.pr.headRefOid, saved.expected.head);
  const before = {head: saved.expected.head, body:f.pr.body, title:f.pr.title};
  await f.resume(first.runId);
  assert.equal(await f.git('rev-parse', 'HEAD'), before.head);
  assert.equal(f.pr.body, before.body); assert.equal(f.pr.title, before.title);
  assert.equal(f.calls.filter(c => c.file === 'git' && c.args[0] === 'push').length, 1);
  assert.equal(f.calls.filter(c => c.file === 'gh' && c.args[1] === 'create').length, 1);
});

test('C12 proposal PR describes accepted scope without claiming unexecuted verification', async t => {
  const f = await fixture(t); let state = await f.run('feature');
  state = await f.resume(state.runId, 'skip'); state = await f.resume(state.runId, 'skip');
  state = await f.resume(state.runId, 'approve'); state = await f.resume(state.runId, 'approve');
  assert.equal(state.stage, 'prompt-merge', state.message);
  assert.equal(f.pr.title, 'Use value two');
  assert.match(f.pr.body, /^Closes #17\n/m);
  assert.match(f.pr.body, /Completed current prompt-story/);
  assert.match(f.pr.body, /Not run for this publication\./);
  assert.doesNotMatch(f.pr.body, /PASS/);
});


test('C13 settled missing handoff waits with a plain message and read-only resume never redelivers',async t=>{
  const f=await fixture(t,{missingHandoff:true});
  f.ports.readSettledHerdrStageError=async()=>({code:'unknown'});
  const first=await f.run();assert.equal(first.state,'waiting',first.message);assert.match(first.message,/ended without a handoff/);assert.doesNotMatch(first.message,/ENOENT/);
  const before=f.saved(first.runId);const again=await f.resume(first.runId);
  assert.equal(again.state,'waiting');assert.equal(f.native.length,1);assert.equal(f.closes,0);assert.equal(f.saved(first.runId).pending.attemptId,before.pending.attemptId);
});
test('C13 busy retry waits until due and fences an uncertain continuation across resume',async t=>{
  const f=await fixture(t,{missingHandoff:true});let clock=1000,retries=0;
  f.ports.now=()=>clock;f.ports.readSettledHerdrStageError=async()=>({code:'busy_429'});
  f.ports.retrySettledHerdrStage=async({backend,settledSeq})=>{retries++;assert.equal(settledSeq,3);assert.equal(f.saved(backend.runId).pending.handoffWait.sent,true);throw Error('lost reply');};
  const first=await f.run('small-change','codex');assert.equal(first.state,'waiting');assert.match(first.message,/Codex is busy \(429\); PDD retries/);
  const original=f.saved(first.runId).pending;await f.resume(first.runId,'approve');assert.equal(retries,0);
  clock=61000;const retry=await f.resume(first.runId,'approve');assert.equal(retry.state,'waiting');assert.equal(retries,1);
  await f.resume(first.runId,'approve');assert.equal(retries,1);assert.equal(f.native.length,1);
  const saved=f.saved(first.runId);assert.deepEqual(saved.pending.input,original.input);assert.equal(saved.pending.instructions,original.instructions);assert.equal(saved.pending.attemptId,original.attemptId);
});
test('C13 a late valid handoff is accepted without a retry and missing artifact remains invalid',async t=>{
  const f=await fixture(t,{missingHandoff:true});f.ports.readSettledHerdrStageError=async()=>({code:'busy_429'});let retries=0;f.ports.retrySettledHerdrStage=async()=>{retries++;throw Error();};
  const first=await f.run();f.options.missingHandoff=false;
  await f.ports.launchNativeSession(f.native[0]);
  const accepted=await f.resume(first.runId,'approve');assert.equal(accepted.state,'waiting',accepted.message);assert.equal(retries,0);assert.ok(f.saved(first.runId).completed.some(x=>x.id==='scope'));
  const g=await fixture(t,{missingHandoff:true});g.ports.readSettledHerdrStageError=async()=>({code:'unknown'});const pending=await g.run();g.options.missingHandoff=false;await g.ports.launchNativeSession(g.native[0]);
  unlinkSync(join(g.cwd,'cases.json'));const invalid=await g.resume(pending.runId,'approve');assert.equal(invalid.state,'failed');assert.equal(g.saved(pending.runId).index,0);
});
test('C13 changed partial work fences continuation and preserves the original files',async t=>{
  const f=await fixture(t,{missingHandoff:true});f.ports.readSettledHerdrStageError=async()=>({code:'unknown'});let retries=0;f.ports.retrySettledHerdrStage=async()=>{retries++;throw Error();};
  const first=await f.run();writeFileSync(join(f.cwd,'partial.txt'),'preserve');const next=await f.resume(first.runId,'approve');
  assert.equal(next.state,'recovery_required',next.message);assert.equal(retries,0);assert.equal(readFileSync(join(f.cwd,'partial.txt'),'utf8'),'preserve');
});


for(const diagnosis of ['busy_429','unknown','lost_reply'])test(`C13 live drive keeps its controller lock through ${diagnosis} retry and observes the same continuation`,async t=>{
  const f=await p1Fixture(t,{missingHandoff:true});let clock=0,retries=0,sleeps=0,continued=false,workingObserved=false;
  f.ports.now=()=>clock;f.ports.readSettledHerdrStageError=async()=>({code:diagnosis==='lost_reply'?'busy_429':diagnosis});
  f.ports.sleep=async ms=>{clock+=ms;sleeps++;assert.ok(sleeps<65);assert.equal(await inspectWorkflowLock({path:join(f.gitDir,'pdd/workflows',f.activeId,'controller.lock')}),'held');};
  const inspect=f.ports.inspectHerdrStage;
  f.ports.retrySettledHerdrStage=async({backend},ports)=>{
    retries++;assert.equal(clock,60000);const b={...backend,phase:diagnosis==='lost_reply'?'prompt_intent':'submitted',handoffRetry:{settledSeq:3},evidence:diagnosis==='lost_reply'?{readySeq:3}:{readySeq:3,workingSeq:4}};await ports.checkpoint(b);continued=true;
    return {state:diagnosis==='lost_reply'?'recovery_required':'active',backend:b,evidence:b.evidence};
  };
  f.ports.inspectHerdrStage=async(input,ports)=>{
    if(!continued)return inspect(input,ports);
    if(diagnosis==='lost_reply'&&!workingObserved){workingObserved=true;const b={...input.backend,evidence:{readySeq:3,workingSeq:4}};return {state:'active',backend:b,evidence:b.evidence};}
    if(diagnosis==='lost_reply')assert.equal(input.backend.evidence.workingSeq,4,'working observation survived to the next poll');
    f.options.missingHandoff=false;await f.ports.launchNativeSession(f.native[0]);continued=false;
    const b={...input.backend,phase:'candidate',evidence:{readySeq:3,workingSeq:4,settledSeq:5}};await ports.checkpoint(b);
    return {state:'settled',backend:b,evidence:b.evidence};
  };
  const prepared=await f.prepare();const result=await f.drive();assert.equal(result.state,'waiting',result.message);assert.equal(result.stage,'check');assert.equal(retries,1);assert.equal(sleeps,diagnosis==='lost_reply'?62:61);assert.equal(f.saved(prepared.runId).completed[0].id,'scope');assert.equal(await inspectWorkflowLock({path:join(prepared.runDir,'controller.lock')}),'free');
});

import {claimWorkflowSession as realC13Claim} from '../src/workflow-claims.mjs';
test('C13 blocked observation exits scheduled drive without another poll',async t=>{
 const f=await p1Fixture(t,{missingHandoff:true});let clock=0,sleeps=0,diagnosed=false,name,delivered=false,blocked=false;const handles=[];const transportCalls=[];
 t.after(async()=>{for(const h of handles)await h.release?.();});
 f.ports.runHerdrStage=runHerdrStage;f.ports.inspectHerdrStage=inspectHerdrStage;f.ports.closeHerdrStage=closeHerdrStage;
 f.ports.now=()=>clock;f.ports.pollMs=1;f.ports.observeMs=10;f.ports.processStartIdentity=async()=> 'same-start';
 f.ports.claimWorkflowSession=async(...args)=>{const h=await realC13Claim(...args);handles.push(h);return h;};
 f.ports.sleep=async ms=>{clock+=ms;if(diagnosed){sleeps++;blocked=true;if(sleeps>1)throw Error('bounded-probe-stop: scheduler polled after blocked');}};
 const edge=f.ports.execFile;f.ports.execFile=async(file,args,opts)=>{
  if(file!==f.herdrExecutable||(args[2]==='pane'&&args[3]==='process-info'&&args.at(-1)==='controller'))return edge(file,args,opts);
  const a=args.slice(2);transportCalls.push(a.slice(0,3));const encode=x=>({stdout:JSON.stringify(x)});
  const agent=(status=blocked?'blocked':delivered?'done':'idle',seq=blocked?4:delivered?3:1)=>({workspace_id:'workspace',tab_id:'run-tab',pane_id:'stage',terminal_id:'stage-terminal',name,agent:'claude',cwd:f.cwd,agent_status:status,interactive_ready:['done','idle'].includes(status),launch_pending:false,state_change_seq:seq,agent_session:null});
  if(a[0]==='pane'&&a[1]==='split')return encode({result:{pane:{workspace_id:'workspace',tab_id:'run-tab',pane_id:'stage',terminal_id:'stage-terminal'}}});
  if(a[0]==='pane'&&a[1]==='process-info')return encode({result:{process_info:{pane_id:'stage',foreground_processes:[{pid:123,name:'claude',cwd:f.cwd,argv:['claude']}]}}});
  if(a[0]==='agent'&&a[1]==='start'){name=a[2];return encode({result:{agent:agent()}});}
  if(a[0]==='agent'&&a[1]==='get')return encode({result:{agent:agent()}});
  if(a[0]==='agent'&&a[1]==='prompt'){assert.equal(delivered,false,'no continuation before due');delivered=true;return encode({result:{agent:agent('working',2)}});}
  if(a[0]==='pane'&&a[1]==='read'){diagnosed=true;return encode({result:{read:{pane_id:'stage',text:'429 Too Many Requests'}}});}
  assert.fail(JSON.stringify(a));
 };
 const prepared=await f.prepare();assert.equal(prepared.state,'prepared',prepared.message);const result=await f.drive();
 assert.equal(sleeps,1,'stop at the first blocked observation; do not poll again');assert.equal(result.state,'waiting');assert.match(result.message,/person|blocked/);
 assert.equal(await inspectWorkflowLock({path:join(prepared.runDir,'controller.lock')}),'free');
 assert.equal(transportCalls.filter(a=>a[0]==='agent'&&a[1]==='prompt').length,1,'only the original prompt is delivered');
 const pending=f.saved(prepared.runId).pending;assert.equal(pending.kind,'agent');assert.equal(pending.backend.paneId,'stage');assert.equal(pending.handoffWait.code,'busy_429');assert.notEqual(pending.handoffWait.sent,true);
});

test('native zero with missing handoff does not complete its stage or automatically relaunch', async t => {
  const f = await fixture(t, { missingHandoff: true });
  let clock = 1000, retries = 0;
  f.ports.now = () => clock;
  f.ports.readSettledHerdrStageError = async () => ({ code: 'busy_429' });
  f.ports.retrySettledHerdrStage = async () => { retries++; assert.fail('no continuation before the retry deadline'); };
  const first = await f.run('small-change', 'codex');
  assert.equal(first.state, 'waiting', first.message);
  assert.match(first.message, /Codex is busy \(429\); PDD retries/);
  assert.doesNotMatch(first.message, /ENOENT/);
  const before = f.saved(first.runId);
  assert.equal(before.index, 0);
  assert.deepEqual(before.completed, []);
  assert.equal(before.pending.kind, 'agent');
  assert.equal(before.pending.handoffWait.retryAt, 61000);
  const journal = join(f.gitDir, 'pdd/workflows', first.runId, 'journal.jsonl');
  const bytes = readFileSync(journal);
  const inspected = await f.resume(first.runId);
  assert.equal(inspected.state, 'waiting', inspected.message);
  assert.deepEqual(readFileSync(journal), bytes, 'read-only resume leaves durable history unchanged');
  clock = 60999;
  const approved = await f.resume(first.runId, 'approve');
  assert.equal(approved.state, 'waiting', approved.message);
  const after = f.saved(first.runId);
  assert.equal(after.index, 0);
  assert.deepEqual(after.completed, []);
  assert.equal(after.pending.attemptId, before.pending.attemptId);
  assert.deepEqual(after.pending.input, before.pending.input);
  assert.deepEqual(after.pending.backend, before.pending.backend);
  assert.equal(after.pending.instructions, before.pending.instructions);
  assert.notEqual(after.pending.handoffWait.sent, true);
  assert.equal(retries, 0);
  assert.equal(f.native.length, 1);
  assert.equal(f.closes, 0);
});
