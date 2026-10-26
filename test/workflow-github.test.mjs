import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir, symlink, link, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveWorkflowIssue, prepareWorkflowPr, publishWorkflowPr, reconcileWorkflowPr } from '../src/workflow-github.mjs';

const headSha = 'a'.repeat(40), mergeSha = 'b'.repeat(40);
async function fixture(t) {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'pdd-github-')));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const bodyFile = join(cwd, 'body.md'), calls = [];
  const state = { origin: 'git@github.com:Acme/Project.git', pushOrigin: 'https://github.com/Acme/Project.git',
    dirty: '', branch: 'topic/feature', headSha, count: '1', tracked: false, rows: [], published: false,
    remoteHead: null,
    issue: { number: 12, html_url: 'https://github.com/Acme/Project/issues/12', title: 'Real issue', body: 'Authored body' } };
  const ports = { async execFile(file, args, options) {
    calls.push({ file, args: [...args], options });
    assert.deepEqual(options, { cwd });
    if (state.intercept) { const result = await state.intercept(file, args); if (result !== undefined) return result; }
    const key = `${file} ${args.join(' ')}`;
    let stdout;
    if (key === 'git remote get-url origin') stdout = state.origin;
    else if (key === 'git remote get-url --push --all origin') stdout = state.pushOrigin;
    else if (file === 'gh' && args[0] === 'repo') stdout = JSON.stringify({ nameWithOwner: 'Acme/Project', defaultBranchRef: { name: 'main' }, url: 'https://github.com/Acme/Project' });
    else if (file === 'gh' && args[0] === 'api') stdout = JSON.stringify(state.issue);
    else if (file === 'git' && args[0] === 'check-ref-format') stdout = '';
    else if (key === 'git rev-parse --show-toplevel') stdout = cwd;
    else if (file === 'git' && args[0] === 'ls-files') return { stdout: '', code: state.tracked ? 0 : 1 };
    else if (file === 'git' && args[0] === 'status') stdout = state.dirty;
    else if (file === 'git' && args[0] === 'symbolic-ref') stdout = state.branch;
    else if (key === 'git rev-parse --verify HEAD') stdout = state.headSha;
    else if (file === 'git' && args[0] === 'rev-parse') stdout = 'c'.repeat(40);
    else if (file === 'git' && args[0] === 'rev-list') stdout = state.count;
    else if (file === 'git' && args[0] === 'log') stdout = 'Implement selected feature';
    else if (file === 'gh' && args[0] === 'pr' && args[1] === 'list') stdout = JSON.stringify(state.rows);
    else if (file === 'git' && args[0] === 'ls-remote') return state.remoteHead === null
      ? { stdout: '', code: 2 } : { stdout: `${state.remoteHead}\trefs/heads/${state.branch}\n` };
    else if (file === 'git' && args[0] === 'push') { state.remoteHead = state.headSha; stdout = ''; }
    else if (file === 'gh' && args[0] === 'pr' && args[1] === 'create') { state.published = true; state.rows = [row()]; stdout = 'https://github.com/Acme/Project/pull/999'; }
    else assert.fail(`Unexpected command: ${key}`);
    return { stdout: file === 'git' && args[0] === 'status' ? stdout : stdout + '\n', stderr: '' };
  } };
  const input = { cwd, runId: 'run-123', stageId: 'prompt', repository: 'Acme/Project', baseBranch: 'main', bodyFile };
  return { cwd, bodyFile, calls, state, ports, input, prepare: () => prepareWorkflowPr(input, ports) };
}
function row(extra = {}) {
  return { number: 42, url: 'https://github.com/Acme/Project/pull/42', state: 'OPEN', headRefName: 'topic/feature',
    baseRefName: 'main', headRefOid: headSha, mergeCommit: null, body: 'Authored PR\n\n<!-- pdd-workflow:run-123:prompt -->\n',
    isCrossRepository: false, headRepository: { name: 'Project' }, headRepositoryOwner: { login: 'Acme' }, ...extra };
}
const effects = calls => calls.filter(({ file, args }) => file === 'git' && args[0] === 'push' || file === 'gh' && args[0] === 'pr' && args[1] === 'create');

test('resolves canonical same-origin issue selectors using actual repository and issue fields', async t => {
  const f = await fixture(t);
  for (const issue of [12, '12', 'acme/project#12', 'https://github.com/Acme/Project/issues/12']) {
    assert.deepEqual(await resolveWorkflowIssue({ cwd: f.cwd, issue }, f.ports), { repository: 'Acme/Project', defaultBranch: 'main', issue: { number: 12, url: f.state.issue.html_url, title: 'Real issue', body: 'Authored body' } });
  }
  assert(f.calls.some(c => c.file === 'gh' && c.args.join(' ') === 'api repos/Acme/Project/issues/12'));
  f.state.issue.body = null;
  assert.equal((await resolveWorkflowIssue({ cwd: f.cwd, issue: 12 }, f.ports)).issue.body, '');
});

test('rejects PR URLs, foreign/malformed selectors and actual API pull requests', async t => {
  const f = await fixture(t);
  for (const issue of ['https://github.com/Acme/Project/pull/12', 'Other/Project#12', 0, '01', '12;echo x', 'https://github.com/Acme/Project/issues/12?x=1', '9007199254740992']) {
    await assert.rejects(resolveWorkflowIssue({ cwd: f.cwd, issue }, f.ports), /workflow_github_/);
  }
  f.state.issue.pull_request = {};
  await assert.rejects(resolveWorkflowIssue({ cwd: f.cwd, issue: 12 }, f.ports), /issue_mismatch/);
  delete f.state.issue.pull_request;
  f.state.issue.html_url = 'https://github.com/Other/Project/issues/12';
  await assert.rejects(resolveWorkflowIssue({ cwd: f.cwd, issue: 12 }, f.ports), /issue_mismatch/);
  assert.equal(effects(f.calls).length, 0);
});

test('origin and malformed JSON errors are finite without exposing raw command output', async t => {
  const f = await fixture(t);
  f.state.origin = 'https://secret-token@github.com/Acme/Project.git';
  await assert.rejects(resolveWorkflowIssue({ cwd: f.cwd, issue: 12 }, f.ports), { message: 'workflow_github_origin_invalid' });
  f.state.origin = 'ssh://git@github.com/Acme/Project.git';
  f.state.intercept = (file, args) => file === 'gh' && args[0] === 'repo' ? { stdout: 'secret invalid JSON' } : undefined;
  await assert.rejects(resolveWorkflowIssue({ cwd: f.cwd, issue: 12 }, f.ports), { message: 'workflow_github_json_invalid' });
});

