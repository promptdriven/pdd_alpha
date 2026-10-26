// Generated from prompts/cli/workflow-github.prompt.md (sha256: 420934d5b784327eb1259a1336d85f502e8f69adecd404772c08f636b5551b33).
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, mkdtemp, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { assertWorkflowArtifacts } from './workflow-artifacts.mjs';

const execute = promisify(execFile);
const fields = 'number,url,state,headRefName,baseRefName,headRefOid,mergeCommit,body,isCrossRepository,headRepository,headRepositoryOwner';
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/.test(value);
const text = value => typeof value === 'string' && value.length > 0 && !/[\u0000-\u001f\u007f]/u.test(value);
const repositoryName = value => text(value) && /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value);
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const sameRepo = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const fail = code => { throw Object.assign(new Error(code), { code }); };
const parseJson = value => { try { return JSON.parse(value); } catch { fail('workflow_github_json_invalid'); } };
const outcome = (state, message, pr = null) => ({ state, pr, message });

function dependencies(ports = {}) {
  const run = ports.execFile ?? ((file, args, { cwd, env }) => execute(file, args,
    { cwd, ...(env ? {env} : {}), encoding: 'utf8', shell: false, timeout: 60_000, maxBuffer: 8 * 1024 * 1024 }));
  async function raw(cwd, file, args, options = {}) {
    let result;
    try { result = await run(file, args, { cwd, ...options }); }
    catch (error) {
      if (!Number.isInteger(error?.code) || error.code === 0) fail('workflow_github_command_unavailable');
      result = { code: error.code, stdout: error.stdout ?? '' };
    }
    if (!result || typeof result.stdout !== 'string'
      || result.code !== undefined && !Number.isInteger(result.code)) fail('workflow_github_command_invalid');
    return { code: result.code ?? 0, stdout: result.stdout };
  }
  async function command(cwd, file, args, options) {
    const result = await raw(cwd, file, args, options);
    if (result.code !== 0) fail('workflow_github_command_failed');
    return result.stdout;
  }
  return { raw, command, readFile: ports.readFile ?? ((file, encoding) => readFile(file,
    { encoding, flag: constants.O_RDONLY | constants.O_NOFOLLOW })),
  async writeFile(file, body, encoding) {
    await assertBodyPath(file);
    return (ports.writeFile ?? writeBodyFile)(file, body, encoding);
  } };
}


async function assertBodyPath(file) {
  if (await realpath(dirname(file)) !== dirname(file)) fail('workflow_github_body_unsafe');
  try {
    const entry = await lstat(file);
    if (!entry.isFile() || entry.nlink !== 1) fail('workflow_github_body_unsafe');
    return entry;
  } catch (error) { if (error?.code !== 'ENOENT') throw error; }
}

async function writeBodyFile(file, body, encoding) {
  // Open without truncation or following the final link; validate the opened file before modifying it.
  const handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW, 0o666);
  try {
    const opened = await handle.stat(), entry = await assertBodyPath(file);
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== entry?.dev || opened.ino !== entry?.ino)
      fail('workflow_github_body_unsafe');
    await handle.truncate(0);
    await handle.writeFile(body, encoding);
  } finally { await handle.close(); }
}

function originRepository(remote) {
  if (remote.startsWith('git@github.com:')) remote = 'https://github.com/' + remote.slice(15);
  let url;
  try { url = new URL(remote); } catch { fail('workflow_github_origin_invalid'); }
  if (url.hostname !== 'github.com' || url.port || url.search || url.hash || url.password
    || !['https:', 'ssh:'].includes(url.protocol)
    || url.username && !(url.protocol === 'ssh:' && url.username === 'git')) fail('workflow_github_origin_invalid');
  const name = url.pathname.slice(1).replace(/\.git$/, '');
  if (!repositoryName(name)) fail('workflow_github_origin_invalid');
  return name;
}

function canonicalUrl(value, repository, kind, number) {
  try {
    const url = new URL(value);
    const match = /^\/([^/]+\/[^/]+)\/(issues|pull)\/([1-9][0-9]*)$/.exec(url.pathname);
    return url.protocol === 'https:' && url.host === 'github.com' && !url.username && !url.password
      && !url.search && !url.hash && match && sameRepo(match[1], repository)
      && match[2] === kind && Number(match[3]) === number;
  } catch { return false; }
}

