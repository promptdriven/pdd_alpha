import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runWorkflow, resumeWorkflow, readWorkflowJournal } from '../src/workflow-runner.mjs';
import { loadGuidance } from '../src/guidance.mjs';
import { withWorkflowLock, inspectWorkflowLock } from './cli/workflow-test-lock.mjs';

const exec = promisify(execFile);
const packageRoot = resolve(import.meta.dirname, '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const issueUrl = 'https://github.com/example/project/issues/17';

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'pdd-frozen-source-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = join(directory, 'source'); mkdirSync(source);
  const git = async (cwd, ...args) => (await exec('git', args, { cwd })).stdout.trim();
  await git(source, 'init', '-b', 'main');
  await git(source, 'config', 'user.name', 'Runner Test');
  await git(source, 'config', 'user.email', 'test@example.invalid');
  await git(source, 'remote', 'add', 'origin', 'https://github.com/example/project.git');
  writeFileSync(join(source, 'source.txt'), 'Preserve the accepted source.\n');
  await git(source, 'add', '.'); await git(source, 'commit', '-m', 'initial');
  const baseSha = await git(source, 'rev-parse', 'HEAD');
  await git(source, 'update-ref', 'refs/remotes/origin/main', baseSha);
  const recipe = join(source, '.pdd/workflows/frozen-source'); mkdirSync(recipe, { recursive: true });
  writeFileSync(join(recipe, 'workflow.json'), JSON.stringify({ version: 1, name: 'frozen-source', overview: 'WORKFLOW.md', stages: [
    { id: 'first', kind: 'agent', protocol: 'report', optional: true, file: 'first.md' },
    { id: 'second', kind: 'agent', protocol: 'report', optional: true, file: 'second.md' }
  ] }));
  for (const file of ['WORKFLOW.md', 'first.md', 'second.md']) writeFileSync(join(recipe, file), '# Original frozen instructions\nReport only this stage.\n');
  let assignment;
  const native = [], closed = [];
  const ports = {
    home: join(directory, 'home'), stdout: { write() {} }, stderr: { write() {} },
    withWorkflowLock, inspectWorkflowLock, loadGuidance,
    resolveWorkflowModel: async ({ agent, machineId }) => ({ state: 'selected', selection: {
      agent, machineId, model: 'synthetic-model', effort: null, cliVersion: 'test', catalogRevision: 'test', source: 'defaults'
    } }),
    execFile: async (file, args, options) => {
      if (file === 'git') {
        assert.notEqual(args[0], 'push', 'frozen-input recovery cannot publish');
        return exec(file, args, options);
      }
      assert.equal(file, 'gh');
      if (args[0] === 'repo' && args[1] === 'view') return { stdout: JSON.stringify({ nameWithOwner: 'example/project', defaultBranchRef: { name: 'main' }, url: 'https://github.com/example/project' }) };
      assert.deepEqual(args, ['api', 'repos/example/project/issues/17']);
      return { stdout: JSON.stringify({ number: 17, html_url: issueUrl, title: 'Inspect frozen inputs', body: 'Preserve the saved context.', state: 'OPEN', isPullRequest: false }) };
    },
    allocateIssueWorktree: async ({ runId, repository, issueNumber, workflowName, baseRef }) => {
      assert.equal(assignment, undefined, 'a saved run never allocates a replacement');
      const root = join(directory, 'assigned');
      const branch = `pdd/frozen-${runId}`;
      await git(source, 'worktree', 'add', '-b', branch, root, baseSha);
      assignment = { version: 1, runId, repository, issueNumber, workflowName, baseRef, baseSha,
        sourceRoot: source, commonDir: join(source, '.git'), worktreePath: root, gitDir: await git(root, 'rev-parse', '--absolute-git-dir'), branch };
      return { state: 'ready', assignment };
    },
    lookupIssueWorktree: async ({ runId }) => {
      assert.equal(runId, assignment.runId); return { state: 'ready', assignment };
    },
    runHerdrStage: async (input, stagePorts) => {
      native.push(input);
      const stageInput = JSON.parse(input.instructions.split('PDD_STAGE_INPUT_JSON\n')[1].split('\nPDD_STAGE_INPUT_END')[0]);
      writeFileSync(stageInput.handoffPath, JSON.stringify({ version: 1, runId: input.runId, stageId: input.stageId,
        issueUrl, inputRevision: stageInput.inputRevision, summary: 'Inspected this stage with its saved instructions.', files: [] }));
      const evidence = { readySeq: 1, workingSeq: 2, settledSeq: 3 };
      const backend = { version: 1, runId: input.runId, stageId: input.stageId, attemptId: input.attemptId,
        agent: input.agent, cwd: input.cwd, backendGen: input.backendGen, phase: 'candidate',
        promptDigest: sha(`${input.context}\n\n# Current workflow stage\n${input.instructions}`), terminalId: input.attemptId, nativeSession: null, evidence };
      await stagePorts.checkpoint(backend);
      return { state: 'settled', backend, evidence };
    },
    inspectHerdrStage: async ({ backend }) => ({ state: 'settled', backend, evidence: backend.evidence }),
    closeHerdrStage: async ({ backend }, stagePorts) => {
      closed.push(backend.attemptId);
      const result = { state: 'closed', backend: { ...backend, phase: 'closed' } };
      await stagePorts.checkpoint(result.backend); return result;
    }
  };
  const first = await runWorkflow({ name: 'frozen-source', issue: '17', agent: 'codex', cwd: source, packageRoot }, ports);
  assert.equal(first.state, 'waiting', first.message); assert.equal(first.stage, 'first');
  const runDir = join(assignment.gitDir, 'pdd/workflows', first.runId);
  const journal = join(runDir, 'journal.jsonl');
  const input = join(source, '.git/pdd/workflow-inputs', first.runId, 'input.jsonl');
  return { source, recipe, native, closed, assignment, journal, input, runDir, ports, runId: first.runId,
    resume: options => resumeWorkflow({ runId: first.runId, cwd: source, packageRoot, ...options }, ports) };
}