test('prepare preserves authored body, returns exact committed intent and is marker-idempotent without effects', async t => {
  const f = await fixture(t);
  await writeFile(f.bodyFile, 'Authored rationale\n');
  const intent = await f.prepare();
  assert.deepEqual(intent, { repository: 'Acme/Project', runId: 'run-123', stageId: 'prompt', headBranch: 'topic/feature', baseBranch: 'main', headSha, marker: 'pdd-workflow:run-123:prompt', title: 'Implement selected feature', bodyFile: f.bodyFile });
  const body = await readFile(f.bodyFile, 'utf8');
  assert.equal(body, 'Authored rationale\n\n<!-- pdd-workflow:run-123:prompt -->\n');
  assert.deepEqual(await f.prepare(), intent);
  assert.equal(await readFile(f.bodyFile, 'utf8'), body);
  assert.equal(effects(f.calls).length, 0);
});

test('prepare refuses dirty, base, detached, uncommitted, tracked-body and conflicting-marker inputs', async t => {
  const f = await fixture(t);
  for (const [field, value] of [['dirty', ' M src/app.mjs\0'], ['dirty', '?? unrelated\0'], ['branch', 'main'], ['branch', ''], ['headSha', ''], ['count', '0'], ['tracked', true]]) {
    const old = f.state[field]; f.state[field] = value;
    await assert.rejects(f.prepare(), /workflow_github_/);
    f.state[field] = old;
  }
  for (const body of ['<!-- pdd-workflow:other:prompt -->', '<!-- pdd-workflow:run-123:prompt -->\n<!-- pdd-workflow:run-123:prompt -->', '<!-- pdd-workflow:run-123:prompt -->\npdd-workflow:???']) {
    await writeFile(f.bodyFile, body);
    await assert.rejects(f.prepare(), /marker_mismatch/);
  }
  assert.equal(effects(f.calls).length, 0);
});

test('only the declared untracked body metadata may appear in clean status', async t => {
  const f = await fixture(t); f.state.dirty = '?? body.md\0';
  assert.equal((await f.prepare()).headSha, headSha);
  f.state.dirty += '?? extra.md\0';
  await assert.rejects(f.prepare(), /worktree_dirty/);
});

test('first publication pushes saved SHA once, creates once, and trusts readback rather than create stdout', async t => {
  const f = await fixture(t), intent = await f.prepare();
  f.calls.length = 0;
  const result = await publishWorkflowPr({ cwd: f.cwd, intent }, f.ports);
  assert.equal(result.state, 'open'); assert.equal(result.pr.number, 42); assert.equal(result.pr.mergeCommit, null);
  assert.deepEqual(effects(f.calls).map(c => [c.file, c.args]), [
    ['git', ['push', 'origin', `${headSha}:refs/heads/topic/feature`]],
    ['gh', ['pr', 'create', '--repo', 'Acme/Project', '--head', 'topic/feature', '--base', 'main', '--title', intent.title, '--body-file', f.bodyFile]]
  ]);
  const createIndex = f.calls.findIndex(c => c.args[1] === 'create');
  assert(f.calls.slice(createIndex + 1).some(c => c.args[1] === 'list'));
});

test('existing exact PR is recovered without push, create, or body I/O', async t => {
  const f = await fixture(t), intent = await f.prepare(); f.state.rows = [row()]; f.calls.length = 0;
  const ports = { ...f.ports, readFile() { assert.fail('no body read'); }, writeFile() { assert.fail('no write'); } };
  assert.equal((await publishWorkflowPr({ cwd: f.cwd, intent }, ports)).state, 'open');
  assert.equal(effects(f.calls).length, 0);
});

test('changed local source and foreign push URL fail before effects', async t => {
  const f = await fixture(t), intent = await f.prepare();
  for (const [field, value] of [['headSha', 'd'.repeat(40)], ['branch', 'another'], ['pushOrigin', 'git@github.com:Other/Project.git'], ['pushOrigin', 'https://github.com/Acme/Project.git\nhttps://github.com/Other/Project.git']]) {
    const old = f.state[field]; f.state[field] = value;
    assert.equal((await publishWorkflowPr({ cwd: f.cwd, intent }, f.ports)).state, 'failed');
    f.state[field] = old;
  }
  assert.equal(effects(f.calls).length, 0);
});

for (const interrupted of ['push', 'create']) test(`interrupted ${interrupted} requires recovery and reconcile never resends`, async t => {
  const f = await fixture(t), intent = await f.prepare(); f.calls.length = 0;
  f.state.intercept = (file, args) => {
    if (interrupted === 'push' && file === 'git' && args[0] === 'push' || interrupted === 'create' && file === 'gh' && args[1] === 'create') throw new Error('connection lost after unknown effect');
  };
  const result = await publishWorkflowPr({ cwd: f.cwd, intent }, f.ports);
  assert.equal(result.state, 'recovery_required'); assert.equal(result.pr, null);
  assert.equal(effects(f.calls).length, interrupted === 'push' ? 1 : 2);
  f.calls.length = 0;
  assert.equal((await reconcileWorkflowPr({ cwd: f.cwd, intent }, f.ports)).state, 'recovery_required');
  assert.equal(effects(f.calls).length, 0);
  f.state.rows = [row()];
  assert.equal((await reconcileWorkflowPr({ cwd: f.cwd, intent }, f.ports)).state, 'open');
  assert.equal(effects(f.calls).length, 0);
});

test('nonzero push stops before create; successful create with no actual readback remains unknown', async t => {
  const f = await fixture(t), intent = await f.prepare();
  f.state.intercept = (file, args) => file === 'git' && args[0] === 'push' ? { code: 1, stdout: '' } : undefined;
  assert.equal((await publishWorkflowPr({ cwd: f.cwd, intent }, f.ports)).state, 'recovery_required');
  assert.equal(f.calls.filter(c => c.args[1] === 'create').length, 0);
  f.state.intercept = (file, args) => file === 'gh' && args[1] === 'create' ? { stdout: 'https://github.com/Acme/Project/pull/42' } : undefined;
  assert.equal((await publishWorkflowPr({ cwd: f.cwd, intent }, f.ports)).state, 'recovery_required');
});

