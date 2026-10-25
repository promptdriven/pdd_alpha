// Generated from prompts/cli/detached-updater.prompt.md (sha256: 8c96d2c5165de3f53aa04be956dcf52cce8effc322397b324666f0dfe0bf1ae9).
import * as fs from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { withUpdateLock } from './update-lock.mjs';
import { readInstallRecord, writeInstallRecord, initialInstallRecord, durableJson } from './install-record.mjs';
import { resolveRuntime } from './versions.mjs';
import { stageOwnedNode, ensureOwnedNode, downloadArtifact, verifyArtifactBytes, extractVerifiedTar, directoryDigest } from './owned-node.mjs';
import { replaceInstallPointer, localProcessProof } from './pdd-launch.mjs';

const execute = promisify(execFile), terminal = new Set(['ready', 'rolled_back']);
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const credentialShim = (node, entry) => `#!/bin/sh\nexec ${quote(node)} ${quote(entry)} "$@"\n`;
const result = (transactionId, phase, code = null, extra = {}) => ({ transactionId, phase, code, ...extra });
const allowed = async (target, ports) => {
  if (!ports.authorizeTarget || !target?.authorization) return 'authorization_unavailable';
  try { const value = await ports.authorizeTarget(target); return value === true || value?.ok === true ? null : value?.code ?? 'target_ineligible'; }
  catch { return 'authorization_unavailable'; }
};
const lock = (home, action, ports) => (ports.withUpdateLock ?? withUpdateLock)({ home }, action, ports);
async function change(home, lease, ports, edit) {
  const read = await readInstallRecord({ home }, ports); if (read.code) return read;
  const record = read.value ?? initialInstallRecord(), next = structuredClone(record);
  const refusal = await edit(next, record); if (refusal) return refusal;
  return writeInstallRecord({ home, lease, expectedRev: record.rev, next }, ports);
}
async function checkpoint(home, id, patch, ports) {
  return lock(home, lease => change(home, lease, ports, next => {
    if (!next.staging[id]) return { code: 'recovery_required' };
    next.staging[id] = { ...next.staging[id], ...patch };
  }), ports);
}
export async function launchDetachedProcess({ node, entry, args = [], transactionId }, ports = {}) {
  if (process.platform !== 'linux') return { code: 'detach_failed' };
  const unit = `pdd-updater-${transactionId}.service`;
  try {
    await (ports.execFile ?? execute)('systemd-run', ['--user', '--collect', `--unit=${unit}`, '--property=Type=exec', '--property=Nice=10', '--', node, entry, ...args]);
    const { stdout } = await (ports.execFile ?? execute)('systemctl', ['--user', 'show', unit, '--property=MainPID', '--value']);
    const proof = await localProcessProof(Number(stdout.trim()));
    if (!proof) return { code: 'recovery_required', unit };
    const [own, child] = await Promise.all([fs.readFile('/proc/self/cgroup', 'utf8'), fs.readFile(`/proc/${proof.pid}/cgroup`, 'utf8')]);
    if (own === child || !child.includes(unit)) return { code: 'detach_failed', unit };
    return { processProof: { ...proof, unit }, independent: true };
  } catch { return { code: 'detach_failed' }; }
}
export async function startUpdate({ target, requestId }, ports = {}) {
  const home = ports.home;
  if (!home || !requestId || typeof requestId !== 'string') return { transactionId: null, state: 'refused', code: 'invalid_request' };
  const authorization = await allowed(target, ports);
  if (authorization) return { transactionId: null, state: 'refused', code: authorization };
  let existing, id;
  const registered = await lock(home, lease => change(home, lease, ports, (next) => {
    if (next.rejected[target.releaseId]) return { code: 'target_rejected' };
    const found = Object.entries(next.staging).find(([, job]) => job.requestId === requestId);
    if (found) {
      [id, existing] = found;
      if (JSON.stringify(existing.target) !== JSON.stringify(target)) return { code: 'request_conflict' };
      return { value: next, code: null };
    }
    id = randomUUID();
    next.staging[id] = { requestId, target, paths: [join(home, '.pdd/update/staging', id)], phase: 'downloading', processProof: null, launchIntent: true };
  }), ports);
  if (registered.code) return { transactionId: id ?? null, state: 'refused', code: registered.code };
  if (existing) {
    if (!existing.processProof && !['checked', 'failed'].includes(existing.phase)) return { transactionId: id, state: 'recovery_required', code: 'recovery_required' };
    return { transactionId: id, state: existing.phase, code: null };
  }
  let detached;
  try {
    // The caller must bind the independent worker's authorization/compatibility
    // ports too. A foreground closure cannot silently become a background policy.
    detached = await (ports.launchDetached ?? (() => ({ code: 'detach_failed' })))({ home, transactionId: id, target });
  } catch { detached = { code: 'detach_failed' }; }
  if (!detached?.independent || !detached.processProof) {
    const code = detached?.code ?? 'detach_failed';
    await checkpoint(home, id, { ...(code === 'detach_failed' ? { phase: 'failed' } : {}), error: code, ...(detached?.unit ? { unit: detached.unit } : {}) }, ports);
    return { transactionId: id, state: code === 'detach_failed' ? 'failed' : 'recovery_required', code };
  }
  const saved = await checkpoint(home, id, { processProof: detached.processProof, launchIntent: false }, ports);
  return { transactionId: id, state: saved.code ? 'recovery_required' : 'accepted', code: saved.code };
}