// Expectations follow the frozen-input, current-decision and source-refusal contracts.
// The B6-owned test file stays unchanged; this route additionally forbids guidance reload.
for (const mutation of ['edit', 'remove']) for (const refusal of ['source', 'frozen']) {
  test(`original recipe ${mutation} preserves frozen progression and ${refusal} refusal`, async t => {
    const f = await fixture(t);
    const initial = await readWorkflowJournal({ runDir: f.runDir });
    const inputBytes = readFileSync(f.input), journalBytes = readFileSync(f.journal);
    if (mutation === 'edit') writeFileSync(join(f.recipe, 'workflow.json'), '{invalid replacement recipe');
    else rmSync(f.recipe, { recursive: true });
    f.ports.loadGuidance = () => { assert.fail('resume must use the saved complete guidance'); };
    const inspection = await f.resume({});
    assert.equal(inspection.state, 'waiting', inspection.message);
    const stale = await f.resume({ decision: 'approve', decisionId: randomUUID(), expect: { stage: 'second', seq: initial.seq } });
    assert.equal(stale.code, 'stale_decision', stale.message);
    assert.deepEqual(readFileSync(f.journal), journalBytes);
    assert.equal(f.native.length, 0); assert.equal(f.closed.length, 0);
    const advanced = await f.resume({ decision: 'approve', decisionId: randomUUID(), expect: { stage: 'first', seq: initial.seq } });
    assert.equal(advanced.state, 'waiting', advanced.message); assert.equal(advanced.stage, 'second');
    assert.equal(f.native.length, 1); assert.equal(f.closed.length, 1);
    assert.equal(f.native[0].context, initial.state.context);
    assert.equal(f.native[0].cwd, f.assignment.worktreePath);
    const current = await readWorkflowJournal({ runDir: f.runDir });
    assert.deepEqual(current.state.assignment, initial.state.assignment);
    assert.deepEqual(current.state.definition, initial.state.definition);
    assert.deepEqual(readFileSync(f.input), inputBytes);
    if (refusal === 'source') writeFileSync(join(f.assignment.worktreePath, 'source.txt'), 'Changed accepted source.\n');
    else { const input = JSON.parse(inputBytes); input.baseContext += '\nAltered frozen instructions.'; writeFileSync(f.input, JSON.stringify(input) + '\n'); }
    const beforeRefusal = readFileSync(f.journal);
    const refused = await f.resume({ decision: 'approve', decisionId: randomUUID(), expect: { stage: 'second', seq: current.seq } });
    assert.equal(refused.state, 'failed', refused.message);
    assert.match(refused.message, refusal === 'source' ? /HEAD or worktree changed/ : /snapshot changed/);
    assert.equal(f.native.length, 1); assert.equal(f.closed.length, 1);
    assert.deepEqual(readFileSync(f.journal), beforeRefusal);
  });
}