test('read-only recovery refuses missing, duplicate, mismatched or forked originals', async t => {
  const f = await fixture(t), intent = await f.prepare();
  const cases = [[], [row(), row({ number: 43, url: 'https://github.com/Acme/Project/pull/43' })],
    ...[{ headRefOid: 'd'.repeat(40) }, { headRefName: 'other' }, { baseRefName: 'other' }, { body: 'no marker' },
      { body: '<!-- pdd-workflow:other:prompt -->' }, { isCrossRepository: true }, { headRepositoryOwner: { login: 'Other' } },
      { url: 'https://github.com/Other/Project/pull/42' }, { state: 'UNKNOWN' }].map(change => [row(change)])];
  for (const rows of cases) {
    f.state.rows = rows; f.calls.length = 0;
    const result = await reconcileWorkflowPr({ cwd: f.cwd, intent }, f.ports);
    assert.deepEqual({ state: result.state, pr: result.pr }, { state: 'recovery_required', pr: null });
    assert.equal(effects(f.calls).length, 0);
  }
});

test('open, closed and merged are distinct; merged requires actual GitHub merge OID', async t => {
  const f = await fixture(t), intent = await f.prepare();
  for (const state of ['OPEN', 'CLOSED', 'MERGED']) {
    f.state.rows = [row({ state, mergeCommit: { oid: mergeSha } })];
    const result = await reconcileWorkflowPr({ cwd: f.cwd, intent }, f.ports);
    assert.equal(result.state, state.toLowerCase());
    assert.equal(result.pr.mergeCommit, state === 'MERGED' ? mergeSha : null);
  }
  f.state.rows = [row({ state: 'MERGED', mergeCommit: null })];
  assert.equal((await reconcileWorkflowPr({ cwd: f.cwd, intent }, f.ports)).state, 'recovery_required');
});

test('both marker and head lookup must agree and bounded lookup cannot imply uniqueness', async t => {
  const f = await fixture(t), intent = await f.prepare();
  f.state.intercept = (file, args) => {
    if (file === 'gh' && args[1] === 'list') return { stdout: JSON.stringify([row(args.includes('--head') ? { headRefOid: 'd'.repeat(40) } : {})]) };
  };
  assert.equal((await reconcileWorkflowPr({ cwd: f.cwd, intent }, f.ports)).state, 'recovery_required');
  f.state.intercept = undefined; f.state.rows = Array.from({ length: 100 }, () => row());
  assert.equal((await reconcileWorkflowPr({ cwd: f.cwd, intent }, f.ports)).state, 'recovery_required');
  assert.equal(effects(f.calls).length, 0);
});

test('captured intent cannot be changed by caller while command awaits', async t => {
  const f = await fixture(t), intent = await f.prepare(); f.state.rows = [row()];
  let release; const paused = new Promise(resolve => { release = resolve; }); let entered;
  const started = new Promise(resolve => { entered = resolve; });
  f.state.intercept = async (file, args) => {
    if (file === 'git' && args[0] === 'remote') { entered(); await paused; }
  };
  const reading = reconcileWorkflowPr({ cwd: f.cwd, intent }, f.ports);
  await started; intent.headSha = 'd'.repeat(40); intent.repository = 'Other/Repo'; release();
  const result = await reading;
  assert.equal(result.state, 'open'); assert.equal(result.pr.headSha, headSha);
});


test('real disposable Git checkout enforces topic commits, dirt and root-gitdir metadata with fake GitHub only', async t => {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'pdd-github-real-git-')));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const execute = promisify(execFile);
  const git = (...args) => execute('git', args, { cwd, encoding: 'utf8' });
  await git('init', '--initial-branch=main');
  await git('config', 'user.name', 'Disposable test');
  await git('config', 'user.email', 'test@example.invalid');
  await writeFile(join(cwd, 'source.txt'), 'base\n');
  await git('add', 'source.txt'); await git('commit', '-m', 'Initial base');
  await git('remote', 'add', 'origin', 'https://github.com/Acme/Project.git');
  await git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  await git('switch', '-c', 'topic/real');
  const bodyFile = join(cwd, '.git', 'workflow-body.md');
  const input = { cwd, runId: 'real-run', stageId: 'code', repository: 'Acme/Project', baseBranch: 'main', bodyFile };
  const calls = [];
  const ports = { async execFile(file, args, options) {
    assert.deepEqual(options, { cwd }); calls.push([file, args]);
    if (file === 'git') {
      assert.notEqual(args[0], 'push', 'no real push allowed');
      return execute(file, args, { ...options, encoding: 'utf8' });
    }
    assert.deepEqual(args, ['repo', 'view', 'Acme/Project', '--json', 'nameWithOwner,defaultBranchRef,url']);
    return { stdout: JSON.stringify({ nameWithOwner: 'Acme/Project', defaultBranchRef: { name: 'main' }, url: 'https://github.com/Acme/Project' }) };
  } };
  await assert.rejects(prepareWorkflowPr(input, ports), /topic_has_no_commits/);
  await writeFile(join(cwd, 'source.txt'), 'topic change\n');
  await assert.rejects(prepareWorkflowPr(input, ports), /worktree_dirty/);
  await git('add', 'source.txt'); await git('commit', '-m', 'Actual committed topic');
  const intent = await prepareWorkflowPr(input, ports);
  assert.equal(intent.headSha, (await git('rev-parse', 'HEAD')).stdout.trim());
  assert.equal(intent.headBranch, 'topic/real');
  assert.equal(intent.title, 'Actual committed topic');
  assert.equal((await git('status', '--porcelain=v1')).stdout, '');
  assert.match(await readFile(bodyFile, 'utf8'), /<!-- pdd-workflow:real-run:code -->/);
  await git('switch', '--detach');
  await assert.rejects(prepareWorkflowPr(input, ports), /command_failed/);
  assert(calls.every(([file, args]) => file !== 'gh' || args[0] === 'repo'));
});


test('rejected push with numeric zero is unknown and cannot continue to create or resend', async t => {
  const f = await fixture(t), intent = await f.prepare(); f.calls.length = 0;
  f.state.intercept = (file, args) => {
    if (file === 'git' && args[0] === 'push') throw Object.assign(new Error('unknown push'), { code: 0, stdout: '' });
  };
  const result = await publishWorkflowPr({ cwd: f.cwd, intent }, f.ports);
  assert.equal(result.state, 'recovery_required'); assert.equal(result.pr, null);
  assert.equal(f.calls.filter(c => c.file === 'git' && c.args[0] === 'push').length, 1);
  assert.equal(f.calls.filter(c => c.file === 'gh' && c.args[1] === 'create').length, 0);
  f.calls.length = 0;
  const readonlyPorts = { ...f.ports, readFile() { assert.fail('no recovery body read'); }, writeFile() { assert.fail('no recovery write'); } };
  assert.equal((await reconcileWorkflowPr({ cwd: f.cwd, intent }, readonlyPorts)).state, 'recovery_required');
  f.state.rows = [row()];
  assert.equal((await reconcileWorkflowPr({ cwd: f.cwd, intent }, readonlyPorts)).state, 'open');
  assert.equal(effects(f.calls).length, 0);
});