async function stageRelease(home, id, target, ports) {
  const artifact = target.artifacts;
  if (!artifact?.alpha || !artifact?.node || Boolean(artifact.client) !== Boolean(target.runtime?.clientDigest)) throw new Error('stage_failed');
  const root = join(resolve(home), '.pdd/update/staging', id), alphaRoot = join(root, `alpha-${randomUUID()}`);
  const nodeStage = await stageOwnedNode({ home, artifact: artifact.node, platform: ports.platform ?? process.platform, arch: ports.arch ?? process.arch, transactionId: id }, ports);
  if (nodeStage.code) throw Object.assign(new Error(nodeStage.code), { code: nodeStage.code });
  for (const [kind, destination] of [['alpha', alphaRoot], ...(artifact.client ? [['client', join(alphaRoot, 'client')]] : [])]) {
    const bytes = Buffer.from(await (ports.downloadArtifact ?? downloadArtifact)(artifact[kind]));
    if (target.runtime[kind === 'alpha' ? 'alphaDigest' : 'clientDigest'] !== artifact[kind].integrity || !await verifyArtifactBytes(artifact[kind], bytes, ports) || kind === 'alpha' && (!ports.verifyProvenance || await ports.verifyProvenance(artifact[kind], bytes) !== true)) throw new Error('stage_failed');
    await (ports.extractArchive ?? extractVerifiedTar)(bytes, destination);
  }
  let credentialEntry = null;
  if (artifact.client) {
    credentialEntry = join(alphaRoot, 'client/bin/pdd-cred');
    if (await fs.realpath(credentialEntry) !== credentialEntry || !(await fs.stat(credentialEntry)).isFile()) throw new Error('stage_failed');
    await fs.writeFile(join(alphaRoot, 'bin/pdd-cred'), credentialShim(nodeStage.stagedNode, credentialEntry), { mode: 0o755, flag: 'wx' });
  }
  return { alphaRoot, nodeStage, temporaryNode: nodeStage.stagedNode, temporaryBin: join(alphaRoot, 'bin/pdd.mjs'), temporaryCredentialHelper: artifact.client ? join(alphaRoot, 'bin/pdd-cred') : null, credentialEntry, runtime: target.runtime };
}
async function stageChecks(home, staged, target, ports) {
  const stat = ports.freeBytes ? await ports.freeBytes(staged) : await fs.statfs(staged.alphaRoot).then(s => Number(s.bavail) * Number(s.bsize));
  if (stat < 1073741824) return 'disk_low';
  const selfTest = ports.selfTest ?? (async candidate => {
    // Import the verified temporary dispatcher directly: npm entry selection must
    // not hand this check back to the installed current release.
    const module = pathToFileURL(join(candidate.alphaRoot, 'src/pdd-cli.mjs')).href;
    const script = `const {runPdd}=await import(${JSON.stringify(module)});process.exitCode=await runPdd(['doctor','--check-only']);`;
    try { await execute(candidate.temporaryNode, ['--input-type=module', '-e', script], { cwd: candidate.alphaRoot, timeout: 120000 }); return true; } catch { return false; }
  });
  if (await selfTest(staged, { readOnly: true, network: false }) !== true) return 'stage_failed';
  if (target.runtime.clientDigest) {
    if (!ports.compareCredentialHelpers || await ports.compareCredentialHelpers({ candidate: staged, current: await currentRuntime(home, ports), readOnly: true, sameSnapshot: true, fixedClock: true }) !== true) return 'stage_failed';
  }
  if (!ports.listRetainedRuntimes || !ports.checkCompatibility) return 'stage_failed';
  const retained = await ports.listRetainedRuntimes();
  if (!retained?.complete || await ports.checkCompatibility(target, retained.runtimes ?? retained.references) !== true) return 'stage_failed';
  return null;
}
async function currentRuntime(home, ports) {
  try { return await resolveRuntime({ home }, ports); }
  catch { try { await fs.lstat(join(home, '.pdd/current')); } catch (e) { if (e.code === 'ENOENT') return null; } throw new Error('recovery_required'); }
}
async function publish(home, staged, target, lease, ports) {
  if (ports.publishArtifacts) return ports.publishArtifacts(staged, target, lease);
  if (await directoryDigest(staged.alphaRoot) !== staged.treeDigest) throw new Error('stage_failed');
  const ownedNode = await ensureOwnedNode({ home, staged: staged.nodeStage, lease }, ports);
  if (ownedNode.code) throw new Error(ownedNode.code);
  const runtime = target.runtime, expected = join(resolve(home), '.pdd/versions', target.releaseId);
  if (runtime.versionRoot !== expected || runtime.releaseId !== target.releaseId || runtime.node !== ownedNode.node) throw new Error('stage_failed');
  if (runtime.clientDigest) {
    if (!staged.credentialEntry) throw new Error('stage_failed');
    await fs.writeFile(join(staged.alphaRoot, 'bin/pdd-cred'), credentialShim(runtime.node, join(expected, 'client/bin/pdd-cred')), { mode: 0o755 });
  }
  const receipt = { releaseId: runtime.releaseId, alphaDigest: runtime.alphaDigest, clientDigest: runtime.clientDigest, node: runtime.node, treeDigest: await directoryDigest(staged.alphaRoot) };
  try {
    const installed = JSON.parse(await fs.readFile(join(expected, '.pdd-release.json'), 'utf8'));
    if (JSON.stringify(installed) !== JSON.stringify(receipt) || await directoryDigest(expected) !== receipt.treeDigest) throw new Error('stage_failed');
    return resolveRuntime({ home, versionRoot: expected }, ports);
  } catch (e) { if (e.code !== 'ENOENT') throw e; try { await fs.lstat(expected); throw new Error('stage_failed'); } catch (missing) { if (missing.code !== 'ENOENT') throw missing; } }
  await durableJson(join(staged.alphaRoot, 'runtime.json'), runtime);
  await durableJson(join(staged.alphaRoot, '.pdd-release.json'), receipt);
  await fs.mkdir(dirname(expected), { recursive: true, mode: 0o700 });
  await fs.rename(staged.alphaRoot, expected);
  return resolveRuntime({ home, versionRoot: expected }, ports);
}
async function blockStage(home, id, code, ports) {
  const written = await lock(home, lease => change(home, lease, ports, next => {
    const job = next.staging[id]; if (!job) return { code: 'recovery_required' };
    job.phase = 'failed'; job.error = code;
    const reportId = `stage-${id}`;
    if (!next.reports.some(r => r.id === reportId)) next.reports.push({ id: reportId, type: 'release.block', releaseId: job.target.releaseId, fallback: null, reason: code, delivered: false });
  }), ports);
  return result(id, 'failed', written.code ?? code);
}
async function acquireBarrier(id, job, ports) {
  if (!ports.acquireActivationBarrier) return null;
  const age = (ports.now?.() ?? Date.now()) - job.checkedAt;
  const barrier = await ports.acquireActivationBarrier(id, { ignoreJoinsAndSignIns: age >= 86400000, drainRequired: true, retryAfterMs: 300000 });
  if (!barrier?.id || barrier.held !== true || barrier.durable !== true || barrier.drained !== true || barrier.personCheckActive || barrier.keeperPullActive || barrier.sinceWakeMs < 180000 || age < 86400000 && (barrier.joinActive || barrier.signInActive)) return null;
  return barrier;
}
async function finishActivation(home, lease, record, ports, barrier) {
  const tx = record.transaction, id = tx.id;
  let current = await currentRuntime(home, ports);
  if (current?.versionRoot !== tx.to.versionRoot && current?.versionRoot !== tx.from?.versionRoot) return result(id, tx.phase, 'recovery_required');
  // A power loss after current rename but before the phase write leaves current=to.
  if (current?.versionRoot !== tx.to.versionRoot) {
    if (tx.phase !== 'activating') return result(id, tx.phase, 'recovery_required');
    const authorization = await allowed(record.staging[id]?.target, ports);
    if (authorization) return result(id, tx.phase, authorization);
    if (current) await replaceInstallPointer({ home, name: 'previous', runtime: current }, ports.fs);
    await replaceInstallPointer({ home, name: 'current', runtime: tx.to }, ports.fs);
    current = tx.to;
  }
  let saved = await writeInstallRecord({ home, lease, expectedRev: record.rev, next: { transaction: { ...tx, phase: tx.phase === 'activating' ? 'flipped' : tx.phase } } }, ports);
  if (saved.code) return result(id, tx.phase, saved.code);
  if (tx.restartRequired) {
    const acceptedStart = saved.value.starts[tx.to.releaseId];
    if (saved.value.transaction.phase === 'link_restarted' && acceptedStart?.lastSuccess && acceptedStart.pending === null) {
      const report = { id: `ok-${id}`, type: 'release.ok', releaseId: tx.to.releaseId, fallback: tx.from?.releaseId ?? null, reason: 'local_startup_ready', delivered: false };
      const ready = await writeInstallRecord({ home, lease, expectedRev: saved.value.rev, next: { transaction: { ...saved.value.transaction, phase: 'ready' }, reports: saved.value.reports.some(r => r.id === report.id) ? saved.value.reports : [...saved.value.reports, report] } }, ports);
      if (!ready.code) await barrier?.release?.();
      return result(id, ready.code ? 'link_restarted' : 'ready', ready.code);
    }
    if (saved.value.transaction.phase !== 'link_restarted') {
      // Intent is durable before restart. A recovery needs instance proof to join
      // a possible successor; a missing proof is never permission to restart twice.
      const intent = saved.value.transaction.restartIntent;
      let proof;
      if (intent) {
        if (!ports.proveLinkRestart) return result(id, 'flipped', 'recovery_required');
        proof = await ports.proveLinkRestart(tx.to, intent.attemptId);
      } else {
        const attemptId = randomUUID();
        saved = await writeInstallRecord({ home, lease, expectedRev: saved.value.rev, next: { transaction: { ...saved.value.transaction, restartIntent: { attemptId, processProof: null } } } }, ports);
        if (saved.code) return result(id, 'flipped', saved.code);
        if (!ports.restartLink) return result(id, 'flipped', 'recovery_required');
        proof = await ports.restartLink(tx.to, attemptId);
      }
      if (!proof?.processProof) return result(id, 'flipped', 'recovery_required');
      saved = await writeInstallRecord({ home, lease, expectedRev: saved.value.rev, next: { transaction: { ...saved.value.transaction, phase: 'link_restarted', restartIntent: { ...saved.value.transaction.restartIntent, processProof: proof.processProof } } } }, ports);
      if (saved.code) return result(id, 'flipped', saved.code);
    }
    // Readiness is owned by the launcher. Never wait for it under this lease.
    return result(id, 'link_restarted');
  }
  const report = { id: `ok-${id}`, type: 'release.ok', releaseId: tx.to.releaseId, fallback: tx.from?.releaseId ?? null, reason: 'local_checks_passed', delivered: false };
  saved = await writeInstallRecord({ home, lease, expectedRev: saved.value.rev, next: { transaction: { ...saved.value.transaction, phase: 'ready' }, reports: saved.value.reports.some(r => r.id === report.id) ? saved.value.reports : [...saved.value.reports, report] } }, ports);
  if (!saved.code) await barrier?.release?.();
  return result(id, saved.code ? 'flipped' : 'ready', saved.code);
}
export async function runUpdate({ transactionId: id }, ports = {}) {
  const home = ports.home;
  try {
    let read = await readInstallRecord({ home }, ports), job = read.value?.staging[id];
    if (read.code || !job) return result(id, null, read.code ?? 'recovery_required');
    if (read.value.rejected[job.target.releaseId]) return result(id, job.phase, 'target_rejected');
    let authorization = await allowed(job.target, ports); if (authorization) return result(id, job.phase, authorization);
    if (job.phase === 'failed') return result(id, 'failed', job.error ?? 'stage_failed');
    if (job.phase !== 'checked') {
      const staged = await (ports.stageArtifacts ?? ((target, id) => stageRelease(home, id, target, ports)))(job.target, id);
      if (!staged?.alphaRoot) return blockStage(home, id, 'stage_failed', ports);
      const checkpointed = await checkpoint(home, id, { phase: 'staged', candidate: staged }, ports); if (checkpointed.code) return result(id, 'staged', checkpointed.code);
      const code = await stageChecks(home, staged, job.target, ports); if (code) return blockStage(home, id, code, ports);
      staged.treeDigest = await directoryDigest(staged.alphaRoot);
      const checked = await checkpoint(home, id, { phase: 'checked', checkedAt: ports.now?.() ?? Date.now(), candidate: staged }, ports); if (checked.code) return result(id, 'staged', checked.code);
      job = checked.value.staging[id];
    }
    const barrier = await acquireBarrier(id, job, ports);
    if (!barrier) return result(id, 'checked', null, { waiting: true, retryAfterMs: 300000 });
    return await lock(home, async lease => {
      read = await readInstallRecord({ home }, ports); if (read.code) return result(id, 'checked', read.code);
      if (read.value.transaction?.id === id && !terminal.has(read.value.transaction.phase)) return finishActivation(home, lease, read.value, ports, barrier);
      if (read.value.transaction && !terminal.has(read.value.transaction.phase)) { await barrier.release?.(); return result(id, 'checked', null, { waiting: true }); }
      if (read.value.transaction?.id === id && terminal.has(read.value.transaction.phase)) { await barrier.release?.(); return result(id, read.value.transaction.phase); }
      authorization = await allowed(job.target, ports); if (authorization) { await barrier.release?.(); return result(id, 'checked', authorization); }
      if (read.value.rejected[job.target.releaseId]) { await barrier.release?.(); return result(id, 'checked', 'target_rejected'); }
      const retained = await ports.listRetainedRuntimes();
      if (!retained?.complete || await ports.checkCompatibility(job.target, retained.runtimes ?? retained.references) !== true) { await barrier.release?.(); return result(id, 'checked', 'stage_failed'); }
      const runtime = await publish(home, job.candidate, job.target, lease, ports);
      const from = await currentRuntime(home, ports);
      const running = ports.runningLinkRuntime ? await ports.runningLinkRuntime() : null;
      if (runtime.clientDigest && !ports.runningLinkRuntime) return result(id, 'checked', 'recovery_required');
      const restartRequired = Boolean(running && (running.clientDigest !== runtime.clientDigest || running.node !== runtime.node));
      const tx = { id, phase: 'activating', from, to: runtime, restartRequired, barrierId: barrier.id, manifestSeq: job.target.manifestSeq, error: null, restartIntent: null };
      const persisted = await writeInstallRecord({ home, lease, expectedRev: read.value.rev, next: { transaction: tx } }, ports);
      if (persisted.code) return result(id, 'checked', persisted.code);
      return finishActivation(home, lease, persisted.value, ports, barrier);
    }, ports);
  } catch (e) {
    // Preserve an activation intent after any uncertainty; never label it a staging
    // failure or remove files which current may already reference.
    const read = await readInstallRecord({ home }, ports);
    if (read.value?.transaction?.id === id && !terminal.has(read.value.transaction.phase)) return result(id, read.value.transaction.phase, 'recovery_required');
    return blockStage(home, id, ['disk_low', 'runtime_download_failed', 'runtime_verification_failed'].includes(e.code ?? e.message) ? e.code ?? e.message : 'stage_failed', ports);
  }
}
export async function recoverUpdate({ home }, ports = {}) {
  ports = { ...ports, home };
  return lock(home, async lease => {
    const read = await readInstallRecord({ home }, ports);
    if (read.code) return result(null, null, read.code);
    const tx = read.value?.transaction;
    if (!tx || terminal.has(tx.phase)) return result(tx?.id ?? null, tx?.phase ?? 'ready');
    if (tx.phase === 'rolling_back') return result(tx.id, tx.phase); // stable startup owner completes rollback
    if (['locked', 'staged', 'checked'].includes(tx.phase)) return result(tx.id, tx.phase);
    if (!['activating', 'flipped', 'link_restarted'].includes(tx.phase)) return result(tx.id, tx.phase, 'recovery_required');
    if (!ports.recoverActivationBarrier) return result(tx.id, tx.phase, 'recovery_required');
    const barrier = await ports.recoverActivationBarrier(tx.barrierId);
    if (!barrier?.held || !barrier.durable || !barrier.drained) return result(tx.id, tx.phase, 'recovery_required');
    try {
      await resolveRuntime({ home, versionRoot: tx.to.versionRoot }, ports);
      return await finishActivation(home, lease, read.value, ports, barrier);
    } catch { return result(tx.id, tx.phase, 'recovery_required'); }
  }, ports);
}