async function repositoryAt(cwd, deps) {
  if (!text(cwd)) fail('workflow_github_cwd_required');
  const remote = (await deps.command(cwd, 'git', ['remote', 'get-url', 'origin'])).trim();
  const repository = originRepository(remote);
  const actual = parseJson(await deps.command(cwd, 'gh', ['repo', 'view', repository,
    '--json', 'nameWithOwner,defaultBranchRef,url']));
  if (!repositoryName(actual?.nameWithOwner) || !sameRepo(actual.nameWithOwner, repository)
    || !text(actual.defaultBranchRef?.name) || actual.url !== `https://github.com/${actual.nameWithOwner}`)
    fail('workflow_github_repository_mismatch');
  return { repository: actual.nameWithOwner, defaultBranch: actual.defaultBranchRef.name };
}

function issueSelector(issue) {
  if (Number.isSafeInteger(issue) && issue > 0) return { number: issue };
  if (typeof issue !== 'string') fail('workflow_github_issue_invalid');
  let match = /^([1-9][0-9]*)$/.exec(issue);
  if (match) return { number: Number(match[1]) };
  match = /^([A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*)#([1-9][0-9]*)$/.exec(issue)
    ?? /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*)\/issues\/([1-9][0-9]*)$/.exec(issue);
  if (!match) fail('workflow_github_issue_invalid');
  return { repository: match[1], number: Number(match[2]) };
}

export async function resolveWorkflowIssue(input, ports = {}) {
  const { cwd, issue } = structuredClone(input ?? {}), selected = issueSelector(issue);
  if (!Number.isSafeInteger(selected.number) || selected.number < 1) fail('workflow_github_issue_invalid');
  const deps = dependencies(ports), repo = await repositoryAt(cwd, deps);
  if (selected.repository && !sameRepo(selected.repository, repo.repository)) fail('workflow_github_issue_foreign');
  const actual = parseJson(await deps.command(cwd, 'gh', ['api', `repos/${repo.repository}/issues/${selected.number}`]));
  if (!actual || Object.hasOwn(actual, 'pull_request') || actual.number !== selected.number
    || !canonicalUrl(actual.html_url, repo.repository, 'issues', selected.number)
    || typeof actual.title !== 'string' || !(actual.body === null || typeof actual.body === 'string'))
    fail('workflow_github_issue_mismatch');
  return { ...repo, issue: { number: actual.number, url: actual.html_url, title: actual.title, body: actual.body ?? '' } };
}

function markerBody(body, marker) {
  if (typeof body !== 'string') fail('workflow_github_body_invalid');
  const tokens = body.match(/pdd-workflow:[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+/g) ?? [];
  if (!tokens.length && !body.includes('pdd-workflow:')) return false;
  if ((body.match(/pdd-workflow:/g) ?? []).length !== 1 || tokens.length !== 1 || tokens[0] !== marker
    || body.split(/\r?\n/).filter(line => line === `<!-- ${marker} -->`).length !== 1)
    fail('workflow_github_marker_mismatch');
  return true;
}

function dirtyPaths(status) {
  const rows = status.split('\0'), paths = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    if (row.length < 4 || row[2] !== ' ') fail('workflow_github_status_invalid');
    paths.push(row.slice(3));
    if (/[RC]/.test(row.slice(0, 2))) {
      if (!rows[++i]) fail('workflow_github_status_invalid');
      paths.push(rows[i]);
    }
  }
  return [...new Set(paths)].sort();
}
function dirtyFailure(paths) {
  throw Object.assign(new Error('workflow_github_worktree_dirty: ' + paths.map(path => JSON.stringify(path)).join(', ')
    + '. Please commit or move unrelated changes before advancing; PDD preserves them.'), {code:'workflow_github_worktree_dirty'});
}