for (const alias of ['file symlink', 'ancestor symlink', 'hard link']) test(`real Git metadata ${alias} refuses before body write and preserves tracked bytes`, async t => {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'pdd-github-alias-')));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const execute = promisify(execFile), git = (...args) => execute('git', args, { cwd, encoding: 'utf8' });
  await git('init', '--initial-branch=main');
  await git('config', 'user.name', 'Disposable test'); await git('config', 'user.email', 'test@example.invalid');
  await mkdir(join(cwd, 'src'));
  const target = join(cwd, 'src', 'source.txt'), original = 'Committed source must stay exact\n';
  await writeFile(target, original); await git('add', 'src/source.txt'); await git('commit', '-m', 'Base source');
  await git('remote', 'add', 'origin', 'https://github.com/Acme/Project.git');
  await git('update-ref', 'refs/remotes/origin/main', 'HEAD'); await git('switch', '-c', 'topic/alias');
  await git('commit', '--allow-empty', '-m', 'Committed topic');
  let bodyFile = join(cwd, '.git', 'body.md');
  if (alias === 'file symlink') await symlink(target, bodyFile);
  else if (alias === 'hard link') await link(target, bodyFile);
  else {
    await symlink(join(cwd, 'src'), join(cwd, '.git', 'body-dir'), 'dir');
    bodyFile = join(cwd, '.git', 'body-dir', 'source.txt');
  }
  assert.equal((await git('status', '--porcelain=v1')).stdout, '');
  const calls = []; let writes = 0;
  const ports = { async execFile(file, args, options) {
    calls.push({ file, args }); assert.deepEqual(options, { cwd });
    if (file === 'git') { assert.notEqual(args[0], 'push'); return execute(file, args, { ...options, encoding: 'utf8' }); }
    assert.deepEqual(args, ['repo', 'view', 'Acme/Project', '--json', 'nameWithOwner,defaultBranchRef,url']);
    return { stdout: JSON.stringify({ nameWithOwner: 'Acme/Project', defaultBranchRef: { name: 'main' }, url: 'https://github.com/Acme/Project' }) };
  }, async writeFile(...args) { writes++; return writeFile(...args); } };
  await assert.rejects(prepareWorkflowPr({ cwd, runId: 'alias-run', stageId: 'code', repository: 'Acme/Project', baseBranch: 'main', bodyFile }, ports), /workflow_github_body_unsafe/);
  assert.equal(writes, 0); assert.equal(effects(calls).length, 0);
  assert.equal(await readFile(target, 'utf8'), original);
  assert.equal((await git('status', '--porcelain=v1')).stdout, '');
});


test('explicit unpublished-only recovery proves both absences and publishes the unchanged original once', async t => {
  const f = await fixture(t), intent = await f.prepare(), original = JSON.stringify(intent);
  f.calls.length = 0;
  assert.equal((await reconcileWorkflowPr({ cwd: f.cwd, intent }, f.ports)).state, 'recovery_required');
  assert.equal(effects(f.calls).length, 0);
  assert(!f.calls.some(c => c.args[0] === 'ls-remote'));
  f.calls.length = 0;
  const actual = await publishWorkflowPr({ cwd: f.cwd, intent, unpublishedOnly: true }, f.ports);
  assert.equal(actual.state, 'open'); assert.equal(actual.pr.headSha, intent.headSha);
  assert.equal(JSON.stringify(intent), original);
  const remote = f.calls.findIndex(c => c.args[0] === 'ls-remote'), push = f.calls.findIndex(c => c.args[0] === 'push');
  assert(remote >= 0 && remote < push);
  assert.deepEqual(f.calls[remote].args, ['ls-remote', '--exit-code', '--refs', 'origin', 'refs/heads/topic/feature']);
  assert.equal(f.calls.filter(c => c.file === 'gh' && c.args[1] === 'list' && f.calls.indexOf(c) < remote).length, 2);
  assert.deepEqual(effects(f.calls).map(c => [c.file, c.args[0], c.args[1]]), [['git', 'push', 'origin'], ['gh', 'pr', 'create']]);
});

test('unpublished-only present or unconfirmed remote head refuses all publication effects', async t => {
  const f = await fixture(t), intent = await f.prepare();
  const responses = [
    { stdout: `${headSha}\trefs/heads/topic/feature\n`, code: 0 },
    { stdout: `${'d'.repeat(40)}\trefs/heads/topic/feature\n`, code: 0 },
    { stdout: '', code: 0 }, { stdout: 'malformed', code: 2 }, { stdout: '\n', code: 2 },
    { stdout: '', code: 128 }, { stdout: '', code: 1 },
    Object.assign(new Error('rejected zero'), { code: 0, stdout: '' }),
    Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })
  ];
  for (const response of responses) {
    f.state.intercept = (file, args) => {
      if (file === 'git' && args[0] === 'ls-remote') {
        if (response instanceof Error) throw response;
        return response;
      }
    };
    f.calls.length = 0;
    const actual = await publishWorkflowPr({ cwd: f.cwd, intent, unpublishedOnly: true }, f.ports);
    assert.equal(actual.state, 'recovery_required'); assert.equal(actual.pr, null);
    assert.equal(effects(f.calls).length, 0);
  }
});

test('unpublished-only any existing PR or uncertain original lookup stays inspect-only', async t => {
  const f = await fixture(t), intent = await f.prepare();
  for (const rows of [[row()], [row({ state: 'CLOSED' })], [row({ state: 'MERGED', mergeCommit: { oid: mergeSha } })],
    [row({ headRefOid: 'd'.repeat(40) })], [row(), row({ number: 43 })], Array.from({ length: 100 }, () => row())]) {
    f.state.rows = rows; f.calls.length = 0;
    assert.equal((await publishWorkflowPr({ cwd: f.cwd, intent, unpublishedOnly: true }, f.ports)).state, 'recovery_required');
    assert.equal(effects(f.calls).length, 0); assert(!f.calls.some(c => c.args[0] === 'ls-remote'));
  }
  for (const stdout of ['bad JSON', '{}']) {
    f.state.intercept = (file, args) => file === 'gh' && args[1] === 'list' ? { stdout } : undefined;
    f.calls.length = 0;
    assert.equal((await publishWorkflowPr({ cwd: f.cwd, intent, unpublishedOnly: true }, f.ports)).state, 'recovery_required');
    assert.equal(effects(f.calls).length, 0);
  }
});

test('unpublished-only rechecks saved source, repository and marker before effects', async t => {
  const f = await fixture(t), intent = await f.prepare(), body = await readFile(f.bodyFile, 'utf8');
  for (const change of [{ branch: 'other' }, { headSha: 'd'.repeat(40) }, { dirty: ' M source.mjs\0' },
    { pushOrigin: 'https://github.com/Other/Project.git' }, { pushOrigin: 'https://github.com/Acme/Project.git\nhttps://github.com/Other/Project.git' }]) {
    const before = { ...f.state }; Object.assign(f.state, change); f.calls.length = 0;
    assert.equal((await publishWorkflowPr({ cwd: f.cwd, intent, unpublishedOnly: true }, f.ports)).state, 'recovery_required');
    assert.equal(effects(f.calls).length, 0); Object.assign(f.state, before);
  }
  await writeFile(f.bodyFile, body.replace(intent.marker, 'pdd-workflow:other:stage'));
  f.calls.length = 0;
  assert.equal((await publishWorkflowPr({ cwd: f.cwd, intent, unpublishedOnly: true }, f.ports)).state, 'recovery_required');
  assert.equal(effects(f.calls).length, 0);
});

test('unpublished-only refuses body or source changes while remote absence read waits', async t => {
  const f = await fixture(t), intent = await f.prepare(), body = await readFile(f.bodyFile, 'utf8');
  for (const kind of ['body', 'head', 'dirty', 'origin']) {
    f.state.headSha = headSha; f.state.dirty = ''; f.state.origin = 'git@github.com:Acme/Project.git';
    await writeFile(f.bodyFile, body); f.calls.length = 0;
    f.state.intercept = async (file, args) => {
      if (file === 'git' && args[0] === 'ls-remote') {
        if (kind === 'body') await writeFile(f.bodyFile, 'Changed authored text\n' + body);
        if (kind === 'head') f.state.headSha = 'd'.repeat(40);
        if (kind === 'dirty') f.state.dirty = ' M source.mjs\0';
        if (kind === 'origin') f.state.origin = 'https://github.com/Other/Project.git';
        return { stdout: '', code: 2 };
      }
    };
    assert.equal((await publishWorkflowPr({ cwd: f.cwd, intent, unpublishedOnly: true }, f.ports)).state, 'recovery_required');
    assert.equal(effects(f.calls).length, 0);
  }
});

for (const operation of ['push', 'create']) test(`unpublished-only uncertain ${operation} never resends or follows rejected push with create`, async t => {
  const f = await fixture(t), intent = await f.prepare();
  f.calls.length = 0;
  f.state.intercept = (file, args) => {
    if (file === 'git' && args[0] === 'push' && operation === 'push') {
      f.state.remoteHead = headSha;
      throw Object.assign(new Error('lost push reply'), { code: 0, stdout: '' });
    }
    if (file === 'gh' && args[1] === 'create' && operation === 'create') throw Object.assign(new Error('lost create reply'), { code: 'ETIMEDOUT' });
  };
  assert.equal((await publishWorkflowPr({ cwd: f.cwd, intent, unpublishedOnly: true }, f.ports)).state, 'recovery_required');
  assert.equal(effects(f.calls).length, operation === 'push' ? 1 : 2);
  f.state.intercept = undefined; f.calls.length = 0;
  assert.equal((await reconcileWorkflowPr({ cwd: f.cwd, intent }, f.ports)).state, 'recovery_required');
  assert.equal((await publishWorkflowPr({ cwd: f.cwd, intent, unpublishedOnly: true }, f.ports)).state, 'recovery_required');
  assert.equal(effects(f.calls).length, 0);
  f.state.rows = [row()];
  assert.equal((await reconcileWorkflowPr({ cwd: f.cwd, intent }, f.ports)).state, 'open');
  assert.equal(effects(f.calls).length, 0);
});

test('unpublished-only rejects nonboolean mode without effects', async t => {
  const f = await fixture(t), intent = await f.prepare();
  f.calls.length = 0;
  for (const unpublishedOnly of [null, 'true', 1, {}])
    assert.equal((await publishWorkflowPr({ cwd: f.cwd, intent, unpublishedOnly }, f.ports)).state, 'failed');
  assert.equal(f.calls.length, 0);
});

test('real local Git proves absent remote branch, recovers one original publication and refuses its present head', async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'pdd-unpublished-real-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cwd = join(directory, 'source'), remote = join(directory, 'remote.git'); await mkdir(cwd);
  const execute = promisify(execFile), git = (...args) => execute('git', args, { cwd, encoding: 'utf8' });
  await git('init', '--initial-branch=main'); await git('config', 'user.name', 'Disposable test');
  await git('config', 'user.email', 'test@example.invalid'); await git('commit', '--allow-empty', '-m', 'Base');
  await git('init', '--bare', remote); await git('remote', 'add', 'origin', 'https://github.com/Acme/Project.git');
  await git('update-ref', 'refs/remotes/origin/main', 'HEAD'); await git('switch', '-c', 'topic/real-recovery');
  await writeFile(join(cwd, 'source.txt'), 'Committed actual source\n'); await git('add', 'source.txt'); await git('commit', '-m', 'Actual topic');
  const actualSha = (await git('rev-parse', 'HEAD')).stdout.trim(), calls = []; let rows = [];
  const ports = { async execFile(file, args, options) {
    assert.deepEqual(options, { cwd }); calls.push({ file, args: [...args] });
    if (file === 'git') {
      if (['push', 'ls-remote'].includes(args[0])) {
        const localArgs = args.map((arg, i) => arg === 'origin' && i > 0 ? remote : arg);
        return execute('git', localArgs, { cwd, encoding: 'utf8' });
      }
      return execute(file, args, { cwd, encoding: 'utf8' });
    }
    if (args[0] === 'repo') return { stdout: JSON.stringify({ nameWithOwner: 'Acme/Project', defaultBranchRef: { name: 'main' }, url: 'https://github.com/Acme/Project' }) };
    if (args[1] === 'list') return { stdout: JSON.stringify(rows) };
    assert.equal(args[1], 'create');
    // Simulate a lost create acknowledgement AFTER a real local push, never any live GitHub request.
    throw Object.assign(new Error('lost create reply'), { code: 'ETIMEDOUT' });
  } };
  const bodyFile = join(cwd, '.git', 'pr.md');
  const intent = await prepareWorkflowPr({ cwd, runId: 'real-original', stageId: 'code', repository: 'Acme/Project', baseBranch: 'main', bodyFile }, ports);
  const saved = JSON.stringify(intent), body = await readFile(bodyFile, 'utf8'); calls.length = 0;
  assert.equal((await publishWorkflowPr({ cwd, intent, unpublishedOnly: true }, ports)).state, 'recovery_required');
  assert.equal(effects(calls).length, 2);
  assert.equal((await git('ls-remote', remote, 'refs/heads/topic/real-recovery')).stdout.trim(), `${actualSha}\trefs/heads/topic/real-recovery`);
  calls.length = 0;
  assert.equal((await publishWorkflowPr({ cwd, intent, unpublishedOnly: true }, ports)).state, 'recovery_required');
  assert.equal(effects(calls).length, 0);
  rows = [row({ headRefName: intent.headBranch, headRefOid: actualSha, body })];
  assert.equal((await reconcileWorkflowPr({ cwd, intent }, ports)).state, 'open');
  assert.equal(effects(calls).length, 0); assert.equal(JSON.stringify(intent), saved);
  assert.equal(await readFile(bodyFile, 'utf8'), body);
  assert.equal((await git('status', '--porcelain=v1')).stdout, '');
});