export async function commitWorkflowArtifacts(input, ports = {}) {
  const {cwd,runId,stageId,headBranch,baseBranch,expectedHead,files} = structuredClone(input ?? {});
  if (!identifier(runId) || !identifier(stageId) || !text(headBranch) || !text(baseBranch)
    || headBranch === baseBranch || !sha(expectedHead) || !Array.isArray(files)
    || files.some(file => !['prompt','story','cases'].includes(file?.role))) fail('workflow_github_artifact_intent_invalid');
  const deps = dependencies(ports), accepted = new Set(files.map(file => file.path));
  const literal = args => ['--literal-pathspecs', ...args];
  const git = args => deps.command(cwd, 'git', args);
  const status = async () => dirtyPaths(await git(['status','--porcelain=v1','-z','--untracked-files=all']));
  const identity = async () => {
    if ((await git(['rev-parse','--verify','HEAD'])).trim() !== expectedHead
      || (await git(['symbolic-ref','--quiet','--short','HEAD'])).trim() !== headBranch)
      fail('workflow_github_source_changed');
  };
  const acceptedOnly = async () => {
    const paths = await status(), unrelated = paths.filter(path => !accepted.has(path));
    if (unrelated.length) dirtyFailure(unrelated);
    return paths;
  };
  await identity();
  await assertWorkflowArtifacts({cwd,files});
  const changed = new Set(await acceptedOnly());
  // Compare exact unfiltered Git blobs, so ignored/missing or converted artifacts
  // cannot be mistaken for accepted files already present in the commit.
  const blobs = new Map();
  for (const file of files) {
    const blob = (await git(literal(['hash-object','--no-filters','--',file.path]))).trim();
    if (!sha(blob)) fail('workflow_github_artifact_blob_invalid');
    blobs.set(file.path,blob);
    const saved = await deps.raw(cwd,'git',literal(['rev-parse','--verify',`HEAD:${file.path}`]));
    if (saved.code !== 0 || saved.stdout.trim() !== blob) changed.add(file.path);
  }
  const indexChanged = path => {
    throw Object.assign(new Error('workflow_github_artifact_index_changed: Accepted artifact '
      + JSON.stringify(path) + ' has different staged changes. Commit or move those changes before advancing; PDD preserved your index.'),
    {code:'workflow_github_artifact_index_changed'});
  };
  const assertIndex = async () => {
    const existingStaged = (await git(['diff','--cached','--name-only','-z'])).split('\0').filter(Boolean);
    const entries = new Map();
    for (const path of existingStaged) {
      if (!accepted.has(path)) dirtyFailure([path]);
      if ((await git(literal(['rev-parse','--verify',`:${path}`]))).trim() !== blobs.get(path))
        indexChanged(path);
      entries.set(path,await git(literal(['ls-files','--stage','-z','--',path])));
    }
    return entries;
  };
  await assertIndex();
  if (!changed.size) {
    await identity(); await assertWorkflowArtifacts({cwd,files}); await acceptedOnly();
    return {previousHead:expectedHead,headSha:expectedHead,committedPaths:[]};
  }
  const selected = [...changed].sort();
  await identity(); await assertWorkflowArtifacts({cwd,files}); await acceptedOnly();
  const indexPath = (await git(['rev-parse','--path-format=absolute','--git-path','index'])).trim();
  if (!isAbsolute(indexPath) || await realpath(dirname(indexPath)) !== dirname(indexPath))
    fail('workflow_github_artifact_index_changed');
  await identity(); await assertWorkflowArtifacts({cwd,files}); await acceptedOnly();
  const lockPath = indexPath + '.lock';
  let lock;
  try { lock = await open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch {
    throw Object.assign(new Error('workflow_github_artifact_index_busy: Another Git operation holds the index lock, or it could not be created. Wait for Git to finish or check repository permissions; PDD left the index and any existing lock untouched.'),
      {code:'workflow_github_artifact_index_busy'});
  }
  const lockIdentity = await lock.stat();
  let scratch, indexPublished = false, headSha, committed;
  try {
    // Ordinary Git writers now exclude themselves on the real index. Recheck
    // its contents AFTER the last status await, before staging anything.
    const stagedBefore = await assertIndex();
    const original = await open(indexPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    let indexBytes;
    try {
      const entry = await original.stat();
      if (!entry.isFile() || entry.nlink !== 1) fail('workflow_github_artifact_index_changed');
      indexBytes = await original.readFile();
    } finally { await original.close(); }
    scratch = await mkdtemp(join(dirname(indexPath),'pdd-artifacts-'));
    const privateIndex = join(scratch,'index'), seed = await open(privateIndex,'wx',0o600);
    try { await seed.writeFile(indexBytes); } finally { await seed.close(); }
    const env = {...process.env,GIT_INDEX_FILE:privateIndex};
    const privateGit = args => deps.command(cwd,'git',args,{env});
    await privateGit(literal(['add','--',...selected]));
    const staged = (await privateGit(['diff','--cached','--name-only','-z'])).split('\0').filter(Boolean).sort();
    if (JSON.stringify(staged) !== JSON.stringify(selected)) fail('workflow_github_artifact_index_changed');
    for (const [path,entry] of stagedBefore)
      if (await privateGit(literal(['ls-files','--stage','-z','--',path])) !== entry) indexChanged(path);
    for (const path of selected) {
      if ((await privateGit(literal(['rev-parse','--verify',`:${path}`]))).trim() !== blobs.get(path))
        fail('workflow_github_artifact_index_changed');
      const mode = (await privateGit(literal(['ls-files','--stage','-z','--',path]))).slice(0,6);
      if (!['100644','100755'].includes(mode)) fail('workflow_github_artifact_index_changed');
    }
    await identity(); await assertWorkflowArtifacts({cwd,files});
    // Commit the validated private index once; never reconstruct it from the
    // worktree with --only or retry an interrupted response.
    await privateGit(['commit','-m',`pdd: record accepted artifacts for ${runId}/${stageId}`]);
    headSha = (await git(['rev-parse','--verify','HEAD'])).trim();
    if (!sha(headSha) || headSha === expectedHead
      || (await git(['symbolic-ref','--quiet','--short','HEAD'])).trim() !== headBranch
      || (await git(['rev-list','--parents','-n','1',headSha])).trim() !== `${headSha} ${expectedHead}`)
      fail('workflow_github_artifact_commit_unconfirmed');
    committed = (await git(['diff-tree','--no-commit-id','--name-only','-z','-r',expectedHead,headSha,'--'])).split('\0').filter(Boolean).sort();
    if (JSON.stringify(committed) !== JSON.stringify(selected)) fail('workflow_github_artifact_commit_unconfirmed');
    for (const file of files)
      if ((await git(literal(['rev-parse','--verify',`${headSha}:${file.path}`]))).trim() !== blobs.get(file.path))
        fail('workflow_github_artifact_commit_unconfirmed');
    await assertWorkflowArtifacts({cwd,files});
    const currentLock = await lstat(lockPath);
    if (currentLock.dev !== lockIdentity.dev || currentLock.ino !== lockIdentity.ino)
      fail('workflow_github_artifact_index_changed');
    await lock.writeFile(await readFile(privateIndex));
    await lock.sync();
    await rename(lockPath,indexPath);
    indexPublished = true;
  } finally {
    await lock.close();
    if (!indexPublished) {
      const currentLock = await lstat(lockPath).catch(() => null);
      if (currentLock?.dev === lockIdentity.dev && currentLock?.ino === lockIdentity.ino) await rm(lockPath);
    }
    if (scratch) await rm(scratch,{recursive:true,force:true});
  }
  const dirty = await status(); if (dirty.length) dirtyFailure(dirty);
  return {previousHead:expectedHead,headSha,committedPaths:committed};
}

async function localTopic(cwd, baseBranch, bodyFile, deps) {
  if (!text(baseBranch) || !text(bodyFile)) fail('workflow_github_topic_invalid');
  await assertBodyPath(bodyFile);
  await deps.command(cwd, 'git', ['check-ref-format', '--branch', baseBranch]);
  const root = (await deps.command(cwd, 'git', ['rev-parse', '--show-toplevel'])).trim();
  if (!isAbsolute(root)) fail('workflow_github_root_invalid');
  const bodyRelative = relative(root, bodyFile), inside = bodyRelative && bodyRelative !== '..'
    && !bodyRelative.startsWith('..' + sep) && !isAbsolute(bodyRelative);
  if (inside) {
    const tracked = await deps.raw(cwd, 'git', ['ls-files', '--error-unmatch', '--', bodyRelative]);
    if (tracked.code !== 1) fail('workflow_github_body_must_be_untracked');
  }
  const status = await deps.command(cwd, 'git', ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const dirty = dirtyPaths(status).filter(path => !(inside && path === bodyRelative
    && status.split('\0').includes('?? ' + bodyRelative)));
  if (dirty.length) dirtyFailure(dirty);
  const headBranch = (await deps.command(cwd, 'git', ['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim();
  await deps.command(cwd, 'git', ['check-ref-format', '--branch', headBranch]);
  if (!text(headBranch) || headBranch === baseBranch) fail('workflow_github_topic_required');
  const headSha = (await deps.command(cwd, 'git', ['rev-parse', '--verify', 'HEAD'])).trim();
  if (!sha(headSha)) fail('workflow_github_head_invalid');
  const base = `refs/remotes/origin/${baseBranch}`;
  await deps.command(cwd, 'git', ['rev-parse', '--verify', `${base}^{commit}`]);
  const count = (await deps.command(cwd, 'git', ['rev-list', '--count', `${base}..HEAD`])).trim();
  if (!/^[1-9][0-9]*$/.test(count)) fail('workflow_github_topic_has_no_commits');
  return { headBranch, headSha };
}

export async function prepareWorkflowPr(input, ports = {}) {
  const { cwd, runId, stageId, repository, baseBranch, bodyFile } = structuredClone(input ?? {});
  if (!identifier(runId) || !identifier(stageId) || !repositoryName(repository) || !text(bodyFile))
    fail('workflow_github_intent_invalid');
  const deps = dependencies(ports), actual = await repositoryAt(cwd, deps);
  if (!sameRepo(repository, actual.repository)) fail('workflow_github_repository_mismatch');
  const file = resolve(cwd, bodyFile), topic = await localTopic(cwd, baseBranch, file, deps);
  const title = (await deps.command(cwd, 'git', ['log', '-1', '--format=%s'])).trim();
  if (!text(title) || title.length > 256) fail('workflow_github_title_invalid');
  const marker = `pdd-workflow:${runId}:${stageId}`;
  let body;
  try { body = await deps.readFile(file, 'utf8'); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; body = title + '\n'; }
  if (!markerBody(body, marker)) body += (body.endsWith('\n') ? '\n' : '\n\n') + `<!-- ${marker} -->\n`;
  await deps.writeFile(file, body, 'utf8');
  return { repository: actual.repository, runId, stageId, ...topic, baseBranch, marker, title, bodyFile: file };
}

function intentCopy(value) {
  const intent = structuredClone(value);
  if (!intent || Object.keys(intent).sort().join(',') !== 'baseBranch,bodyFile,headBranch,headSha,marker,repository,runId,stageId,title'
    || !repositoryName(intent.repository) || !identifier(intent.runId) || !identifier(intent.stageId)
    || intent.marker !== `pdd-workflow:${intent.runId}:${intent.stageId}` || !sha(intent.headSha)
    || !text(intent.headBranch) || !text(intent.baseBranch) || intent.headBranch === intent.baseBranch
    || !text(intent.title) || !text(intent.bodyFile) || !isAbsolute(intent.bodyFile)) fail('workflow_github_intent_invalid');
  return intent;
}

function actualPr(row, intent) {
  if (!row || !Number.isSafeInteger(row.number) || row.number < 1 || row.isCrossRepository !== false
    || !sameRepo(`${row.headRepositoryOwner?.login}/${row.headRepository?.name}`, intent.repository)
    || !canonicalUrl(row.url, intent.repository, 'pull', row.number)
    || row.headRefName !== intent.headBranch || row.baseRefName !== intent.baseBranch || row.headRefOid !== intent.headSha
    || !markerBody(row.body, intent.marker) || !['OPEN', 'MERGED', 'CLOSED'].includes(row.state)
    || row.state === 'MERGED' && !sha(row.mergeCommit?.oid)) fail('workflow_github_pr_mismatch');
  return { repository: intent.repository, number: row.number, url: row.url, headBranch: row.headRefName,
    baseBranch: row.baseRefName, headSha: row.headRefOid, mergeCommit: row.state === 'MERGED' ? row.mergeCommit.oid : null };
}

async function lookup(cwd, intent, deps) {
  try {
    const prefix = ['pr', 'list', '--repo', intent.repository, '--state', 'all', '--limit', '100', '--json', fields];
    const responses = [];
    // Search the marker across branches as well as the actual head, including closed/merged PRs.
    for (const selector of [['--search', `"${intent.marker}" in:body`], ['--head', intent.headBranch]]) {
      const rows = parseJson(await deps.command(cwd, 'gh', [...prefix, ...selector]));
      if (!Array.isArray(rows) || rows.length >= 100) fail('workflow_github_lookup_incomplete');
      responses.push(...rows);
    }
    const unique = new Map();
    for (const row of responses) {
      const previous = unique.get(row.number);
      if (previous && JSON.stringify(previous) !== JSON.stringify(row)) fail('workflow_github_lookup_changed');
      unique.set(row.number, row);
    }
    if (!unique.size) return { state: 'absent' };
    if (unique.size !== 1) fail('workflow_github_pr_ambiguous');
    const row = [...unique.values()][0], pr = actualPr(row, intent);
    return { state: 'found', outcome: outcome(row.state.toLowerCase(), 'Verified the original workflow pull request.', pr) };
  } catch { return { state: 'refused' }; }
}

export async function reconcileWorkflowPr(input, ports = {}) {
  try {
    const { cwd, intent: supplied } = structuredClone(input ?? {}), intent = intentCopy(supplied), deps = dependencies(ports);
    const actual = await repositoryAt(cwd, deps);
    if (!sameRepo(actual.repository, intent.repository)) fail('workflow_github_repository_mismatch');
    const found = await lookup(cwd, intent, deps);
    if (found.state === 'found') return found.outcome;
  } catch { /* Read failure never authorizes another push or create. */ }
  return outcome('recovery_required', 'The original pull request is missing, changed, ambiguous or unreadable. Reconcile this same intent; do not publish again.');
}

export async function publishWorkflowPr(input, ports = {}) {
  let effectStarted = false, unpublishedOnly = false;
  try {
    const { cwd, intent: supplied, unpublishedOnly: mode = false } = structuredClone(input ?? {});
    if (typeof mode !== 'boolean') fail('workflow_github_recovery_mode_invalid');
    unpublishedOnly = mode;
    const intent = intentCopy(supplied), deps = dependencies(ports);
    const actual = await repositoryAt(cwd, deps);
    if (!sameRepo(actual.repository, intent.repository)) fail('workflow_github_repository_mismatch');
    const found = await lookup(cwd, intent, deps);
    if (found.state === 'found') return unpublishedOnly
      ? outcome('recovery_required', 'An original PR already exists. Inspect it without unpublished-only publication.') : found.outcome;
    if (found.state !== 'absent') return outcome('recovery_required', 'Cannot confirm the original PR identity. Reconcile the saved intent without another publication.');
    const topic = await localTopic(cwd, intent.baseBranch, intent.bodyFile, deps);
    if (topic.headBranch !== intent.headBranch || topic.headSha !== intent.headSha) fail('workflow_github_source_changed');
    const body = await deps.readFile(intent.bodyFile, 'utf8');
    if (!markerBody(body, intent.marker)) fail('workflow_github_marker_missing');
    const pushRemote = (await deps.command(cwd, 'git', ['remote', 'get-url', '--push', '--all', 'origin'])).trim();
    if (!sameRepo(originRepository(pushRemote), intent.repository)) fail('workflow_github_repository_mismatch');
    if (unpublishedOnly) {
      const remote = await deps.raw(cwd, 'git', ['ls-remote', '--exit-code', '--refs', 'origin', `refs/heads/${intent.headBranch}`]);
      if (remote.code !== 2 || remote.stdout !== '')
        return outcome('recovery_required', 'The saved remote branch is present or its absence is unconfirmed. Inspect the same intent without publication.');
      // Remote reads can wait for authentication. Revalidate source and body after that boundary.
      const current = await localTopic(cwd, intent.baseBranch, intent.bodyFile, deps);
      if (current.headBranch !== intent.headBranch || current.headSha !== intent.headSha
        || await deps.readFile(intent.bodyFile, 'utf8') !== body) fail('workflow_github_source_changed');
      const currentRepo = await repositoryAt(cwd, deps);
      if (!sameRepo(currentRepo.repository, intent.repository)
        || (await deps.command(cwd, 'git', ['remote', 'get-url', '--push', '--all', 'origin'])).trim() !== pushRemote)
        fail('workflow_github_repository_mismatch');
    }
    effectStarted = true;
    await deps.command(cwd, 'git', ['push', 'origin', `${intent.headSha}:refs/heads/${intent.headBranch}`]);
    await deps.command(cwd, 'gh', ['pr', 'create', '--repo', intent.repository, '--head', intent.headBranch,
      '--base', intent.baseBranch, '--title', intent.title, '--body-file', intent.bodyFile]);
    // A successful create exit/printed URL is insufficient; use genuine GitHub readback.
    return await reconcileWorkflowPr({ cwd, intent }, ports);
  } catch {
    return effectStarted || unpublishedOnly
      ? outcome('recovery_required', 'Push or PR creation is unconfirmed. Reconcile this same saved intent; do not publish again.')
      : outcome('failed', 'Publication did not start. Check the saved intent, repository, clean topic branch and marked body file.');
  }
}