const vectors=JSON.parse(await readFile(new URL('../vectors/cli/workflow-github.json',import.meta.url),'utf8'));
for(const c of vectors.cases.filter(c=>c.id!=='scan-advisory'))test(`independent vector: ${c.id}`,async t=>{
  if (c.id === 'accepted-scope-artifact-composition' || c.id.startsWith('artifact-checkpoint-')) return checkpointCase(t, c.id);
  const f=await fixture(t),expected=c.expected;
  if(c.id==='issue-normalization'){f.state.issue={number:412,html_url:'https://github.com/Acme/Project/issues/412',title:'Synthetic issue',body:null};const value=await resolveWorkflowIssue({cwd:f.cwd,issue:'Acme/Project#412'},f.ports);assert.equal(value.issue.number,expected.issueNumber);assert.equal(value.issue.body,expected.body);assert.equal(value.repository,'Acme/Project');}
  else if(c.id==='pr-not-issue'){f.state.issue.pull_request={url:'https://api.github.com/repos/Acme/Project/pulls/12'};await assert.rejects(resolveWorkflowIssue({cwd:f.cwd,issue:12},f.ports));assert.equal(effects(f.calls).length,0);}
  else if(c.id==='foreign-repository')await assert.rejects(resolveWorkflowIssue({cwd:f.cwd,issue:'other/repo#12'},f.ports));
  else if(c.id==='prepare-no-publication'){await writeFile(f.bodyFile,'Authored PR\n');const intent=await f.prepare();assert.equal((await readFile(intent.bodyFile,'utf8')).startsWith('Authored PR\n'),expected.authoredBodyPreserved);assert.equal((await readFile(intent.bodyFile,'utf8')).split(intent.marker).length-1,expected.ownLineMarkerCount);assert.equal(effects(f.calls).length,0);}
  else if(c.id==='dirty-topic'){f.state.dirty=' M source.mjs\n';await assert.rejects(f.prepare());assert.equal(effects(f.calls).length,0);}
  else if(c.id==='body-alias'){const source=join(f.cwd,'source.mjs');await writeFile(source,'keep\n');await symlink(source,f.bodyFile);await assert.rejects(f.prepare());assert.equal(await readFile(source,'utf8'),'keep\n');}
  else {
    const intent=await f.prepare();
    if(c.id==='unknown-push')f.state.intercept=async(file,args)=>{if(file==='git'&&args[0]==='push')throw Error('lost push reply');};
    if(c.id==='ambiguous-reconcile')f.state.rows=[row(),row({number:43,url:'https://github.com/Acme/Project/pull/43'})];
    if(c.id==='remote-head-present')f.state.remoteHead=headSha;
    if(c.id==='closed-is-not-merged')f.state.rows=[row({state:'CLOSED'})];
    const value=['ambiguous-reconcile','closed-is-not-merged'].includes(c.id)?await reconcileWorkflowPr({cwd:f.cwd,intent},f.ports):await publishWorkflowPr({cwd:f.cwd,intent,...(['explicit-absence-recovery','remote-head-present'].includes(c.id)?{unpublishedOnly:true}:{})},f.ports);
    if(expected.state)assert.equal(value.state,expected.state,value.message);
    if(c.id==='explicit-absence-recovery'){assert.equal(value.state,'open');assert.equal(effects(f.calls).length,2);assert.ok(f.calls.find(x=>x.file==='git'&&x.args[0]==='push').args.includes(headSha+':refs/heads/topic/feature'));}
    if(c.id==='unknown-push')assert.equal(f.state.published,false);
    if(['ambiguous-reconcile','remote-head-present','closed-is-not-merged'].includes(c.id))assert.equal(effects(f.calls).length,0);
    if(c.id==='closed-is-not-merged')assert.equal(value.pr.mergeCommit,expected.mergeCommit);
  }
});


async function checkpointFixture(t, paths = ['README.prompt.md', 'README.story.md', 'README.cases.md']) {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'pdd-artifact-commit-')));
  t.after(() => rm(cwd, {recursive:true, force:true}));
  const execute = promisify(execFile), calls = [];
  const git = async (...args) => (await execute('git', args, {cwd})).stdout.trim();
  await git('init', '-b', 'main'); await git('config', 'user.email', 'test@example.invalid');
  await git('config', 'user.name', 'Artifact Test');
  await writeFile(join(cwd, 'README.md'), 'base\n'); await git('add', '--', 'README.md'); await git('commit', '-m', 'base');
  await git('remote', 'add', 'origin', 'https://github.com/Acme/Project.git');
  await git('update-ref', 'refs/remotes/origin/main', 'HEAD'); await git('switch', '-c', 'topic/artifacts');
  const {createHash} = await import('node:crypto');
  const files = [];
  for (const [i, path] of paths.entries()) {
    await writeFile(join(cwd, path), 'approved artifact '+i+'\n');
    files.push({path,sha256:createHash('sha256').update(await readFile(join(cwd,path))).digest('hex'),role:['prompt','story','cases'][i%3]});
  }
  await writeFile(join(cwd, 'README.md'), 'agent change\n'); await git('add', '--', 'README.md');
  await git('commit', '-m', 'agent implementation only');
  const expectedHead = await git('rev-parse', 'HEAD');
  let pr = null;
  const ports = {async execFile(file,args,options) {
    calls.push({file,args:[...args]});
    if (file==='git' && args[0]==='push') return {stdout:''};
    if (file==='git') return execute(file,args,options);
    assert.equal(file,'gh');
    if (args[0]==='repo') return {stdout:JSON.stringify({nameWithOwner:'Acme/Project',defaultBranchRef:{name:'main'},url:'https://github.com/Acme/Project'})};
    if (args[1]==='list') return {stdout:JSON.stringify(pr?[pr]:[])};
    assert.equal(args[1],'create'); const value=flag=>args[args.indexOf(flag)+1];
    pr=row({headRefName:value('--head'),headRefOid:await git('rev-parse','HEAD'),body:await readFile(value('--body-file'),'utf8')});
    return {stdout:pr.url};
  }};
  const input={cwd,runId:'run-123',stageId:'prompt',headBranch:'topic/artifacts',baseBranch:'main',expectedHead,files};
  const commit = async (overrides={},customPorts=ports) => {
    const {commitWorkflowArtifacts} = await import('../src/workflow-github.mjs');
    return commitWorkflowArtifacts({...input,...overrides},customPorts);
  };
  return {cwd,git,files,calls,ports,input,commit};
}

async function checkpointCase(t, id) {
  const f=await checkpointFixture(t);
  if(id==='artifact-checkpoint-unrelated-dirty') {
    for(const staged of [false,true]) {
      await writeFile(join(f.cwd,'unrelated draft.txt'),'keep\n');
      if(staged) await f.git('add','--','unrelated draft.txt');
      const index=await f.git('diff','--cached','--binary');
      await assert.rejects(f.commit(),error=>/unrelated draft.txt/.test(error.message)&&/commit or move/i.test(error.message));
      assert.equal(await f.git('rev-parse','HEAD'),f.input.expectedHead);
      assert.equal(await f.git('diff','--cached','--binary'),index);
      assert.equal(await readFile(join(f.cwd,'unrelated draft.txt'),'utf8'),'keep\n');
    }
    return;
  }
  if(id==='artifact-checkpoint-drift') {
    await assert.rejects(f.commit({expectedHead:'d'.repeat(40)}));
    await assert.rejects(f.commit({headBranch:'other'}));
    await assert.rejects(f.commit({baseBranch:'topic/artifacts'}));
    await writeFile(join(f.cwd,f.files[0].path),'not accepted\n');
    await assert.rejects(f.commit(),/hash/);
    assert.equal(await f.git('rev-parse','HEAD'),f.input.expectedHead);
    assert.equal(await f.git('diff','--cached','--name-only'),'');
    return;
  }
  const committed=await f.commit();
  assert.equal(committed.previousHead,f.input.expectedHead);
  assert.notEqual(committed.headSha,f.input.expectedHead);
  assert.deepEqual([...committed.committedPaths].sort(),f.files.map(x=>x.path).sort());
  assert.equal(await f.git('status','--porcelain'),'');
  assert.equal(await f.git('rev-parse','HEAD^'),f.input.expectedHead);
  assert.deepEqual((await f.git('diff-tree','--no-commit-id','--name-only','-r','HEAD')).split('\n').sort(),f.files.map(x=>x.path).sort());
  for(const file of f.files) assert.equal(await f.git('show',`HEAD:${file.path}`),(await readFile(join(f.cwd,file.path),'utf8')).trim());
  assert.equal(await f.git('show','HEAD:README.md'),'agent change');
  if(id==='artifact-checkpoint-inspection-and-interruption') {
    await assert.rejects(f.commit(),/source_changed/);
    const again=await f.commit({expectedHead:committed.headSha});
    assert.deepEqual(again.committedPaths,[]);
    assert.equal(await f.git('rev-parse','HEAD'),committed.headSha);
    assert.equal(f.calls.filter(c=>c.file==='git'&&c.args.includes('commit')).length,1);
    return;
  }
  const intent=await prepareWorkflowPr({cwd:f.cwd,runId:'run-123',stageId:'prompt',repository:'Acme/Project',baseBranch:'main',bodyFile:join(f.cwd,'.git','pr.md')},f.ports);
  assert.equal(intent.headSha,committed.headSha);
  const result=await publishWorkflowPr({cwd:f.cwd,intent},f.ports);
  assert.equal(result.state,'open',result.message);
  assert.equal(result.pr.headSha,committed.headSha);
  assert.equal(effects(f.calls).length,2);
}

test('accepted artifact literal pathspecs preserve spaces, leading dashes and Git pathspec punctuation',async t=>{
  const f=await checkpointFixture(t,['-prompt.md','story with space.md',':(glob)cases*.md']);
  await f.commit();
  assert.deepEqual((await f.git('diff-tree','--no-commit-id','--name-only','-r','HEAD')).split('\n').sort(),f.files.map(x=>x.path).sort());
});

test('accepted artifact symlinks and implicit directory/pathspec scope cannot be committed',async t=>{
  const f=await checkpointFixture(t);
  await rm(join(f.cwd,f.files[0].path)); await symlink('README.md',join(f.cwd,f.files[0].path));
  await assert.rejects(f.commit(),/regular|symlink/);
  await assert.rejects(f.commit({files:[{...f.files[0],path:'../outside'}]}));
  await assert.rejects(f.commit({files:[{...f.files[0],role:'implementation'}]}));
  assert.equal(await f.git('rev-parse','HEAD'),f.input.expectedHead);
  assert.equal(await f.git('diff','--cached','--name-only'),'');
});


test('artifact checkpoint refuses a different staged version without replacing it',async t=>{
  const f=await checkpointFixture(t),path=f.files[0].path;
  const accepted=await readFile(join(f.cwd,path));
  await writeFile(join(f.cwd,path),'separate staged work\n'); await f.git('add','--',path);
  const staged=await f.git('show',`:${path}`);
  await writeFile(join(f.cwd,path),accepted);
  await assert.rejects(f.commit(),/artifact_index_changed/);
  assert.equal(await f.git('show',`:${path}`),staged);
  assert.deepEqual(await readFile(join(f.cwd,path)),accepted);
  assert.equal(await f.git('rev-parse','HEAD'),f.input.expectedHead);
});

test('artifact checkpoint refuses Git content conversion instead of committing bytes outside the handoff hash',async t=>{
  const f=await checkpointFixture(t),file=f.files[0];
  await f.git('config','core.autocrlf','true');
  await writeFile(join(f.cwd,file.path),'accepted CRLF\r\n');
  const {createHash}=await import('node:crypto');
  file.sha256=createHash('sha256').update(await readFile(join(f.cwd,file.path))).digest('hex');
  await assert.rejects(f.commit(),/artifact_index_changed/);
  assert.equal(await f.git('rev-parse','HEAD'),f.input.expectedHead);
  assert.equal(await readFile(join(f.cwd,file.path),'utf8'),'accepted CRLF\r\n');
});

test('artifact checkpoint rejects unrelated rename destinations and sources without index or history loss',async t=>{
  const f=await checkpointFixture(t);
  await f.git('mv','README.md','unrelated renamed.md');
  const index=await f.git('diff','--cached','--binary');
  await assert.rejects(f.commit(),error=>/README.md/.test(error.message)&&/unrelated renamed.md/.test(error.message));
  assert.equal(await f.git('diff','--cached','--binary'),index);
  assert.equal(await f.git('rev-parse','HEAD'),f.input.expectedHead);
});


test('artifact checkpoint preserves an independent staged draft at the final status observation',async t=>{
  const f=await checkpointFixture(t),path=f.files[0].path;
  const accepted=await readFile(join(f.cwd,path));
  let status=0,injected=false,error=null;
  const ports={async execFile(file,args,options){
    if(file==='git'&&args[0]==='status'&&++status===3){
      await writeFile(join(f.cwd,path),'New independent staged draft\n');
      await f.git('add','--',path);
      await writeFile(join(f.cwd,path),accepted);
      injected=true;
    }
    return f.ports.execFile(file,args,options);
  }};
  try { await f.commit({},ports); } catch(e) { error=e; }
  assert.equal(injected,true);
  assert.equal(await f.git('show',':'+path),'New independent staged draft');
  assert.ok(error,'a changed independent index must refuse');
  assert.equal(error.code,'workflow_github_artifact_index_changed');
  assert.match(error.message,/different staged changes.*Commit or move.*preserved your index/);
  assert.equal(await f.git('rev-parse','HEAD'),f.input.expectedHead);
  assert.deepEqual(await readFile(join(f.cwd,path)),accepted);
});

test('artifact checkpoint respects an existing Git index lock without removing it or changing staged work',async t=>{
  const f=await checkpointFixture(t),index=await readFile(join(f.cwd,'.git','index'));
  const lock=join(f.cwd,'.git','index.lock');
  await writeFile(lock,'independent Git lock\n');
  await assert.rejects(f.commit(),error=>error.code==='workflow_github_artifact_index_busy');
  assert.equal(await readFile(lock,'utf8'),'independent Git lock\n');
  assert.deepEqual(await readFile(join(f.cwd,'.git','index')),index);
  assert.equal(await f.git('rev-parse','HEAD'),f.input.expectedHead);
});

test('artifact checkpoint excludes a concurrent Git index writer while publishing its validated private index',async t=>{
  const f=await checkpointFixture(t);let attempted=false;
  const ports={async execFile(file,args,options){
    if(file==='git'&&args[0]==='commit'){
      attempted=true;
      assert.ok(options.env.GIT_INDEX_FILE);
      await assert.rejects(f.git('add','--',f.files[0].path),error=>/index\.lock/.test(error.stderr));
    }
    return f.ports.execFile(file,args,options);
  }};
  await f.commit({},ports);
  assert.equal(attempted,true);
  assert.equal(await f.git('status','--porcelain'),'');
  assert.equal(await f.git('rev-parse','HEAD^'),f.input.expectedHead);
});


const publicationDescription = () => ({
  issue: {number:12, url:'https://github.com/Acme/Project/issues/12', title:'Use the requested value'},
  summary:'Change the value.\nKeep the existing interface.',
  checks:[{argv:['node','check.mjs'],exitCode:0}]
});

test('C12 issue description preserves authored body and remains marker-idempotent', async t => {
  const f = await fixture(t), description = publicationDescription();
  await writeFile(f.bodyFile, 'Authored rationale\n');
  const input = {...f.input,description};
  const intent = await prepareWorkflowPr(input,f.ports);
  assert.equal(intent.title,'Use the requested value');
  const body = await readFile(f.bodyFile,'utf8');
  assert.ok(body.startsWith('Authored rationale\n'));
  assert.match(body,/Closes #12/);
  assert.match(body,/Change the value\. Keep the existing interface\./);
  assert.ok(body.includes('PASS (exit 0): ["node","check.mjs"]'));
  assert.equal(body.split(intent.marker).length-1,1);
  assert.deepEqual(await prepareWorkflowPr(input,f.ports),intent);
  assert.equal(await readFile(f.bodyFile,'utf8'),body);
  assert.equal(effects(f.calls).length,0);
});

test('C12 description refuses foreign identity, invalid evidence and injected markers without overwriting authored text', async t => {
  const invalid = [
    d => d.issue.url='https://github.com/Other/Project/issues/12',
    d => d.issue.number=0,
    d => d.issue.title='Bad\ntitle',
    d => d.issue.title='x'.repeat(257),
    d => d.summary='<!-- pdd-workflow:other:stage -->',
    d => d.checks[0].exitCode=null,
    d => d.checks[0].argv=['node','pdd-workflow:other:stage']
  ];
  for(const mutate of invalid) {
    const f = await fixture(t), description = publicationDescription(); mutate(description);
    await writeFile(f.bodyFile,'Preserve this authored text\n');
    await assert.rejects(prepareWorkflowPr({...f.input,description},f.ports),/workflow_github_/);
    assert.equal(await readFile(f.bodyFile,'utf8'),'Preserve this authored text\n');
    assert.equal(effects(f.calls).length,0);
  }
});

test('C12 description bounds long summaries and reports failed results without copying raw output', async t => {
  const f=await fixture(t),description=publicationDescription();
  description.summary='x'.repeat(600);
  description.checks=[{argv:['node','check.mjs'],exitCode:1,stdout:'private stdout',stderr:'private stderr'}];
  const intent=await prepareWorkflowPr({...f.input,description},f.ports),body=await readFile(intent.bodyFile,'utf8');
  assert.ok(body.includes('x'.repeat(499)+'…'));
  assert.ok(!body.includes('x'.repeat(500)));
  assert.ok(body.includes('FAIL (exit 1): ["node","check.mjs"]'));
  assert.doesNotMatch(body,/private stdout|private stderr/);
});


test('C12 sparse verification evidence refuses before changing the authored body', async t => {
  const cases = [
    ['missing check', d => { d.checks = Array(1); }],
    ['hole after a valid check', d => { d.checks.length = 2; }],
    ['missing executable', d => { d.checks[0].argv = Array(1); }],
    ['hole after executable', d => { d.checks[0].argv = ['node', , 'check.mjs']; }]
  ];
  for (const [name, change] of cases) await t.test(name, async t => {
    const f = await fixture(t), description = publicationDescription(); change(description);
    await writeFile(f.bodyFile, 'Preserve independently authored text\n');
    await assert.rejects(prepareWorkflowPr({...f.input, description}, f.ports),
      {code:'workflow_github_description_invalid'});
    assert.equal(await readFile(f.bodyFile, 'utf8'), 'Preserve independently authored text\n');
    assert.equal(effects(f.calls).length, 0);
    assert.equal(f.state.headSha, headSha);
  });
});
